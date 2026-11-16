/* 虚拟设备接口 C 端实现：交换区、环形缓冲、各通道的便捷出口。 */
#include "vdev_io.h"
#include "vhw_clock.h"
#if VHW_VIRTUAL_TIME
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#endif

#include <emscripten.h>
#include <emscripten/emscripten.h>
#include <pthread.h>
#include <stdarg.h>
#include <stdio.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

#ifndef VDEV_VIRTUAL_MAC
#define VDEV_VIRTUAL_MAC 0x02464d534e01ull /* 02:46:4d:53:4e:01，本地管理的单播地址 */
#endif

#define KB(x) ((x) * 1024u)
static uint8_t s_log_buf[KB(64)];
static uint8_t s_host_tx_buf[KB(1024)];
static uint8_t s_host_rx_buf[KB(256)];
static uint8_t s_servo_buf[KB(4)];
static uint8_t s_speaker_buf[KB(256)];
static uint8_t s_mic_buf[KB(64)];
static uint8_t s_input_buf[KB(4)];
static uint8_t s_cam_buf[KB(512)];

static vdev_io_t s_io;
static pthread_mutex_t s_ring_lock[VDEV_RING_COUNT];
static pthread_once_t s_once = PTHREAD_ONCE_INIT;

static void ring_setup(int i, uint8_t* buf, uint32_t cap) {
  s_io.rings[i].data = (uint32_t)(uintptr_t)buf;
  s_io.rings[i].cap = cap;
  s_io.rings[i].head = 0;
  s_io.rings[i].tail = 0;
}

static void io_init(void) {
  memset(&s_io, 0, sizeof s_io);
  s_io.magic = VDEV_IO_MAGIC;
  s_io.version = VDEV_IO_VERSION;
  s_io.word_count = VDEV_IO_WORDS;
  s_io.power = VDEV_POWER_RUNNING;
  ring_setup(VDEV_RING_LOG, s_log_buf, sizeof s_log_buf);
  ring_setup(VDEV_RING_HOST_TX, s_host_tx_buf, sizeof s_host_tx_buf);
  ring_setup(VDEV_RING_HOST_RX, s_host_rx_buf, sizeof s_host_rx_buf);
  ring_setup(VDEV_RING_SERVO, s_servo_buf, sizeof s_servo_buf);
  ring_setup(VDEV_RING_SPEAKER, s_speaker_buf, sizeof s_speaker_buf);
  ring_setup(VDEV_RING_MIC, s_mic_buf, sizeof s_mic_buf);
  ring_setup(VDEV_RING_INPUT, s_input_buf, sizeof s_input_buf);
  s_io.cam_buf = (uint32_t)(uintptr_t)s_cam_buf;
  s_io.cam_cap = sizeof s_cam_buf;
  s_io.mic_rate = 16000;
  s_io.mic_channels = 1;
  s_io.speaker_rate = 16000;
  s_io.speaker_channels = 1;
  const unsigned long long mac = VDEV_VIRTUAL_MAC;
  s_io.mac_lo = (uint32_t)((mac >> 16) & 0xffffffffu); /* 字节 0..3（大端顺序：mac[0] 在最高位） */
  s_io.mac_hi = (uint32_t)(mac & 0xffffu);            /* 字节 4..5 */
  for (int i = 0; i < VDEV_RING_COUNT; i++) pthread_mutex_init(&s_ring_lock[i], NULL);
}

/* 尽早初始化：JS 在模块就绪后（main 可能已在另一线程跑）立即读交换区。 */
__attribute__((constructor)) static void io_ctor(void) { pthread_once(&s_once, io_init); }

EMSCRIPTEN_KEEPALIVE vdev_io_t* vdev_io(void) {
  pthread_once(&s_once, io_init);
  return &s_io;
}

static inline uint32_t load_acq(const uint32_t* p) { return __atomic_load_n(p, __ATOMIC_ACQUIRE); }
static inline void store_rel(uint32_t* p, uint32_t v) { __atomic_store_n(p, v, __ATOMIC_RELEASE); }

size_t vdev_ring_writable(int ring) {
  vdev_ring_t* r = &vdev_io()->rings[ring];
  return r->cap - (load_acq(&r->head) - load_acq(&r->tail));
}

