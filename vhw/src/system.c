/* ESP-IDF 系统服务：重启、复位原因、内存、随机数、MAC、芯片信息、日志、睡眠、计时器。 */
#include <emscripten.h>
#include <malloc.h>
#include <pthread.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include "esp_chip_info.h"
#include "esp_err.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_random.h"
#include "esp_sleep.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "soc/gpio_periph.h"
#include "vdev_io.h"
#include "vhw_clock.h"
#include "esp_cpu.h"
#include "esp_rom_sys.h"
#include "esp_private/esp_clk.h"
#include "sdkconfig.h"

/* 原因码（vdev_request_power 的 reason，供 JS 端显示） */
enum { VHW_REASON_RESTART = 1, VHW_REASON_DEEP_SLEEP = 2, VHW_REASON_ABORT = 3, VHW_REASON_ERROR_CHECK = 4 };

/* ---------- 重启 / 复位 ---------- */

/* 链接时 -Wl,--wrap=esp_restart：上游的 __wrap_esp_restart 记录调用点后调用 __real_esp_restart，即这里。 */
void esp_restart(void) { vdev_request_power(VDEV_POWER_RESTART, VHW_REASON_RESTART); }
esp_reset_reason_t esp_reset_reason(void) { return ESP_RST_POWERON; }
esp_err_t esp_register_shutdown_handler(shutdown_handler_t h) { (void)h; return ESP_OK; }
esp_err_t esp_unregister_shutdown_handler(shutdown_handler_t h) { (void)h; return ESP_OK; }
void esp_system_abort(const char* details) {
  vdev_logf("[vhw] abort: %s\n", details ? details : "");
  vdev_request_power(VDEV_POWER_HALTED, VHW_REASON_ABORT);
}
void vhw_error_check_failed(esp_err_t rc, const char* file, int line, const char* expr) {
  vdev_logf("ESP_ERROR_CHECK failed: esp_err_t 0x%x (%s) at %s:%d\nexpression: %s\n", rc, esp_err_to_name(rc), file, line, expr);
  vdev_request_power(VDEV_POWER_HALTED, VHW_REASON_ERROR_CHECK);
}
const char* esp_get_idf_version(void) { return "v5.5.1-firmware-sim"; }

/* ---------- 内存 ---------- */

/* 按 ESP32-S3（约 300 KB 内部 RAM）+ 8 MB PSRAM 的量级报告，让上游"内存够不够"的判断走正常分支 */
#define VHW_INTERNAL_FREE (240u * 1024u)
#define VHW_INTERNAL_LARGEST (110u * 1024u)
#define VHW_PSRAM_TOTAL (8u * 1024u * 1024u)

/* 报固定值（不随实际分配变化）：日志和上报内容在两次运行间保持一致 */
static size_t psram_used(void) { return 2u * 1024u * 1024u; }

