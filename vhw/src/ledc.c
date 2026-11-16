/* LEDC PWM：记住定时器 / 通道配置和占空比；占空比生效时通知设备专用层（vhw_ledc_on_duty）。 */
#include <string.h>

#include "driver/ledc.h"

typedef struct { uint32_t freq_hz; uint32_t bits; int configured; } timer_t_;
typedef struct { int gpio; ledc_timer_t timer; uint32_t duty_pending; uint32_t duty; int configured; } chan_t_;

static timer_t_ s_timer[LEDC_TIMER_MAX];
static chan_t_ s_chan[LEDC_CHANNEL_MAX];

__attribute__((weak)) void vhw_ledc_on_duty(int channel, int gpio, uint32_t duty, uint32_t bits, uint32_t freq) {
  (void)channel; (void)gpio; (void)duty; (void)bits; (void)freq;
}

static void apply(ledc_channel_t ch) {
  chan_t_* c = &s_chan[ch];
  c->duty = c->duty_pending;
  const timer_t_* t = &s_timer[c->timer];
  vhw_ledc_on_duty((int)ch, c->gpio, c->duty, t->bits, t->freq_hz);
}

esp_err_t ledc_timer_config(const ledc_timer_config_t* cfg) {
  if (!cfg || cfg->timer_num >= LEDC_TIMER_MAX) return ESP_ERR_INVALID_ARG;
  s_timer[cfg->timer_num] = (timer_t_){cfg->freq_hz, (uint32_t)cfg->duty_resolution, !cfg->deconfigure};
  return ESP_OK;
}

esp_err_t ledc_channel_config(const ledc_channel_config_t* cfg) {
  if (!cfg || cfg->channel >= LEDC_CHANNEL_MAX) return ESP_ERR_INVALID_ARG;
  s_chan[cfg->channel] = (chan_t_){cfg->gpio_num, cfg->timer_sel, cfg->duty, cfg->duty, 1};
  apply(cfg->channel);
  return ESP_OK;
}

esp_err_t ledc_set_duty(ledc_mode_t mode, ledc_channel_t ch, uint32_t duty) {
  (void)mode;
  if (ch >= LEDC_CHANNEL_MAX) return ESP_ERR_INVALID_ARG;
  s_chan[ch].duty_pending = duty;
  return ESP_OK;
}
esp_err_t ledc_set_duty_with_hpoint(ledc_mode_t mode, ledc_channel_t ch, uint32_t duty, uint32_t hpoint) {
  (void)hpoint;
  return ledc_set_duty(mode, ch, duty);
}
esp_err_t ledc_update_duty(ledc_mode_t mode, ledc_channel_t ch) {
  (void)mode;
  if (ch >= LEDC_CHANNEL_MAX || !s_chan[ch].configured) return ESP_ERR_INVALID_STATE;
  apply(ch);
  return ESP_OK;
}
esp_err_t ledc_set_duty_and_update(ledc_mode_t mode, ledc_channel_t ch, uint32_t duty, uint32_t hpoint) {
  (void)hpoint;
  esp_err_t rc = ledc_set_duty(mode, ch, duty);
  return rc == ESP_OK ? ledc_update_duty(mode, ch) : rc;
}
uint32_t ledc_get_duty(ledc_mode_t mode, ledc_channel_t ch) {
  (void)mode;
  return ch < LEDC_CHANNEL_MAX ? s_chan[ch].duty : 0;
}
uint32_t ledc_get_freq(ledc_mode_t mode, ledc_timer_t timer) {
  (void)mode;
  return timer < LEDC_TIMER_MAX ? s_timer[timer].freq_hz : 0;
}
esp_err_t ledc_set_freq(ledc_mode_t mode, ledc_timer_t timer, uint32_t freq) {
  (void)mode;
  if (timer >= LEDC_TIMER_MAX) return ESP_ERR_INVALID_ARG;
  s_timer[timer].freq_hz = freq;
  return ESP_OK;
}
esp_err_t ledc_stop(ledc_mode_t mode, ledc_channel_t ch, uint32_t idle) {
  (void)mode;
  (void)idle;
  if (ch >= LEDC_CHANNEL_MAX) return ESP_ERR_INVALID_ARG;
  s_chan[ch].duty_pending = 0;
  apply(ch);
  return ESP_OK;
}
esp_err_t ledc_timer_pause(ledc_mode_t m, ledc_timer_t t) { (void)m; (void)t; return ESP_OK; }
esp_err_t ledc_timer_resume(ledc_mode_t m, ledc_timer_t t) { (void)m; (void)t; return ESP_OK; }
esp_err_t ledc_timer_rst(ledc_mode_t m, ledc_timer_t t) { (void)m; (void)t; return ESP_OK; }
esp_err_t ledc_fade_func_install(int f) { (void)f; return ESP_OK; }
void ledc_fade_func_uninstall(void) {}
esp_err_t ledc_set_fade_with_time(ledc_mode_t mode, ledc_channel_t ch, uint32_t target, int ms) {
  (void)ms;
  return ledc_set_duty(mode, ch, target);
}
esp_err_t ledc_fade_start(ledc_mode_t mode, ledc_channel_t ch, ledc_fade_mode_t f) {
  (void)f;
  return ledc_update_duty(mode, ch);
}
