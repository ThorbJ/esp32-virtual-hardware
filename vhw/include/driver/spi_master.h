/*
 * ESP-IDF spi_master -> virtual SPI bus (vhw_spi.h). Enough for screen drivers that send commands and pixels:
 * transactions are written to the bus at once (no DMA, no queue), pre_cb / post_cb run around each one
 * (screen drivers set the DC pin there), and the CS pin goes low for the transaction and high afterwards.
 * Reads return zeros: there is no peripheral that answers on the virtual bus.
 * Opt-in: a device build adds vhw/idf/spi_master.c. The functions are weak, so a device layer may replace them.
 */
#pragma once
#include <stddef.h>
#include <stdint.h>
#include "esp_err.h"
#include "freertos/FreeRTOS.h"
#ifdef __cplusplus
extern "C" {
#endif

typedef int spi_host_device_t;
#define SPI1_HOST 0
#define SPI2_HOST 1
#define SPI3_HOST 2
#define SPI_DMA_DISABLED 0
#define SPI_DMA_CH_AUTO 3

#define SPI_TRANS_USE_RXDATA (1 << 2)
#define SPI_TRANS_USE_TXDATA (1 << 3)

typedef struct {
  int mosi_io_num, miso_io_num, sclk_io_num, quadwp_io_num, quadhd_io_num;
  int max_transfer_sz;
  uint32_t flags;
  int intr_flags;
} spi_bus_config_t;

struct spi_transaction_t;
typedef void (*transaction_cb_t)(struct spi_transaction_t* trans);

typedef struct {
  uint8_t command_bits, address_bits, dummy_bits, mode;
  uint16_t duty_cycle_pos, cs_ena_pretrans;
  uint8_t cs_ena_posttrans;
  int clock_speed_hz;
  int input_delay_ns;
  int spics_io_num;
  uint32_t flags;
  int queue_size;
  transaction_cb_t pre_cb;
  transaction_cb_t post_cb;
} spi_device_interface_config_t;

typedef struct spi_transaction_t {
  uint32_t flags;
  uint16_t cmd;
  uint64_t addr;
  size_t length;   /* bits to send */
  size_t rxlength; /* bits to receive (0 = same as length) */
  void* user;
  union { const void* tx_buffer; uint8_t tx_data[4]; };
  union { void* rx_buffer; uint8_t rx_data[4]; };
} spi_transaction_t;

typedef struct vhw_spi_handle* spi_device_handle_t;

esp_err_t spi_bus_initialize(spi_host_device_t host, const spi_bus_config_t* cfg, int dma_chan);
esp_err_t spi_bus_free(spi_host_device_t host);
esp_err_t spi_bus_add_device(spi_host_device_t host, const spi_device_interface_config_t* cfg, spi_device_handle_t* handle);
esp_err_t spi_bus_remove_device(spi_device_handle_t handle);
esp_err_t spi_device_transmit(spi_device_handle_t handle, spi_transaction_t* trans);
esp_err_t spi_device_polling_transmit(spi_device_handle_t handle, spi_transaction_t* trans);
esp_err_t spi_device_queue_trans(spi_device_handle_t handle, spi_transaction_t* trans, TickType_t ticks_to_wait);
esp_err_t spi_device_get_trans_result(spi_device_handle_t handle, spi_transaction_t** trans, TickType_t ticks_to_wait);
esp_err_t spi_device_acquire_bus(spi_device_handle_t handle, TickType_t wait);
void spi_device_release_bus(spi_device_handle_t handle);

#ifdef __cplusplus
}
#endif
