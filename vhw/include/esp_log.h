/* ESP-IDF 日志 → 虚拟设备接口的日志通道。 */
#pragma once
#include <stdarg.h>
#include <stdint.h>
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef enum { ESP_LOG_NONE, ESP_LOG_ERROR, ESP_LOG_WARN, ESP_LOG_INFO, ESP_LOG_DEBUG, ESP_LOG_VERBOSE } esp_log_level_t;
typedef int (*vprintf_like_t)(const char*, va_list);

void esp_log_level_set(const char* tag, esp_log_level_t level);
esp_log_level_t esp_log_level_get(const char* tag);
vprintf_like_t esp_log_set_vprintf(vprintf_like_t func);
uint32_t esp_log_timestamp(void);
uint32_t esp_log_early_timestamp(void);
void esp_log_write(esp_log_level_t level, const char* tag, const char* fmt, ...) __attribute__((format(printf, 3, 4)));
void esp_log_writev(esp_log_level_t level, const char* tag, const char* fmt, va_list args);

#ifndef LOG_LOCAL_LEVEL
#define LOG_LOCAL_LEVEL ESP_LOG_INFO
#endif
#define VHW_LOG(lvl, ch, tag, fmt, ...) do { if ((lvl) <= LOG_LOCAL_LEVEL) esp_log_write((lvl), (tag), ch " (%u) %s: " fmt "\n", (unsigned)esp_log_timestamp(), (tag), ##__VA_ARGS__); } while (0)
#define ESP_LOGE(tag, fmt, ...) VHW_LOG(ESP_LOG_ERROR, "E", tag, fmt, ##__VA_ARGS__)
#define ESP_LOGW(tag, fmt, ...) VHW_LOG(ESP_LOG_WARN, "W", tag, fmt, ##__VA_ARGS__)
#define ESP_LOGI(tag, fmt, ...) VHW_LOG(ESP_LOG_INFO, "I", tag, fmt, ##__VA_ARGS__)
#define ESP_LOGD(tag, fmt, ...) VHW_LOG(ESP_LOG_DEBUG, "D", tag, fmt, ##__VA_ARGS__)
#define ESP_LOGV(tag, fmt, ...) VHW_LOG(ESP_LOG_VERBOSE, "V", tag, fmt, ##__VA_ARGS__)
#define ESP_EARLY_LOGE ESP_LOGE
#define ESP_EARLY_LOGW ESP_LOGW
#define ESP_EARLY_LOGI ESP_LOGI
#define ESP_EARLY_LOGD ESP_LOGD
#define ESP_EARLY_LOGV ESP_LOGV
#define ESP_DRAM_LOGE ESP_LOGE
#define ESP_DRAM_LOGW ESP_LOGW
#define ESP_DRAM_LOGI ESP_LOGI
#define ESP_LOG_LEVEL(lvl, tag, fmt, ...) VHW_LOG(lvl, "I", tag, fmt, ##__VA_ARGS__)
#define ESP_LOG_LEVEL_LOCAL(lvl, tag, fmt, ...) VHW_LOG(lvl, "I", tag, fmt, ##__VA_ARGS__)
#define ESP_LOG_BUFFER_HEX(tag, buf, len) ((void)0)
#define ESP_LOG_BUFFER_HEXDUMP(tag, buf, len, lvl) ((void)0)
#define ESP_LOG_BUFFER_HEX_LEVEL(tag, buf, len, lvl) ((void)0)
#define ESP_LOG_BUFFER_CHAR(tag, buf, len) ((void)0)

#ifdef __cplusplus
}
#endif
