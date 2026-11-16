/* I2S 新版通道驱动（ESP-IDF 5.x）的类型。录音通道接接口的麦克风，放音通道接喇叭。 */
#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "esp_err.h"
#include "soc/gpio_num.h"
#include "freertos/FreeRTOS.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef enum { I2S_NUM_0 = 0, I2S_NUM_1 = 1, I2S_NUM_MAX, I2S_NUM_AUTO } i2s_port_t;
typedef enum { I2S_ROLE_MASTER, I2S_ROLE_SLAVE } i2s_role_t;
typedef enum { I2S_DATA_BIT_WIDTH_8BIT = 8, I2S_DATA_BIT_WIDTH_16BIT = 16, I2S_DATA_BIT_WIDTH_24BIT = 24, I2S_DATA_BIT_WIDTH_32BIT = 32 } i2s_data_bit_width_t;
typedef enum { I2S_SLOT_BIT_WIDTH_AUTO = 0, I2S_SLOT_BIT_WIDTH_8BIT = 8, I2S_SLOT_BIT_WIDTH_16BIT = 16, I2S_SLOT_BIT_WIDTH_24BIT = 24, I2S_SLOT_BIT_WIDTH_32BIT = 32 } i2s_slot_bit_width_t;
typedef enum { I2S_SLOT_MODE_MONO = 1, I2S_SLOT_MODE_STEREO = 2 } i2s_slot_mode_t;
typedef enum { I2S_DIR_RX = 1, I2S_DIR_TX = 2 } i2s_dir_t;
typedef enum { I2S_COMM_MODE_STD, I2S_COMM_MODE_PDM, I2S_COMM_MODE_TDM, I2S_COMM_MODE_NONE } i2s_comm_mode_t;
typedef enum { I2S_MCLK_MULTIPLE_128 = 128, I2S_MCLK_MULTIPLE_256 = 256, I2S_MCLK_MULTIPLE_384 = 384, I2S_MCLK_MULTIPLE_512 = 512 } i2s_mclk_multiple_t;
typedef int i2s_clock_src_t;
#define I2S_CLK_SRC_DEFAULT 0
#define I2S_CLK_SRC_APLL 1
#define I2S_CLK_SRC_XTAL 2
#define I2S_CLK_SRC_PLL_160M 3

typedef struct i2s_channel_obj_t* i2s_chan_handle_t;
#define auto_clear auto_clear_after_cb /* IDF 5.x 旧字段名 */

typedef struct {
  i2s_port_t id;
  i2s_role_t role;
  uint32_t dma_desc_num;
  uint32_t dma_frame_num;
  bool auto_clear_after_cb;
  bool auto_clear_before_cb;
  bool allow_pd;
  int intr_priority;
} i2s_chan_config_t;

#define I2S_CHANNEL_DEFAULT_CONFIG(i2s_num, i2s_role) { \
    .id = (i2s_num), .role = (i2s_role), .dma_desc_num = 6, .dma_frame_num = 240, \
    .auto_clear_after_cb = false, .auto_clear_before_cb = false, .allow_pd = false, .intr_priority = 0, }

typedef struct {
  i2s_port_t id;
  i2s_role_t role;
  i2s_dir_t dir;
  i2s_comm_mode_t mode;
  void* mode_info;
  uint32_t total_dma_buf_size;
} i2s_chan_info_t;

typedef struct { int dummy; } i2s_event_data_t;
typedef bool (*i2s_isr_callback_t)(i2s_chan_handle_t handle, i2s_event_data_t* event, void* user_ctx);
typedef struct { i2s_isr_callback_t on_recv, on_recv_q_ovf, on_sent, on_send_q_ovf; } i2s_event_callbacks_t;

esp_err_t i2s_new_channel(const i2s_chan_config_t* cfg, i2s_chan_handle_t* tx, i2s_chan_handle_t* rx);
esp_err_t i2s_del_channel(i2s_chan_handle_t h);
esp_err_t i2s_channel_get_info(i2s_chan_handle_t h, i2s_chan_info_t* info);
esp_err_t i2s_channel_enable(i2s_chan_handle_t h);
esp_err_t i2s_channel_disable(i2s_chan_handle_t h);
esp_err_t i2s_channel_preload_data(i2s_chan_handle_t h, const void* src, size_t size, size_t* loaded);
esp_err_t i2s_channel_write(i2s_chan_handle_t h, const void* src, size_t size, size_t* written, uint32_t timeout_ms);
esp_err_t i2s_channel_read(i2s_chan_handle_t h, void* dest, size_t size, size_t* read, uint32_t timeout_ms);
esp_err_t i2s_channel_register_event_callback(i2s_chan_handle_t h, const i2s_event_callbacks_t* cbs, void* user);

#ifdef __cplusplus
}
#endif