void* heap_caps_malloc(size_t size, uint32_t caps) { (void)caps; return malloc(size); }
void* heap_caps_calloc(size_t n, size_t size, uint32_t caps) { (void)caps; return calloc(n, size); }
void* heap_caps_realloc(void* ptr, size_t size, uint32_t caps) { (void)caps; return realloc(ptr, size); }
void* heap_caps_aligned_alloc(size_t alignment, size_t size, uint32_t caps) {
  (void)caps;
  void* p = NULL;
  if (alignment < sizeof(void*)) alignment = sizeof(void*);
  return posix_memalign(&p, alignment, size) == 0 ? p : NULL;
}
void* heap_caps_aligned_calloc(size_t alignment, size_t n, size_t size, uint32_t caps) {
  void* p = heap_caps_aligned_alloc(alignment, n * size, caps);
  if (p) memset(p, 0, n * size);
  return p;
}
void* heap_caps_malloc_prefer(size_t size, size_t num, ...) { (void)num; return malloc(size); }
void heap_caps_free(void* ptr) { free(ptr); }
void heap_caps_aligned_free(void* ptr) { free(ptr); }
size_t heap_caps_get_free_size(uint32_t caps) {
  if (caps & MALLOC_CAP_SPIRAM) {
    return VHW_PSRAM_TOTAL - psram_used();
  }
  return VHW_INTERNAL_FREE;
}
size_t heap_caps_get_total_size(uint32_t caps) { return (caps & MALLOC_CAP_SPIRAM) ? VHW_PSRAM_TOTAL : 320u * 1024u; }
size_t heap_caps_get_minimum_free_size(uint32_t caps) { return heap_caps_get_free_size(caps) * 3 / 4; }
size_t heap_caps_get_largest_free_block(uint32_t caps) {
  return (caps & MALLOC_CAP_SPIRAM) ? heap_caps_get_free_size(caps) / 2 : VHW_INTERNAL_LARGEST;
}
size_t heap_caps_get_allocated_size(void* ptr) { return malloc_usable_size(ptr); }
void heap_caps_get_info(multi_heap_info_t* info, uint32_t caps) {
  memset(info, 0, sizeof *info);
  info->total_free_bytes = heap_caps_get_free_size(caps);
  info->largest_free_block = heap_caps_get_largest_free_block(caps);
  info->minimum_free_bytes = heap_caps_get_minimum_free_size(caps);
  info->total_allocated_bytes = psram_used();
}
void heap_caps_print_heap_info(uint32_t caps) { (void)caps; }
bool heap_caps_check_integrity_all(bool p) { (void)p; return true; }
bool heap_caps_check_integrity(uint32_t caps, bool p) { (void)caps; (void)p; return true; }
void heap_caps_malloc_extmem_enable(size_t limit) { (void)limit; }
esp_err_t heap_caps_register_failed_alloc_callback(esp_alloc_failed_hook_t cb) { (void)cb; return ESP_OK; }
void heap_caps_dump(uint32_t caps) { (void)caps; }
void heap_caps_dump_all(void) {}
bool esp_ptr_external_ram(const void* p) { (void)p; return true; }
bool esp_ptr_internal(const void* p) { (void)p; return true; }
bool esp_ptr_dma_capable(const void* p) { (void)p; return true; }
bool esp_ptr_in_dram(const void* p) { (void)p; return true; }
uint32_t esp_get_free_heap_size(void) { return (uint32_t)(VHW_INTERNAL_FREE + heap_caps_get_free_size(MALLOC_CAP_SPIRAM)); }
uint32_t esp_get_free_internal_heap_size(void) { return VHW_INTERNAL_FREE; }
uint32_t esp_get_minimum_free_heap_size(void) { return esp_get_free_heap_size() * 3 / 4; }

/* ---------- 随机数（固定种子：同样输入两次运行得到同样结果） ---------- */

static uint64_t s_rng = 0x9E3779B97F4A7C15ull;
static pthread_mutex_t s_rng_lock = PTHREAD_MUTEX_INITIALIZER;
uint32_t esp_random(void) {
  pthread_mutex_lock(&s_rng_lock);
  s_rng ^= s_rng << 13;
  s_rng ^= s_rng >> 7;
  s_rng ^= s_rng << 17;
  uint32_t v = (uint32_t)(s_rng >> 16);
  pthread_mutex_unlock(&s_rng_lock);
  return v;
}
void esp_fill_random(void* buf, size_t len) {
  uint8_t* p = buf;
  while (len) {
    uint32_t r = esp_random();
    size_t n = len < 4 ? len : 4;
    memcpy(p, &r, n);
    p += n;
    len -= n;
  }
}

/* ---------- MAC / 芯片 ---------- */

esp_err_t esp_efuse_mac_get_default(uint8_t* mac) { vdev_get_mac(mac); return ESP_OK; }
esp_err_t esp_base_mac_addr_get(uint8_t* mac) { vdev_get_mac(mac); return ESP_OK; }
esp_err_t esp_base_mac_addr_set(const uint8_t* mac) { (void)mac; return ESP_OK; }
esp_err_t esp_efuse_mac_get_custom(uint8_t* mac) { (void)mac; return ESP_ERR_INVALID_MAC; }
esp_err_t esp_derive_local_mac(uint8_t* local, const uint8_t* uni) { memcpy(local, uni, 6); local[0] |= 0x02; return ESP_OK; }
esp_err_t esp_read_mac(uint8_t* mac, esp_mac_type_t type) {
  vdev_get_mac(mac);
  /* 与 IDF 默认的派生规则一致：STA = 基址，AP = +1，BT = +2，ETH = +3 */
  int add = type == ESP_MAC_WIFI_SOFTAP ? 1 : type == ESP_MAC_BT ? 2 : type == ESP_MAC_ETH ? 3 : 0;
  mac[5] = (uint8_t)(mac[5] + add);
  return ESP_OK;
}

void esp_chip_info(esp_chip_info_t* info) {
  memset(info, 0, sizeof *info);
#if defined(CONFIG_IDF_TARGET_ESP32P4)
  info->model = CHIP_ESP32P4;
  info->revision = 100;
#else
  info->model = CHIP_ESP32S3;
  info->features = CHIP_FEATURE_WIFI_BGN | CHIP_FEATURE_BLE | CHIP_FEATURE_EMB_PSRAM;
  info->revision = 2;
#endif
  info->cores = 2;
}

