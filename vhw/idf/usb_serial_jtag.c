/* ESP-IDF USB Serial/JTAG -> computer byte stream. See include/driver/usb_serial_jtag.h. */
#include "driver/usb_serial_jtag.h"
#include "freertos/task.h"
#include "vdev_io.h"

static bool s_installed;

__attribute__((weak)) esp_err_t usb_serial_jtag_driver_install(usb_serial_jtag_driver_config_t* cfg) { (void)cfg; s_installed = true; return ESP_OK; }
__attribute__((weak)) esp_err_t usb_serial_jtag_driver_uninstall(void) { s_installed = false; return ESP_OK; }
__attribute__((weak)) bool usb_serial_jtag_is_driver_installed(void) { return s_installed; }
__attribute__((weak)) bool usb_serial_jtag_is_connected(void) { return __atomic_load_n(&vdev_io()->host_present, __ATOMIC_ACQUIRE) != 0; }

/* Waits up to ticks_to_wait (1 tick = 1 ms of device time), checking every millisecond. */
__attribute__((weak)) int usb_serial_jtag_read_bytes(void* buf, uint32_t len, TickType_t wait) {
  if (!s_installed || !buf) return -1;
  size_t n = vdev_ring_read(VDEV_RING_HOST_RX, buf, len);
  for (TickType_t waited = 0; n == 0 && waited < wait; waited++) {
    vTaskDelay(1);
    n = vdev_ring_read(VDEV_RING_HOST_RX, buf, len);
  }
  return (int)n;
}
__attribute__((weak)) int usb_serial_jtag_write_bytes(const void* src, size_t size, TickType_t wait) {
  if (!s_installed || !src) return -1;
  vdev_host_write(src, size, (uint32_t)wait);
  return (int)size;
}
__attribute__((weak)) esp_err_t usb_serial_jtag_wait_tx_done(TickType_t wait) { (void)wait; return ESP_OK; }
