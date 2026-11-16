/*
 * I2S 通道（ESP-IDF 5.x 新驱动）：
 *   录音通道 → 接口麦克风（vdev_mic_read），按采样率实时节拍返回数据（像 DMA 一样），外界没送就补低幅噪声；
 *   放音通道 → 接口喇叭（vdev_speaker_write），按采样率节拍阻塞（像 DMA 缓冲满了一样）。
 * 只支持 16 位样本（两台设备的固件都只用 16 位）。
 * 节拍按虚拟硬件时钟（vhw_clock.h）：虚拟时间下用 vTaskDelay 交出 CPU 等到点，实时下直接睡。
 */
#include <emscripten.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include "driver/i2s_pdm.h"
#include "driver/i2s_std.h"
#include "vdev_io.h"
#include "vhw_clock.h"
#if VHW_VIRTUAL_TIME
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#endif

struct i2s_channel_obj_t {
  i2s_port_t port;
  i2s_dir_t dir;
  i2s_comm_mode_t mode;
  uint32_t desc_num, frame_num;
  uint32_t rate;
  uint32_t channels; /* 每帧声道数（立体声 = 2） */
  int enabled;
  double clock_ms;   /* 录音：下一批数据"到达"的时刻；放音：已排队音频播完的时刻 */
  int16_t* scratch;
  size_t scratch_len;
};

#if VHW_VIRTUAL_TIME
static double now_ms(void) { return (double)vhw_clock_us() / 1000.0; }
static void sleep_until(double t) {
  double d = t - now_ms();
  if (d > 0) vTaskDelay((TickType_t)(d + 0.999)); /* 虚拟时间：阻塞点交出 CPU，时钟才会前进 */
}
#else
static double now_ms(void) { return emscripten_get_now(); }
static void sleep_until(double t) {
  double d = t - now_ms();
  if (d <= 0) return;
  struct timespec ts = {(time_t)(d / 1000), (long)((d - (double)(time_t)(d / 1000) * 1000) * 1e6)};
  nanosleep(&ts, NULL);
}
#endif

esp_err_t i2s_new_channel(const i2s_chan_config_t* cfg, i2s_chan_handle_t* tx, i2s_chan_handle_t* rx) {
  if (!cfg) return ESP_ERR_INVALID_ARG;
  for (int i = 0; i < 2; i++) {
    i2s_chan_handle_t* out = i == 0 ? tx : rx;
    if (!out) continue;
    struct i2s_channel_obj_t* c = calloc(1, sizeof *c);
    if (!c) return ESP_ERR_NO_MEM;
    c->port = cfg->id;
    c->dir = i == 0 ? I2S_DIR_TX : I2S_DIR_RX;
    c->mode = I2S_COMM_MODE_NONE;
    c->desc_num = cfg->dma_desc_num ? cfg->dma_desc_num : 6;
    c->frame_num = cfg->dma_frame_num ? cfg->dma_frame_num : 240;
    c->rate = 16000;
    c->channels = 2;
    *out = c;
  }
  return ESP_OK;
}

esp_err_t i2s_del_channel(i2s_chan_handle_t h) {
  if (!h) return ESP_ERR_INVALID_ARG;
  free(h->scratch);
  free(h);
  return ESP_OK;
}

esp_err_t i2s_channel_init_std_mode(i2s_chan_handle_t h, const i2s_std_config_t* cfg) {
  if (!h || !cfg) return ESP_ERR_INVALID_ARG;
  if (cfg->slot_cfg.data_bit_width != I2S_DATA_BIT_WIDTH_16BIT) return ESP_ERR_NOT_SUPPORTED;
  h->mode = I2S_COMM_MODE_STD;
  h->rate = cfg->clk_cfg.sample_rate_hz;
  h->channels = cfg->slot_cfg.slot_mode == I2S_SLOT_MODE_STEREO ? 2 : 1;
  return ESP_OK;
}
esp_err_t i2s_channel_reconfig_std_clock(i2s_chan_handle_t h, const i2s_std_clk_config_t* clk) {
  if (!h || !clk) return ESP_ERR_INVALID_ARG;
  if (h->enabled) return ESP_ERR_INVALID_STATE;
  h->rate = clk->sample_rate_hz;
  return ESP_OK;
}
esp_err_t i2s_channel_reconfig_std_slot(i2s_chan_handle_t h, const i2s_std_slot_config_t* slot) {
  if (!h || !slot) return ESP_ERR_INVALID_ARG;
  if (h->enabled) return ESP_ERR_INVALID_STATE;
  h->channels = slot->slot_mode == I2S_SLOT_MODE_STEREO ? 2 : 1;
  return ESP_OK;
}
esp_err_t i2s_channel_reconfig_std_gpio(i2s_chan_handle_t h, const i2s_std_gpio_config_t* g) { (void)h; (void)g; return ESP_OK; }

