/*
 * 虚拟设备接口的 C 端：固件（wasm）与外界之间唯一的数据交换区。
 *
 * 整块是一串 uint32 字，放在 wasm 共享内存里。JS 端（src/interface/io-layout.mjs）按同样的字序号读写，
 * 两边必须一起改；JS 启动时核对 magic / version / word_count。
 *
 * 环形缓冲：head 只由生产者写、tail 只由消费者写，都是单调递增的字节计数（取模 cap 定位）。
 * cap 是 2 的幂；定长记录（舵机、输入事件）的大小也是 2 的幂，保证记录不跨环尾。
 */
#pragma once
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define VDEV_IO_MAGIC 0x56444556u /* 'VDEV' */
#define VDEV_IO_VERSION 3u
#define VDEV_IO_WORDS 64u

enum {
  VDEV_RING_LOG = 0,     /* 出：设备日志文本 */
  VDEV_RING_HOST_TX = 1, /* 出：设备 → 电脑端字节流 */
  VDEV_RING_HOST_RX = 2, /* 进：电脑端 → 设备字节流 */
  VDEV_RING_SERVO = 3,   /* 出：vdev_servo_event_t */
  VDEV_RING_SPEAKER = 4, /* 出：int16 PCM（交错，声道数见 speaker_channels） */
  VDEV_RING_MIC = 5,     /* 进：int16 PCM 单声道 */
  VDEV_RING_INPUT = 6,   /* 进：vdev_input_event_t（按键 / 摇杆 / 触摸） */
  VDEV_RING_COUNT = 7,
};

typedef struct {
  uint32_t data; /* wasm 地址 */
  uint32_t cap;  /* 字节数，2 的幂 */
  uint32_t head; /* 已写入总字节数（生产者） */
  uint32_t tail; /* 已读出总字节数（消费者） */
} vdev_ring_t;

enum { VDEV_POWER_OFF = 0, VDEV_POWER_RUNNING = 1, VDEV_POWER_RESTART = 2, VDEV_POWER_HALTED = 3 };
enum { VDEV_PIXEL_RGB565 = 1 };
enum { VDEV_CAMERA_JPEG = 1, VDEV_CAMERA_RGB565 = 2 };
enum { VDEV_INPUT_BUTTON = 1, VDEV_INPUT_JOYSTICK = 2, VDEV_INPUT_TOUCH = 3 };
enum { VDEV_TOUCH_DOWN = 1, VDEV_TOUCH_MOVE = 2, VDEV_TOUCH_UP = 3 };

typedef struct {
  uint32_t id;
  int32_t angle_mdeg; /* 千分之一度 */
  uint32_t t_ms;      /* 设备 millis() */
  uint32_t pulse_us;  /* 原始脉宽（0 = 释放） */
} vdev_servo_event_t; /* 16 字节 */

typedef struct {
  uint32_t type; /* VDEV_INPUT_* */
  int32_t a;     /* 按键编号 / 摇杆 x(-1000..1000) / 触摸 x */
  int32_t b;     /* 按下 1 松开 0 / 摇杆 y / 触摸 y */
  int32_t c;     /* 触摸阶段 VDEV_TOUCH_* */
} vdev_input_event_t; /* 16 字节 */

typedef struct {
  uint32_t magic, version, word_count;
  uint32_t power;          /* VDEV_POWER_* ：固件请求重启 / 停机时由 C 端改写 */
  uint32_t power_reason;   /* 重启 / 停机原因码（见 vdev_request_power） */
  uint32_t screen_time_ms; /* 字 5：最近一帧提交时的设备时钟（毫秒） */
  uint32_t screen_ack;     /* 字 6：JS 已取走的屏幕帧序号（vdev_screen_wait_consumed 用） */
  uint32_t clock_ms;       /* 字 7：设备时钟（毫秒；虚拟时间下是虚拟时钟） */
  vdev_ring_t rings[VDEV_RING_COUNT]; /* 字 8..35 */
  /* 屏幕（字 36..41）：面板原生扫描方向的整帧 */
  uint32_t screen_ptr, screen_width, screen_height, screen_format, screen_seq, screen_on;
  /* 喇叭（字 42..43） */
  uint32_t speaker_rate, speaker_channels;
  /* 麦克风（字 44..46）：mic_live=1 表示外界在送真实音频；否则 C 端自己补噪声帧 */
  uint32_t mic_rate, mic_channels, mic_live;
  /* 摄像头（字 47..54）：C 端改 req_*，JS 把一帧写进 cam_buf 后递增 cam_seq */
  uint32_t cam_req_seq, cam_req_width, cam_req_height, cam_req_format;
  uint32_t cam_buf, cam_cap, cam_len, cam_seq;
  /* 电脑端在线（字 55） */
  uint32_t host_present;
  /* 输入电平状态（字 56..58） */
  uint32_t buttons;
  int32_t joy_x, joy_y;
  /* 虚拟 MAC（字 59..60） */
  uint32_t mac_lo, mac_hi;
  /* Clock hold (words 61..62, virtual time only): while clock_hold_ms != 0 the virtual clock does not move past it;
   * clock_parked = 1 while the device waits there (every task blocked until a later time). Inputs given while parked
   * reach the firmware at exactly that device time, so runs with the same inputs are identical. */
  uint32_t clock_hold_ms, clock_parked;
  uint32_t reserved1[1];
} vdev_io_t;

_Static_assert(sizeof(vdev_io_t) == VDEV_IO_WORDS * 4, "vdev_io_t must be VDEV_IO_WORDS words");

/* JS 取交换区地址 */
vdev_io_t* vdev_io(void);

/* 环形缓冲（C 端）。写：返回实际写入字节；block_ms>0 时等空间（例如 USB 发送背压）。 */
size_t vdev_ring_write(int ring, const void* data, size_t len, uint32_t block_ms);
size_t vdev_ring_read(int ring, void* out, size_t len);
size_t vdev_ring_readable(int ring);
size_t vdev_ring_writable(int ring);

/* 便捷出口 */
void vdev_log_write(const char* text, size_t len);
void vdev_logf(const char* fmt, ...) __attribute__((format(printf, 1, 2)));
void vdev_host_write(const void* data, size_t len, uint32_t block_ms);
void vdev_servo_emit(uint32_t id, int32_t angle_mdeg, uint32_t pulse_us);
void vdev_speaker_write(const int16_t* samples, size_t count, uint32_t rate, uint32_t channels);
/* 麦克风：读满 count 个样本；外界没送够时用低幅噪声补齐（固件看门狗要求一直有"活"的帧） */
void vdev_mic_read(int16_t* out, size_t count);
/* 屏幕：模型改完像素后调用，递增帧序号 */
void vdev_screen_configure(uint16_t* pixels, uint32_t width, uint32_t height);
void vdev_screen_touch(void);
/* 屏幕：等 JS 取走上一帧再改像素（最多 timeout_ms 毫秒）。逐帧提交的面板（哈基米机 DPI 面板）用，保证不丢帧、不撕裂。 */
void vdev_screen_wait_consumed(uint32_t timeout_ms);
/* 摄像头：发出请求并取最新一帧；返回字节数（0 = 外界没有提供） */
size_t vdev_camera_grab(uint32_t width, uint32_t height, uint32_t format, uint8_t* out, size_t cap);
/* 固件请求重启 / 停机：JS 看到后断电再上电（或停住）。调用线程不再返回。 */
void vdev_request_power(uint32_t state, uint32_t reason) __attribute__((noreturn));
void vdev_get_mac(uint8_t mac[6]);

#ifdef __cplusplus
}
#endif
