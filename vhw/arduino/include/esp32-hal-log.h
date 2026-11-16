/* arduino-esp32 的 log_e / log_i … 宏 → 接口日志通道。 */
#pragma once
#include "esp_log.h"
#ifdef __cplusplus
extern "C" {
#endif
int log_printf(const char* fmt, ...) __attribute__((format(printf, 1, 2)));
unsigned long millis(void);
const char* pathToFileName(const char* path);
#ifdef __cplusplus
}
#endif
#define ARDUHAL_LOG_LEVEL_NONE 0
#define ARDUHAL_LOG_LEVEL_ERROR 1
#define ARDUHAL_LOG_LEVEL_WARN 2
#define ARDUHAL_LOG_LEVEL_INFO 3
#define ARDUHAL_LOG_LEVEL_DEBUG 4
#define ARDUHAL_LOG_LEVEL_VERBOSE 5
#ifndef CORE_DEBUG_LEVEL
#define CORE_DEBUG_LEVEL ARDUHAL_LOG_LEVEL_ERROR
#endif
#define ARDUHAL_LOG_FORMAT(letter, format) "[%6u][" #letter "][%s:%u] %s(): " format "\r\n", (unsigned)millis(), pathToFileName(__FILE__), __LINE__, __FUNCTION__
/* 上游固件自己定义了同名的 log_info 等函数；这里只给 arduino 核心风格的单字母宏 */
#define log_e(format, ...) log_printf(ARDUHAL_LOG_FORMAT(E, format), ##__VA_ARGS__)
#define log_w(format, ...) do { if (CORE_DEBUG_LEVEL >= ARDUHAL_LOG_LEVEL_WARN) log_printf(ARDUHAL_LOG_FORMAT(W, format), ##__VA_ARGS__); } while (0)
#define log_i(format, ...) do { if (CORE_DEBUG_LEVEL >= ARDUHAL_LOG_LEVEL_INFO) log_printf(ARDUHAL_LOG_FORMAT(I, format), ##__VA_ARGS__); } while (0)
#define log_d(format, ...) do { if (CORE_DEBUG_LEVEL >= ARDUHAL_LOG_LEVEL_DEBUG) log_printf(ARDUHAL_LOG_FORMAT(D, format), ##__VA_ARGS__); } while (0)
#define log_v(format, ...) do { if (CORE_DEBUG_LEVEL >= ARDUHAL_LOG_LEVEL_VERBOSE) log_printf(ARDUHAL_LOG_FORMAT(V, format), ##__VA_ARGS__); } while (0)
#define isr_log_e log_e
#define isr_log_w log_w
#define isr_log_i log_i
#define isr_log_d log_d
#define isr_log_v log_v
#define log_n log_e
#define log_buf_e(b, l) ((void)0)
#define log_buf_w(b, l) ((void)0)
#define log_buf_i(b, l) ((void)0)
#define log_buf_d(b, l) ((void)0)
#define log_buf_v(b, l) ((void)0)