const uint32_t GPIO_PIN_MUX_REG[64] = {0};

/* ---------- 错误名 ---------- */

const char* esp_err_to_name(esp_err_t code) {
  switch (code) {
    case ESP_OK: return "ESP_OK";
    case ESP_FAIL: return "ESP_FAIL";
    case ESP_ERR_NO_MEM: return "ESP_ERR_NO_MEM";
    case ESP_ERR_INVALID_ARG: return "ESP_ERR_INVALID_ARG";
    case ESP_ERR_INVALID_STATE: return "ESP_ERR_INVALID_STATE";
    case ESP_ERR_INVALID_SIZE: return "ESP_ERR_INVALID_SIZE";
    case ESP_ERR_NOT_FOUND: return "ESP_ERR_NOT_FOUND";
    case ESP_ERR_NOT_SUPPORTED: return "ESP_ERR_NOT_SUPPORTED";
    case ESP_ERR_TIMEOUT: return "ESP_ERR_TIMEOUT";
    default: return "UNKNOWN ERROR";
  }
}
const char* esp_err_to_name_r(esp_err_t code, char* buf, size_t len) {
  snprintf(buf, len, "%s", esp_err_to_name(code));
  return buf;
}

/* ---------- 日志 ---------- */

static esp_log_level_t s_log_level = ESP_LOG_INFO;
static vprintf_like_t s_vprintf = NULL;
void esp_log_level_set(const char* tag, esp_log_level_t level) { if (!tag || strcmp(tag, "*") == 0) s_log_level = level; }
esp_log_level_t esp_log_level_get(const char* tag) { (void)tag; return s_log_level; }
vprintf_like_t esp_log_set_vprintf(vprintf_like_t f) { vprintf_like_t old = s_vprintf; s_vprintf = f; return old; }
uint32_t esp_log_timestamp(void) { return (uint32_t)(esp_timer_get_time() / 1000); }
uint32_t esp_log_early_timestamp(void) { return esp_log_timestamp(); }
void esp_log_writev(esp_log_level_t level, const char* tag, const char* fmt, va_list args) {
  (void)tag;
  if (level > s_log_level) return;
  if (s_vprintf) { s_vprintf(fmt, args); return; }
  char buf[512];
  int n = vsnprintf(buf, sizeof buf, fmt, args);
  if (n > 0) vdev_log_write(buf, (size_t)(n < (int)sizeof buf ? n : (int)sizeof buf - 1));
}
void esp_log_write(esp_log_level_t level, const char* tag, const char* fmt, ...) {
  va_list ap;
  va_start(ap, fmt);
  esp_log_writev(level, tag, fmt, ap);
  va_end(ap);
}

/* ---------- 睡眠 ---------- */

esp_err_t esp_sleep_enable_timer_wakeup(uint64_t us) { (void)us; return ESP_OK; }
esp_err_t esp_sleep_enable_ext0_wakeup(int gpio, int level) { (void)gpio; (void)level; return ESP_OK; }
esp_err_t esp_sleep_enable_ext1_wakeup(uint64_t mask, esp_sleep_ext1_wakeup_mode_t mode) { (void)mask; (void)mode; return ESP_OK; }
esp_err_t esp_sleep_disable_wakeup_source(esp_sleep_source_t s) { (void)s; return ESP_OK; }
esp_err_t esp_sleep_pd_config(esp_sleep_pd_domain_t d, esp_sleep_pd_option_t o) { (void)d; (void)o; return ESP_OK; }
esp_sleep_wakeup_cause_t esp_sleep_get_wakeup_cause(void) { return ESP_SLEEP_WAKEUP_UNDEFINED; }
void esp_deep_sleep_start(void) { vdev_request_power(VDEV_POWER_HALTED, VHW_REASON_DEEP_SLEEP); }
void esp_deep_sleep(uint64_t us) { (void)us; esp_deep_sleep_start(); }
esp_err_t esp_light_sleep_start(void) { return ESP_OK; }

/* ---------- 计时器 ---------- */

int64_t esp_timer_get_time(void) { return vhw_clock_us(); }

/* ---------- CPU 周期 / ROM 延时 / 时钟频率（都由 vhw_clock 换算） ---------- */

