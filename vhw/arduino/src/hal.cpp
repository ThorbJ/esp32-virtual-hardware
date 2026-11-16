/* arduino-esp32 HAL：时间、引脚、PSRAM、CPU、温度、ESP 对象、日志。 */
#include <Arduino.h>
#include <emscripten.h>
#include <errno.h>
#include <stdarg.h>
#include <time.h>

#include "driver/gpio.h"
#include "vdev_io.h"
#include "vhw_clock.h"

static double s_boot = -1;
static double boot_ms() {
  double now = emscripten_get_now();
  if (s_boot < 0) s_boot = now;
  return now - s_boot;
}
__attribute__((constructor)) static void hal_ctor() { boot_ms(); }

extern "C" {

#if VHW_VIRTUAL_TIME
/* 虚拟时间：和 FreeRTOS、esp_timer 同一个设备时钟（同样输入两次运行的 millis() 序列相同） */
unsigned long millis(void) { return (unsigned long)(vhw_clock_us() / 1000); }
unsigned long micros(void) { return (unsigned long)vhw_clock_us(); }
void delayMicroseconds(uint32_t us) { vhw_clock_busy_wait_us(us); }
#else
unsigned long millis(void) { return (unsigned long)boot_ms(); }
unsigned long micros(void) { return (unsigned long)(boot_ms() * 1000.0); }
void delayMicroseconds(uint32_t us) {
  struct timespec ts = {(time_t)(us / 1000000), (long)(us % 1000000) * 1000L};
  while (nanosleep(&ts, &ts) == -1 && errno == EINTR) {}
}
#endif

void delay(uint32_t ms) { vTaskDelay(pdMS_TO_TICKS(ms)); }

void yield(void) { vTaskDelay(0); }

void pinMode(uint8_t pin, uint8_t mode) {
  gpio_config_t cfg = {};
  cfg.pin_bit_mask = 1ull << pin;
  cfg.mode = (mode & OUTPUT) == OUTPUT ? GPIO_MODE_INPUT_OUTPUT : GPIO_MODE_INPUT;
  gpio_config(&cfg);
}
void digitalWrite(uint8_t pin, uint8_t val) { gpio_set_level((gpio_num_t)pin, val ? 1 : 0); }
int digitalRead(uint8_t pin) { return gpio_get_level((gpio_num_t)pin); }
uint16_t analogRead(uint8_t pin) { (void)pin; return 0; }
uint32_t analogReadMilliVolts(uint8_t pin) { (void)pin; return 0; }
void analogWrite(uint8_t pin, int value) { (void)pin; (void)value; }
void attachInterrupt(uint8_t pin, void (*fn)(void), int mode) { (void)pin; (void)fn; (void)mode; }
void attachInterruptArg(uint8_t pin, void (*fn)(void*), void* arg, int mode) { (void)pin; (void)fn; (void)arg; (void)mode; }
void detachInterrupt(uint8_t pin) { (void)pin; }

/* 芯片温度：恒定 42 °C（过热保护不会触发） */
float temperatureRead(void) { return 42.0f; }
bool psramFound(void) { return true; }
bool psramInit(void) { return true; }
void* ps_malloc(size_t size) { return heap_caps_malloc(size, MALLOC_CAP_SPIRAM); }
void* ps_calloc(size_t n, size_t size) { return heap_caps_calloc(n, size, MALLOC_CAP_SPIRAM); }
void* ps_realloc(void* p, size_t size) { return heap_caps_realloc(p, size, MALLOC_CAP_SPIRAM); }
bool setCpuFrequencyMhz(uint32_t mhz) { (void)mhz; return true; }
uint32_t getCpuFrequencyMhz(void) { return 240; }
uint32_t getXtalFrequencyMhz(void) { return 40; }
uint32_t getApbFrequency(void) { return 80000000; }
bool btInUse(void) { return false; }
void arduino_phy_init(void) {}
bool verifyOta(void) { return true; }
bool verifyRollbackLater(void) { return false; }

const char* pathToFileName(const char* path) {
  const char* p = path;
  for (const char* s = path; *s; s++)
    if (*s == '/' || *s == '\\') p = s + 1;
  return p;
}

int log_printf(const char* fmt, ...) {
  char buf[512];
  va_list ap;
  va_start(ap, fmt);
  int n = vsnprintf(buf, sizeof buf, fmt, ap);
  va_end(ap);
  if (n > 0) vdev_log_write(buf, (size_t)(n < (int)sizeof buf ? n : (int)sizeof buf - 1));
  return n;
}

}  // extern "C"

/* ---------- ESP 对象 ---------- */

EspClass ESP;
uint32_t EspClass::getHeapSize() { return 320u * 1024u; }
uint32_t EspClass::getFreeHeap() { return esp_get_free_internal_heap_size(); }
uint32_t EspClass::getMinFreeHeap() { return esp_get_free_internal_heap_size() * 3 / 4; }
uint32_t EspClass::getMaxAllocHeap() { return (uint32_t)heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL); }
uint32_t EspClass::getPsramSize() { return (uint32_t)heap_caps_get_total_size(MALLOC_CAP_SPIRAM); }
uint32_t EspClass::getFreePsram() { return (uint32_t)heap_caps_get_free_size(MALLOC_CAP_SPIRAM); }
uint32_t EspClass::getMinFreePsram() { return getFreePsram() * 3 / 4; }
uint32_t EspClass::getMaxAllocPsram() { return getFreePsram() / 2; }
uint16_t EspClass::getChipRevision() { return 2; }
const char* EspClass::getChipModel() { return "ESP32-S3"; }
uint8_t EspClass::getChipCores() { return 2; }
uint32_t EspClass::getCpuFreqMHz() { return 240; }
uint32_t EspClass::getCycleCount() { return (uint32_t)(micros() * 240u); }
const char* EspClass::getSdkVersion() { return esp_get_idf_version(); }
const char* EspClass::getCoreVersion() { return "3.3.2"; }
uint32_t EspClass::getFlashChipSize() { return 16u * 1024u * 1024u; }
uint32_t EspClass::getFlashChipSpeed() { return 80000000u; }
uint32_t EspClass::getSketchSize() { return 2u * 1024u * 1024u; }
uint32_t EspClass::getFreeSketchSpace() { return 4u * 1024u * 1024u; }
String EspClass::getSketchMD5() { return String("00000000000000000000000000000000"); }
uint64_t EspClass::getEfuseMac() {
  uint8_t mac[6];
  esp_efuse_mac_get_default(mac);
  uint64_t v = 0;
  for (int i = 5; i >= 0; i--) v = (v << 8) | mac[i];
  return v;
}
void EspClass::restart() { esp_restart(); }
void EspClass::deepSleep(uint64_t us) { esp_deep_sleep(us); }