esp_err_t i2s_channel_init_pdm_rx_mode(i2s_chan_handle_t h, const i2s_pdm_rx_config_t* cfg) {
  if (!h || !cfg) return ESP_ERR_INVALID_ARG;
  if (cfg->slot_cfg.data_bit_width != I2S_DATA_BIT_WIDTH_16BIT) return ESP_ERR_NOT_SUPPORTED;
  h->mode = I2S_COMM_MODE_PDM;
  h->rate = cfg->clk_cfg.sample_rate_hz;
  h->channels = cfg->slot_cfg.slot_mode == I2S_SLOT_MODE_STEREO ? 2 : 1;
  vdev_io()->mic_rate = h->rate;
  return ESP_OK;
}
esp_err_t i2s_channel_reconfig_pdm_rx_clock(i2s_chan_handle_t h, const i2s_pdm_rx_clk_config_t* c) {
  if (!h || !c) return ESP_ERR_INVALID_ARG;
  h->rate = c->sample_rate_hz;
  vdev_io()->mic_rate = h->rate;
  return ESP_OK;
}
esp_err_t i2s_channel_reconfig_pdm_rx_slot(i2s_chan_handle_t h, const i2s_pdm_rx_slot_config_t* s) {
  if (!h || !s) return ESP_ERR_INVALID_ARG;
  h->channels = s->slot_mode == I2S_SLOT_MODE_STEREO ? 2 : 1;
  return ESP_OK;
}

esp_err_t i2s_channel_get_info(i2s_chan_handle_t h, i2s_chan_info_t* info) {
  if (!h || !info) return ESP_ERR_INVALID_ARG;
  info->id = h->port;
  info->role = I2S_ROLE_MASTER;
  info->dir = h->dir;
  info->mode = h->mode;
  info->mode_info = NULL;
  info->total_dma_buf_size = h->desc_num * h->frame_num * h->channels * 2;
  return ESP_OK;
}

esp_err_t i2s_channel_enable(i2s_chan_handle_t h) {
  if (!h) return ESP_ERR_INVALID_ARG;
  if (h->enabled) return ESP_ERR_INVALID_STATE;
  h->enabled = 1;
  h->clock_ms = now_ms();
  return ESP_OK;
}
esp_err_t i2s_channel_disable(i2s_chan_handle_t h) {
  if (!h) return ESP_ERR_INVALID_ARG;
  if (!h->enabled) return ESP_ERR_INVALID_STATE;
  h->enabled = 0;
  return ESP_OK;
}

esp_err_t i2s_channel_preload_data(i2s_chan_handle_t h, const void* src, size_t size, size_t* loaded) {
  (void)src;
  if (!h || h->dir != I2S_DIR_TX) return ESP_ERR_INVALID_ARG;
  if (h->enabled) return ESP_ERR_INVALID_STATE;
  if (loaded) *loaded = size;
  return ESP_OK;
}

static double frames_ms(const struct i2s_channel_obj_t* h, size_t frames) { return (double)frames * 1000.0 / (double)(h->rate ? h->rate : 16000); }

esp_err_t i2s_channel_write(i2s_chan_handle_t h, const void* src, size_t size, size_t* written, uint32_t timeout_ms) {
  if (written) *written = 0;
  if (!h || h->dir != I2S_DIR_TX) return ESP_ERR_INVALID_ARG;
  if (!h->enabled) return ESP_ERR_INVALID_STATE;
  const size_t frame_bytes = h->channels * 2;
  const size_t frames = size / frame_bytes;
  const double buffer_ms = frames_ms(h, (size_t)h->desc_num * h->frame_num);
  double now = now_ms();
  if (h->clock_ms < now) h->clock_ms = now;
  /* DMA 缓冲满了就等：最多等 timeout_ms */
  const double must_start_by = h->clock_ms - buffer_ms;
  if (must_start_by > now) {
    if (must_start_by - now > (double)timeout_ms) return ESP_ERR_TIMEOUT;
    sleep_until(must_start_by);
  }
  vdev_speaker_write((const int16_t*)src, frames * h->channels, h->rate, h->channels);
  h->clock_ms += frames_ms(h, frames);
  if (written) *written = frames * frame_bytes;
  return ESP_OK;
}

esp_err_t i2s_channel_read(i2s_chan_handle_t h, void* dest, size_t size, size_t* read, uint32_t timeout_ms) {
  if (read) *read = 0;
  if (!h || h->dir != I2S_DIR_RX) return ESP_ERR_INVALID_ARG;
  if (!h->enabled) return ESP_ERR_INVALID_STATE;
  const size_t frames = size / (h->channels * 2);
  /* 数据"到达"的时刻：上一批之后再过 frames/rate；落后太多（例如调试暂停）就从现在重新计 */
  double now = now_ms();
  if (now - h->clock_ms > 200.0) h->clock_ms = now;
  const double ready_at = h->clock_ms + frames_ms(h, frames);
  if (ready_at - now > (double)timeout_ms + frames_ms(h, frames)) return ESP_ERR_TIMEOUT;
  sleep_until(ready_at);
  h->clock_ms = ready_at;
  if (h->scratch_len < frames) {
    free(h->scratch);
    h->scratch = malloc(frames * sizeof(int16_t));
    h->scratch_len = h->scratch ? frames : 0;
    if (!h->scratch) return ESP_ERR_NO_MEM;
  }
  vdev_mic_read(h->scratch, frames);
  int16_t* out = dest;
  for (size_t i = 0; i < frames; i++)
    for (uint32_t c = 0; c < h->channels; c++) out[i * h->channels + c] = h->scratch[i];
  if (read) *read = frames * h->channels * 2;
  return ESP_OK;
}

esp_err_t i2s_channel_register_event_callback(i2s_chan_handle_t h, const i2s_event_callbacks_t* cbs, void* user) {
  (void)h; (void)cbs; (void)user;
  return ESP_OK;
}
