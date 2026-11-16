#pragma once
#include "driver/i2s_types.h"
#ifdef __cplusplus
extern "C" {
#endif

typedef enum { I2S_STD_SLOT_LEFT = 1, I2S_STD_SLOT_RIGHT = 2, I2S_STD_SLOT_BOTH = 3 } i2s_std_slot_mask_t;

typedef struct {
  i2s_data_bit_width_t data_bit_width;
  i2s_slot_bit_width_t slot_bit_width;
  i2s_slot_mode_t slot_mode;
  i2s_std_slot_mask_t slot_mask;
  uint32_t ws_width;
  bool ws_pol;
  bool bit_shift;
  bool left_align;
  bool big_endian;
  bool bit_order_lsb;
} i2s_std_slot_config_t;

typedef struct {
  uint32_t sample_rate_hz;
  i2s_clock_src_t clk_src;
  uint32_t ext_clk_freq_hz;
  i2s_mclk_multiple_t mclk_multiple;
} i2s_std_clk_config_t;

typedef struct {
  gpio_num_t mclk, bclk, ws, dout, din;
  struct { uint32_t mclk_inv : 1; uint32_t bclk_inv : 1; uint32_t ws_inv : 1; } invert_flags;
} i2s_std_gpio_config_t;

typedef struct {
  i2s_std_clk_config_t clk_cfg;
  i2s_std_slot_config_t slot_cfg;
  i2s_std_gpio_config_t gpio_cfg;
} i2s_std_config_t;

#define I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(bits, mode) { \
    .data_bit_width = (i2s_data_bit_width_t)(bits), .slot_bit_width = I2S_SLOT_BIT_WIDTH_AUTO, .slot_mode = (mode), \
    .slot_mask = I2S_STD_SLOT_BOTH, .ws_width = (uint32_t)(bits), .ws_pol = false, .bit_shift = true, \
    .left_align = true, .big_endian = false, .bit_order_lsb = false }
#define I2S_STD_MSB_SLOT_DEFAULT_CONFIG(bits, mode) I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(bits, mode)
#define I2S_STD_PCM_SLOT_DEFAULT_CONFIG(bits, mode) I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(bits, mode)
#define I2S_STD_CLK_DEFAULT_CONFIG(rate) { .sample_rate_hz = (rate), .clk_src = I2S_CLK_SRC_DEFAULT, .ext_clk_freq_hz = 0, .mclk_multiple = I2S_MCLK_MULTIPLE_256 }

esp_err_t i2s_channel_init_std_mode(i2s_chan_handle_t h, const i2s_std_config_t* cfg);
esp_err_t i2s_channel_reconfig_std_clock(i2s_chan_handle_t h, const i2s_std_clk_config_t* clk);
esp_err_t i2s_channel_reconfig_std_slot(i2s_chan_handle_t h, const i2s_std_slot_config_t* slot);
esp_err_t i2s_channel_reconfig_std_gpio(i2s_chan_handle_t h, const i2s_std_gpio_config_t* gpio);

#ifdef __cplusplus
}
#endif
