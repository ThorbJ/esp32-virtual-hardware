/*
 * ESP-IDF USB Serial/JTAG driver -> the virtual device interface's computer byte stream (hostRx / hostTx).
 * Writes go to the computer only while it is there (hostPresent), as with a real USB cable; reads wait on the device clock.
 * Opt-in: a device build adds vhw/idf/usb_serial_jtag.c. The functions are weak, so a device layer may replace them
 * (a board whose USB port is wired to a USB-UART chip uses the UART driver instead).
 */
#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "esp_err.h"
#include "freertos/FreeRTOS.h"
#ifdef __cplusplus
extern "C" {
#endif
typedef struct { uint32_t tx_buffer_size; uint32_t rx_buffer_size; } usb_serial_jtag_driver_config_t;
#define USB_SERIAL_JTAG_DRIVER_CONFIG_DEFAULT() { .tx_buffer_size = 256, .rx_buffer_size = 256 }
esp_err_t usb_serial_jtag_driver_install(usb_serial_jtag_driver_config_t* cfg);
esp_err_t usb_serial_jtag_driver_uninstall(void);
bool usb_serial_jtag_is_driver_installed(void);
bool usb_serial_jtag_is_connected(void);
int usb_serial_jtag_read_bytes(void* buf, uint32_t length, TickType_t ticks_to_wait);
int usb_serial_jtag_write_bytes(const void* src, size_t size, TickType_t ticks_to_wait);
esp_err_t usb_serial_jtag_wait_tx_done(TickType_t ticks_to_wait);
#ifdef __cplusplus
}
#endif
