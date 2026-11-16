/* ESP-IDF spi_master -> virtual SPI bus. See include/driver/spi_master.h. */
#include <stdlib.h>
#include <string.h>

#include "driver/gpio.h"
#include "driver/spi_master.h"
#include "vhw_spi.h"

struct vhw_spi_handle {
  spi_host_device_t host;
  spi_device_interface_config_t cfg;
  spi_transaction_t* queued[8];
  int head, tail;
};

__attribute__((weak)) esp_err_t spi_bus_initialize(spi_host_device_t host, const spi_bus_config_t* cfg, int dma_chan) {
  (void)host; (void)dma_chan;
  return cfg ? ESP_OK : ESP_ERR_INVALID_ARG;
}
__attribute__((weak)) esp_err_t spi_bus_free(spi_host_device_t host) { (void)host; return ESP_OK; }

__attribute__((weak)) esp_err_t spi_bus_add_device(spi_host_device_t host, const spi_device_interface_config_t* cfg, spi_device_handle_t* handle) {
  if (!cfg || !handle) return ESP_ERR_INVALID_ARG;
  struct vhw_spi_handle* h = calloc(1, sizeof *h);
  if (!h) return ESP_ERR_NO_MEM;
  h->host = host;
  h->cfg = *cfg;
  if (cfg->spics_io_num >= 0) gpio_set_level((gpio_num_t)cfg->spics_io_num, 1);
  *handle = h;
  return ESP_OK;
}
__attribute__((weak)) esp_err_t spi_bus_remove_device(spi_device_handle_t handle) { free(handle); return ESP_OK; }

/* The bus number seen by virtual peripherals (vhw_spi_attach) is the IDF host number. */
__attribute__((weak)) esp_err_t spi_device_polling_transmit(spi_device_handle_t h, spi_transaction_t* t) {
  if (!h || !t) return ESP_ERR_INVALID_ARG;
  if (h->cfg.pre_cb) h->cfg.pre_cb(t);
  const int cs = h->cfg.spics_io_num;
  if (cs >= 0) gpio_set_level((gpio_num_t)cs, 0);
  const size_t bytes = (t->length + 7) / 8;
  if (bytes) vhw_spi_write(h->host, (t->flags & SPI_TRANS_USE_TXDATA) ? t->tx_data : (const uint8_t*)t->tx_buffer, bytes);
  if (t->flags & SPI_TRANS_USE_RXDATA) memset(t->rx_data, 0, sizeof t->rx_data);
  else if (t->rx_buffer) memset(t->rx_buffer, 0, ((t->rxlength ? t->rxlength : t->length) + 7) / 8);
  if (cs >= 0) gpio_set_level((gpio_num_t)cs, 1);
  if (h->cfg.post_cb) h->cfg.post_cb(t);
  return ESP_OK;
}
__attribute__((weak)) esp_err_t spi_device_transmit(spi_device_handle_t h, spi_transaction_t* t) { return spi_device_polling_transmit(h, t); }

/* Queued transactions are carried out at once; get_trans_result hands them back in order. */
__attribute__((weak)) esp_err_t spi_device_queue_trans(spi_device_handle_t h, spi_transaction_t* t, TickType_t wait) {
  (void)wait;
  if (!h || !t) return ESP_ERR_INVALID_ARG;
  if (h->head - h->tail >= 8) return ESP_ERR_TIMEOUT;
  esp_err_t rc = spi_device_polling_transmit(h, t);
  h->queued[h->head++ & 7] = t;
  return rc;
}
__attribute__((weak)) esp_err_t spi_device_get_trans_result(spi_device_handle_t h, spi_transaction_t** t, TickType_t wait) {
  (void)wait;
  if (!h || !t) return ESP_ERR_INVALID_ARG;
  if (h->head == h->tail) return ESP_ERR_TIMEOUT;
  *t = h->queued[h->tail++ & 7];
  return ESP_OK;
}
__attribute__((weak)) esp_err_t spi_device_acquire_bus(spi_device_handle_t h, TickType_t wait) { (void)h; (void)wait; return ESP_OK; }
__attribute__((weak)) void spi_device_release_bus(spi_device_handle_t h) { (void)h; }