size_t vdev_ring_readable(int ring) {
  vdev_ring_t* r = &vdev_io()->rings[ring];
  return load_acq(&r->head) - load_acq(&r->tail);
}

static void sleep_ms(uint32_t ms) {
  struct timespec ts = {(time_t)(ms / 1000), (long)(ms % 1000) * 1000000L};
  nanosleep(&ts, NULL);
}

/* 等外界（JS 侧）一毫秒：摄像头帧、出口环形缓冲腾出空间。
 * 虚拟时间下一次只跑一个任务，直接睡会占着"CPU"让整机（屏幕、喇叭、设备时钟）一起停住；
 * 要经 FreeRTOS 延时交出 CPU，别的任务照跑、时钟照走。实时下直接睡。 */
static void wait_external_1ms(void) {
#if VHW_VIRTUAL_TIME
  (void)xTaskGetCurrentTaskHandle(); /* 万一调用者不是 FreeRTOS 任务：先登记进调度，再延时 */
  vTaskDelay(1);
#else
  sleep_ms(1);
#endif
}

size_t vdev_ring_write(int ring, const void* data, size_t len, uint32_t block_ms) {
  vdev_ring_t* r = &vdev_io()->rings[ring];
  const uint8_t* src = (const uint8_t*)data;
  size_t done = 0;
  uint32_t waited = 0;
  pthread_mutex_lock(&s_ring_lock[ring]); /* 多个固件任务可能同时写同一个出口 */
  while (done < len) {
    const uint32_t head = r->head;
    const uint32_t space = r->cap - (head - load_acq(&r->tail));
    if (space == 0) {
      if (waited >= block_ms) break;
      pthread_mutex_unlock(&s_ring_lock[ring]);
      wait_external_1ms();
      waited++;
      pthread_mutex_lock(&s_ring_lock[ring]);
      continue;
    }
    size_t n = len - done;
    if (n > space) n = space;
    const uint32_t pos = head & (r->cap - 1);
    const size_t first = (n < r->cap - pos) ? n : r->cap - pos;
    uint8_t* base = (uint8_t*)(uintptr_t)r->data;
    memcpy(base + pos, src + done, first);
    if (n > first) memcpy(base, src + done + first, n - first);
    store_rel(&r->head, head + (uint32_t)n);
    done += n;
  }
  pthread_mutex_unlock(&s_ring_lock[ring]);
  return done;
}

size_t vdev_ring_read(int ring, void* out, size_t len) {
  vdev_ring_t* r = &vdev_io()->rings[ring];
  pthread_mutex_lock(&s_ring_lock[ring]);
  const uint32_t tail = r->tail;
  size_t avail = load_acq(&r->head) - tail;
  size_t n = len < avail ? len : avail;
  const uint32_t pos = tail & (r->cap - 1);
  const size_t first = (n < r->cap - pos) ? n : r->cap - pos;
  const uint8_t* base = (const uint8_t*)(uintptr_t)r->data;
  memcpy(out, base + pos, first);
  if (n > first) memcpy((uint8_t*)out + first, base, n - first);
  store_rel(&r->tail, tail + (uint32_t)n);
  pthread_mutex_unlock(&s_ring_lock[ring]);
  return n;
}

void vdev_log_write(const char* text, size_t len) { vdev_ring_write(VDEV_RING_LOG, text, len, 0); }

void vdev_logf(const char* fmt, ...) {
  char buf[512];
  va_list ap;
  va_start(ap, fmt);
  int n = vsnprintf(buf, sizeof buf, fmt, ap);
  va_end(ap);
  if (n < 0) return;
  if ((size_t)n >= sizeof buf) n = sizeof buf - 1;
  vdev_log_write(buf, (size_t)n);
}

void vdev_host_write(const void* data, size_t len, uint32_t block_ms) {
  if (!load_acq(&vdev_io()->host_present)) return; /* 没有电脑端时，USB 发出去的字节无人接收 */
  vdev_ring_write(VDEV_RING_HOST_TX, data, len, block_ms);
}

/* 设备 millis()（上电后毫秒数）。不能直接用 emscripten_get_now()：它在线程里是跨线程对齐的绝对时间，
 * 超过 2^32 后转 uint32 饱和成 0xFFFFFFFF（舵机事件时间戳曾因此全是 4294967295）。 */
