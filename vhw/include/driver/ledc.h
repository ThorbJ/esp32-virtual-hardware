/* LEDC PWM：记住每个通道的定时器、频率和占空比（固件会回读校验）；占空比变化交给设备专用层（小歪换算成舵机角度）。 */
#pragma once
#include <stdbool.h>
#include <stdint.h>
#include "esp_err.h"
#include "soc/gpio_num.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef enum { LEDC_LOW_SPEED_MODE = 0, LEDC_SPEED_MODE_MAX } ledc_mode_t;
typedef enum { LEDC_TIMER_0 = 0, LEDC_TIMER_1, LEDC_TIMER_2, LEDC_TIMER_3, LEDC_TIMER_MAX } ledc_timer_t;
typedef enum { LEDC_CHANNEL_0 = 0, LEDC_CHANNEL_1, LEDC_CHANNEL_2, LEDC_CHANNEL_3, LEDC_CHANNEL_4, LEDC_CHANNEL_5, LEDC_CHANNEL_6, LEDC_CHANNEL_7, LEDC_CHANNEL_MAX } ledc_channel_t;
typedef enum {
  LEDC_TIMER_1_BIT = 1, LEDC_TIMER_2_BIT, LEDC_TIMER_3_BIT, LEDC_TIMER_4_BIT, LEDC_TIMER_5_BIT, LEDC_TIMER_6_BIT, LEDC_TIMER_7_BIT,
  LEDC_TIMER_8_BIT, LEDC_TIMER_9_BIT, LEDC_TIMER_10_BIT, LEDC_TIMER_11_BIT, LEDC_TIMER_12_BIT, LEDC_TIMER_13_BIT, LEDC_TIMER_14_BIT,
  LEDC_TIMER_BIT_MAX,
} ledc_timer_bit_t;
typedef enum { LEDC_AUTO_CLK = 0, LEDC_USE_APB_CLK, LEDC_USE_RC_FAST_CLK, LEDC_USE_XTAL_CLK } ledc_clk_cfg_t;
typedef enum { LEDC_INTR_DISABLE = 0, LEDC_INTR_FADE_END } ledc_intr_type_t;
typedef enum { LEDC_SLEEP_MODE_NO_ALIVE_NO_PD = 0, LEDC_SLEEP_MODE_NO_ALIVE_ALLOW_PD, LEDC_SLEEP_MODE_KEEP_ALIVE, LEDC_SLEEP_MODE_INVALID } ledc_sleep_mode_t;
typedef enum { LEDC_FADE_NO_WAIT = 0, LEDC_FADE_WAIT_DONE } ledc_fade_mode_t;

typedef struct {
  ledc_mode_t speed_mode;
  ledc_timer_bit_t duty_resolution;
  ledc_timer_t timer_num;
  uint32_t freq_hz;
  ledc_clk_cfg_t clk_cfg;
  bool deconfigure;
} ledc_timer_config_t;

typedef struct {
  int gpio_num;
  ledc_mode_t speed_mode;
  ledc_channel_t channel;
  ledc_intr_type_t intr_type;
  ledc_timer_t timer_sel;
  uint32_t duty;
  int hpoint;
  ledc_sleep_mode_t sleep_mode;
  struct { unsigned int output_invert : 1; } flags;
} ledc_channel_config_t;

esp_err_t ledc_timer_config(const ledc_timer_config_t* cfg);
esp_err_t ledc_channel_config(const ledc_channel_config_t* cfg);
esp_err_t ledc_set_duty(ledc_mode_t mode, ledc_channel_t ch, uint32_t duty);
esp_err_t ledc_set_duty_with_hpoint(ledc_mode_t mode, ledc_channel_t ch, uint32_t duty, uint32_t hpoint);
esp_err_t ledc_update_duty(ledc_mode_t mode, ledc_channel_t ch);
esp_err_t ledc_set_duty_and_update(ledc_mode_t mode, ledc_channel_t ch, uint32_t duty, uint32_t hpoint);
uint32_t ledc_get_duty(ledc_mode_t mode, ledc_channel_t ch);
uint32_t ledc_get_freq(ledc_mode_t mode, ledc_timer_t timer);
esp_err_t ledc_set_freq(ledc_mode_t mode, ledc_timer_t timer, uint32_t freq_hz);
esp_err_t ledc_stop(ledc_mode_t mode, ledc_channel_t ch, uint32_t idle_level);
esp_err_t ledc_timer_pause(ledc_mode_t mode, ledc_timer_t timer);
esp_err_t ledc_timer_resume(ledc_mode_t mode, ledc_timer_t timer);
esp_err_t ledc_timer_rst(ledc_mode_t mode, ledc_timer_t timer);
esp_err_t ledc_fade_func_install(int intr_alloc_flags);
void ledc_fade_func_uninstall(void);
esp_err_t ledc_set_fade_with_time(ledc_mode_t mode, ledc_channel_t ch, uint32_t target_duty, int max_fade_time_ms);
esp_err_t ledc_fade_start(ledc_mode_t mode, ledc_channel_t ch, ledc_fade_mode_t fade_mode);

/* 设备专用层钩子：占空比生效时调用（弱符号，默认什么都不做）。 */
void vhw_ledc_on_duty(int channel, int gpio, uint32_t duty, uint32_t resolution_bits, uint32_t freq_hz);

#ifdef __cplusplus
}
#endif
