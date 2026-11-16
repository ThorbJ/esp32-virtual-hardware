/* 睡眠：浅睡 = 原地等待；深睡 = 停机（JS 端看到后可重新上电）。 */
#pragma once
#include <stdbool.h>
#include <stdint.h>
#include "esp_err.h"
#ifdef __cplusplus
extern "C" {
#endif
typedef enum {
  ESP_SLEEP_WAKEUP_UNDEFINED, ESP_SLEEP_WAKEUP_ALL, ESP_SLEEP_WAKEUP_EXT0, ESP_SLEEP_WAKEUP_EXT1, ESP_SLEEP_WAKEUP_TIMER,
  ESP_SLEEP_WAKEUP_TOUCHPAD, ESP_SLEEP_WAKEUP_ULP, ESP_SLEEP_WAKEUP_GPIO, ESP_SLEEP_WAKEUP_UART, ESP_SLEEP_WAKEUP_WIFI,
  ESP_SLEEP_WAKEUP_COCPU, ESP_SLEEP_WAKEUP_COCPU_TRAP_TRIG, ESP_SLEEP_WAKEUP_BT,
} esp_sleep_source_t;
typedef esp_sleep_source_t esp_sleep_wakeup_cause_t;
typedef enum { ESP_EXT1_WAKEUP_ANY_LOW = 0, ESP_EXT1_WAKEUP_ANY_HIGH = 1, ESP_EXT1_WAKEUP_ALL_LOW = 0 } esp_sleep_ext1_wakeup_mode_t;
typedef enum { ESP_PD_DOMAIN_RTC_PERIPH, ESP_PD_DOMAIN_RTC_SLOW_MEM, ESP_PD_DOMAIN_RTC_FAST_MEM, ESP_PD_DOMAIN_XTAL, ESP_PD_DOMAIN_MAX } esp_sleep_pd_domain_t;
typedef enum { ESP_PD_OPTION_OFF, ESP_PD_OPTION_ON, ESP_PD_OPTION_AUTO } esp_sleep_pd_option_t;
esp_err_t esp_sleep_enable_timer_wakeup(uint64_t time_in_us);
esp_err_t esp_sleep_enable_ext0_wakeup(int gpio_num, int level);
esp_err_t esp_sleep_enable_ext1_wakeup(uint64_t io_mask, esp_sleep_ext1_wakeup_mode_t mode);
esp_err_t esp_sleep_disable_wakeup_source(esp_sleep_source_t source);
esp_err_t esp_sleep_pd_config(esp_sleep_pd_domain_t domain, esp_sleep_pd_option_t option);
esp_sleep_wakeup_cause_t esp_sleep_get_wakeup_cause(void);
void esp_deep_sleep_start(void) __attribute__((noreturn));
void esp_deep_sleep(uint64_t time_in_us) __attribute__((noreturn));
esp_err_t esp_light_sleep_start(void);
#ifdef __cplusplus
}
#endif
