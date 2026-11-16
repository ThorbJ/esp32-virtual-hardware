#pragma once
#include "driver/i2s_types.h"
#ifdef __cplusplus
extern "C" {
#endif

typedef enum { I2S_PDM_SLOT_RIGHT = 1, I2S_PDM_SLOT_LEFT = 2, I2S_PDM_SLOT_BOTH = 3 } i2s_pdm_slot_mask_t;
typedef enum { I2S_PDM_DSR_8S = 0, I2S_PDM_DSR_16S, I2S_PDM_DSR_MAX } i2s_pdm_dsr_t;

typedef struct {
  i2s_data_bit_width_t data_bit_width;
  i2s_slot_bit_width_t slot_bit_width;
  i2s_slot_mode_t slot_mode;
  i2s_pdm_slot_mask_t slot_mask;
  bool hp_en;
  float hp_cut_off_freq_hz;
  uint32_t amplify_num;
} i2s_pdm_rx_slot_config_t;

typedef struct {
  uint32_t sample_rate_hz;
  i2s_clock_src_t clk_src;
  i2s_mclk_multiple_t mclk_multiple;
  i2s_pdm_dsr_t dn_sample_mode;
  uint32_t bclk_div;
} i2s_pdm_rx_clk_config_t;

typedef struct {
  gpio_num_t clk;
  union { gpio_num_t din; gpio_num_t dins[4]; };
  struct { uint32_t clk_inv : 1; } invert_flags;
} i2s_pdm_rx_gpio_config_t;

typedef struct {
  i2s_pdm_rx_clk_config_t clk_cfg;
  i2s_pdm_rx_slot_config_t slot_cfg;
  i2s_pdm_rx_gpio_config_t gpio_cfg;
} i2s_pdm_rx_config_t;

#define I2S_PDM_RX_SLOT_DEFAULT_CONFIG(bits, mode) { .data_bit_width = (i2s_data_bit_width_t)(bits), .slot_bit_width = I2S_SLOT_BIT_WIDTH_AUTO, .slot_mode = (mode), .slot_mask = I2S_PDM_SLOT_LEFT, .hp_en = true, .hp_cut_off_freq_hz = 35.5f, .amplify_num = 1 }
#define I2S_PDM_RX_SLOT_PCM_FMT_DEFAULT_CONFIG(bits, mode) I2S_PDM_RX_SLOT_DEFAULT_CONFIG(bits, mode)
#define I2S_PDM_RX_CLK_DEFAULT_CONFIG(rate) { .sample_rate_hz = (rate), .clk_src = I2S_CLK_SRC_DEFAULT, .mclk_multiple = I2S_MCLK_MULTIPLE_256, .dn_sample_mode = I2S_PDM_DSR_8S, .bclk_div = 8 }

esp_err_t i2s_channel_init_pdm_rx_mode(i2s_chan_handle_t h, const i2s_pdm_rx_config_t* cfg);
esp_err_t i2s_channel_reconfig_pdm_rx_clock(i2s_chan_handle_t h, const i2s_pdm_rx_clk_config_t* clk);
esp_err_t i2s_channel_reconfig_pdm_rx_slot(i2s_chan_handle_t h, const i2s_pdm_rx_slot_config_t* slot);

#ifdef __cplusplus
}
#endif