int64_t esp_timer_get_time(void);
static uint32_t now_ms(void) { return (uint32_t)(esp_timer_get_time() / 1000); }

void vdev_servo_emit(uint32_t id, int32_t angle_mdeg, uint32_t pulse_us) {
  vdev_servo_event_t ev = {id, angle_mdeg, now_ms(), pulse_us};
  vdev_ring_write(VDEV_RING_SERVO, &ev, sizeof ev, 0);
}

void vdev_speaker_write(const int16_t* samples, size_t count, uint32_t rate, uint32_t channels) {
  vdev_io_t* io = vdev_io();
  io->speaker_rate = rate;
  io->speaker_channels = channels;
  vdev_ring_write(VDEV_RING_SPEAKER, samples, count * sizeof(int16_t), 0);
}

void vdev_mic_read(int16_t* out, size_t count) {
  size_t got = vdev_ring_read(VDEV_RING_MIC, out, count * sizeof(int16_t)) / sizeof(int16_t);
  /* 低幅三角抖动噪声：峰峰值约 ±24，足以让固件的"麦克风活着"判据通过，又听不见。 */
  static uint32_t seed = 0x12345678u;
  for (size_t i = got; i < count; i++) {
    seed = seed * 1664525u + 1013904223u;
    int a = (int)((seed >> 16) & 31) - 16;
    seed = seed * 1664525u + 1013904223u;
    int b = (int)((seed >> 16) & 31) - 16;
    out[i] = (int16_t)(a + b);
  }
}

void vdev_screen_configure(uint16_t* pixels, uint32_t width, uint32_t height) {
  vdev_io_t* io = vdev_io();
  io->screen_width = width;
  io->screen_height = height;
  io->screen_format = VDEV_PIXEL_RGB565;
  store_rel(&io->screen_ptr, (uint32_t)(uintptr_t)pixels);
}

void vdev_screen_touch(void) {
  vdev_io_t* io = vdev_io();
  __atomic_store_n(&io->screen_time_ms, (uint32_t)(vhw_clock_us() / 1000), __ATOMIC_RELEASE);
  __atomic_add_fetch(&io->screen_seq, 1, __ATOMIC_ACQ_REL);
}

void vdev_screen_wait_consumed(uint32_t timeout_ms) {
  vdev_io_t* io = vdev_io();
  for (uint32_t waited = 0; waited < timeout_ms; waited++) {
    if (load_acq(&io->screen_ack) == load_acq(&io->screen_seq)) return;
    sleep_ms(1);
  }
}

size_t vdev_camera_grab(uint32_t width, uint32_t height, uint32_t format, uint8_t* out, size_t cap) {
  vdev_io_t* io = vdev_io();
  io->cam_req_width = width;
  io->cam_req_height = height;
  io->cam_req_format = format;
  const uint32_t seen = load_acq(&io->cam_seq);
  __atomic_add_fetch(&io->cam_req_seq, 1, __ATOMIC_ACQ_REL);
  /* 等外界送来一帧（最多 500 ms），否则用上一帧或返回 0 */
  for (int i = 0; i < 500 && load_acq(&io->cam_seq) == seen; i++) wait_external_1ms();
  const uint32_t len = load_acq(&io->cam_len);
  if (len == 0 || len > cap) return 0;
  memcpy(out, (const void*)(uintptr_t)io->cam_buf, len);
  return len;
}

void vdev_request_power(uint32_t state, uint32_t reason) {
  vdev_io_t* io = vdev_io();
  io->power_reason = reason;
  store_rel(&io->power, state);
  vdev_logf("[vhw] power request state=%u reason=%u\n", state, reason);
  for (;;) sleep_ms(1000); /* JS 断电时整个模块被回收 */
}

void vdev_get_mac(uint8_t mac[6]) {
  vdev_io_t* io = vdev_io();
  mac[0] = (uint8_t)(io->mac_lo >> 24);
  mac[1] = (uint8_t)(io->mac_lo >> 16);
  mac[2] = (uint8_t)(io->mac_lo >> 8);
  mac[3] = (uint8_t)(io->mac_lo);
  mac[4] = (uint8_t)(io->mac_hi >> 8);
  mac[5] = (uint8_t)(io->mac_hi);
}