esp_cpu_cycle_count_t esp_cpu_get_cycle_count(void) { return (esp_cpu_cycle_count_t)(vhw_clock_us() * CONFIG_ESP_DEFAULT_CPU_FREQ_MHZ); }
int esp_cpu_get_core_id(void) { return 0; }
void esp_rom_delay_us(uint32_t us) { vhw_clock_busy_wait_us(us); }
int esp_rom_printf(const char* fmt, ...) {
  char buf[256];
  va_list ap;
  va_start(ap, fmt);
  int n = vsnprintf(buf, sizeof buf, fmt, ap);
  va_end(ap);
  if (n > 0) vdev_log_write(buf, (size_t)(n < (int)sizeof buf ? n : (int)sizeof buf - 1));
  return n;
}
int esp_rom_get_reset_reason(int cpu) { (void)cpu; return 1; /* POWERON */ }
int esp_clk_cpu_freq(void) { return CONFIG_ESP_DEFAULT_CPU_FREQ_MHZ * 1000000; }
int esp_clk_apb_freq(void) { return 80 * 1000000; }

struct vhw_esp_timer {
  esp_timer_create_args_t args;
  pthread_t thread;
  volatile int armed;
  volatile int generation;
  uint64_t period_us;
  uint64_t timeout_us;
};

#if VHW_VIRTUAL_TIME
/* 虚拟时间：计时器回调跑在一个 FreeRTOS 任务里，由虚拟时钟唤醒（可重复） */
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
static void timer_task(void* p) {
  struct vhw_esp_timer* t = p;
  int gen = t->generation;
  uint64_t wait = t->timeout_us;
  for (;;) {
    vTaskDelay((TickType_t)((wait + 999) / 1000));
    if (!t->armed || gen != t->generation) vTaskDelete(NULL);
    t->args.callback(t->args.arg);
    if (!t->period_us) { t->armed = 0; vTaskDelete(NULL); }
    wait = t->period_us;
  }
}
#else
static void* timer_thread(void* p) {
  struct vhw_esp_timer* t = p;
  int gen = t->generation;
  uint64_t wait = t->timeout_us;
  for (;;) {
    usleep((useconds_t)(wait ? wait : 1000));
    if (!t->armed || gen != t->generation) return NULL;
    t->args.callback(t->args.arg);
    if (!t->period_us) { t->armed = 0; return NULL; }
    wait = t->period_us;
  }
}
#endif

static esp_err_t timer_start(esp_timer_handle_t t, uint64_t timeout, uint64_t period) {
  if (!t) return ESP_ERR_INVALID_ARG;
  if (t->armed) return ESP_ERR_INVALID_STATE;
  t->armed = 1;
  t->generation++;
  t->timeout_us = timeout;
  t->period_us = period;
#if VHW_VIRTUAL_TIME
  return xTaskCreate(timer_task, t->args.name ? t->args.name : "esp_timer", 4096, t, 22, NULL) == pdPASS ? ESP_OK : ESP_ERR_NO_MEM;
#else
  pthread_attr_t a;
  pthread_attr_init(&a);
  pthread_attr_setdetachstate(&a, PTHREAD_CREATE_DETACHED);
  int rc = pthread_create(&t->thread, &a, timer_thread, t);
  pthread_attr_destroy(&a);
  return rc == 0 ? ESP_OK : ESP_ERR_NO_MEM;
#endif
}

esp_err_t esp_timer_create(const esp_timer_create_args_t* args, esp_timer_handle_t* out) {
  struct vhw_esp_timer* t = calloc(1, sizeof *t);
  if (!t) return ESP_ERR_NO_MEM;
  t->args = *args;
  *out = t;
  return ESP_OK;
}
esp_err_t esp_timer_start_once(esp_timer_handle_t t, uint64_t us) { return timer_start(t, us, 0); }
esp_err_t esp_timer_start_periodic(esp_timer_handle_t t, uint64_t us) { return timer_start(t, us, us); }
esp_err_t esp_timer_stop(esp_timer_handle_t t) {
  if (!t || !t->armed) return ESP_ERR_INVALID_STATE;
  t->armed = 0;
  t->generation++;
  return ESP_OK;
}
esp_err_t esp_timer_delete(esp_timer_handle_t t) {
  if (!t) return ESP_ERR_INVALID_ARG;
  t->armed = 0;
  t->generation++;
  /* 计时线程可能还在睡；不立刻释放，避免它醒来访问已释放内存 */
  return ESP_OK;
}
bool esp_timer_is_active(esp_timer_handle_t t) { return t && t->armed; }
