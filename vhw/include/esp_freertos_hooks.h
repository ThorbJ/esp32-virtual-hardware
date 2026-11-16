#pragma once
#include "esp_err.h"
#include "freertos/FreeRTOS.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef bool (*esp_freertos_idle_cb_t)(void);
typedef void (*esp_freertos_tick_cb_t)(void);
/* 浏览器里没有"空闲任务"：注册成功但不会被调用（只用于 CPU 占用统计）。 */
static inline esp_err_t esp_register_freertos_idle_hook_for_cpu(esp_freertos_idle_cb_t cb, UBaseType_t cpu) { (void)cb; (void)cpu; return ESP_OK; }
static inline esp_err_t esp_register_freertos_idle_hook(esp_freertos_idle_cb_t cb) { (void)cb; return ESP_OK; }
static inline esp_err_t esp_register_freertos_tick_hook_for_cpu(esp_freertos_tick_cb_t cb, UBaseType_t cpu) { (void)cb; (void)cpu; return ESP_OK; }
static inline void esp_deregister_freertos_idle_hook_for_cpu(esp_freertos_idle_cb_t cb, UBaseType_t cpu) { (void)cb; (void)cpu; }

#ifdef __cplusplus
}
#endif
