/*
 * Test device firmware: a tiny ESP-IDF application written only against ESP-IDF APIs (spi_master, gpio, ledc,
 * usb_serial_jtag, FreeRTOS, esp_log), built with the shared virtual hardware exactly as a real device's firmware is.
 * It is the fixture for tests of the web runtime, the storefront page and the back office checker.
 *
 *   Screen: ST7789 on SPI (CS 10, DC 8), 160×128 window. A new frame every 100 ms: background (blue, or orange after a
 *           button press), a white square moving left to right, the frame number as 8 cells across the top
 *           (lit = 1, most significant bit on the left) and one green cell per button press along the bottom.
 *   Button: GPIO 0 (BOOT), pulled up, low = pressed. Each press flips the background and moves the servo.
 *   Servo:  LEDC channel 0 on GPIO 4, 50 Hz; 90° at boot, then 150°, 30°, 90°, … on each press (500–2500 µs = 0–180°).
 *   USB:    every byte from the computer comes straight back (echo).
 */
#include <stdbool.h>
#include <stdint.h>
#include <string.h>

#include "driver/gpio.h"
#include "driver/ledc.h"
#include "driver/spi_master.h"
#include "driver/usb_serial_jtag.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#define TEST_DEVICE_VERSION "0.1.0"
#define PIN_CS 10
#define PIN_DC 8
#define PIN_BUTTON 0
#define PIN_SERVO 4
#define W 160
#define H 128

static const char* TAG = "test-device";
static spi_device_handle_t s_lcd;
static uint8_t s_fb[W * H * 2]; /* big-endian RGB565, as the panel takes it */
static volatile int s_mode;
static volatile int s_presses;

/* ---------- screen ---------- */

static void lcd_pre(spi_transaction_t* t) { gpio_set_level(PIN_DC, (int)(intptr_t)t->user); }

static void lcd_send(int dc, const uint8_t* data, size_t len) {
  spi_transaction_t t;
  memset(&t, 0, sizeof t);
  t.length = len * 8;
  t.tx_buffer = data;
  t.user = (void*)(intptr_t)dc;
  spi_device_polling_transmit(s_lcd, &t);
}
static void lcd_cmd(uint8_t c, const uint8_t* params, size_t n) {
  lcd_send(0, &c, 1);
  if (n) lcd_send(1, params, n);
}

static void lcd_init(void) {
  gpio_config_t io = {.pin_bit_mask = 1ull << PIN_DC, .mode = GPIO_MODE_OUTPUT};
  gpio_config(&io);
  spi_bus_config_t bus = {.mosi_io_num = 11, .miso_io_num = -1, .sclk_io_num = 12, .quadwp_io_num = -1, .quadhd_io_num = -1, .max_transfer_sz = sizeof s_fb};
  ESP_ERROR_CHECK(spi_bus_initialize(SPI2_HOST, &bus, SPI_DMA_CH_AUTO));
  spi_device_interface_config_t dev = {.clock_speed_hz = 40 * 1000 * 1000, .mode = 0, .spics_io_num = PIN_CS, .queue_size = 4, .pre_cb = lcd_pre};
  ESP_ERROR_CHECK(spi_bus_add_device(SPI2_HOST, &dev, &s_lcd));
  lcd_cmd(0x01, NULL, 0); /* SWRESET */
  vTaskDelay(pdMS_TO_TICKS(120));
  lcd_cmd(0x11, NULL, 0); /* SLPOUT */
  vTaskDelay(pdMS_TO_TICKS(5));
  lcd_cmd(0x3A, (const uint8_t[]){0x55}, 1); /* COLMOD 16 bit */
  lcd_cmd(0x36, (const uint8_t[]){0x00}, 1); /* MADCTL: native scan direction */
  lcd_cmd(0x2A, (const uint8_t[]){0, 0, 0, W - 1}, 4); /* CASET */
  lcd_cmd(0x2B, (const uint8_t[]){0, 0, 0, H - 1}, 4); /* RASET */
  lcd_cmd(0x29, NULL, 0); /* DISPON */
}

static void fill(int x0, int y0, int w, int h, uint16_t c) {
  for (int y = y0; y < y0 + h && y < H; y++)
    for (int x = x0; x < x0 + w && x < W; x++) {
      s_fb[(y * W + x) * 2] = (uint8_t)(c >> 8);
      s_fb[(y * W + x) * 2 + 1] = (uint8_t)c;
    }
}

static void draw_frame(uint32_t n) {
  fill(0, 0, W, H, s_mode ? 0xFC00 /* orange */ : 0x001F /* blue */);
  for (int b = 0; b < 8; b++) fill(4 + b * 19, 4, 17, 10, (n >> (7 - b)) & 1 ? 0xFFFF : 0x4208);
  fill((int)((n * 8) % (W - 24)), 52, 24, 24, 0xFFFF);
  for (int i = 0; i < s_presses && i < 15; i++) fill(4 + i * 10, H - 14, 8, 10, 0x07E0);
  lcd_cmd(0x2C, NULL, 0); /* RAMWR: one transaction per frame, so the panel hands over whole frames */
  lcd_send(1, s_fb, sizeof s_fb);
}

static void screen_task(void* arg) {
  (void)arg;
  TickType_t last = xTaskGetTickCount();
  for (uint32_t n = 0;; n++) {
    draw_frame(n);
    xTaskDelayUntil(&last, pdMS_TO_TICKS(100));
  }
}

/* ---------- servo ---------- */

static void servo_write(int deg) {
  const uint32_t us = 500 + (uint32_t)deg * 2000 / 180;
  ledc_set_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_0, us * (1u << 14) / 20000u);
  ledc_update_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_0);
  ESP_LOGI(TAG, "servo %d deg", deg);
}

static void servo_init(void) {
  ledc_timer_config_t t = {.speed_mode = LEDC_LOW_SPEED_MODE, .duty_resolution = LEDC_TIMER_14_BIT, .timer_num = LEDC_TIMER_0, .freq_hz = 50};
  ESP_ERROR_CHECK(ledc_timer_config(&t));
  ledc_channel_config_t c = {.gpio_num = PIN_SERVO, .speed_mode = LEDC_LOW_SPEED_MODE, .channel = LEDC_CHANNEL_0, .timer_sel = LEDC_TIMER_0, .duty = 0};
  ESP_ERROR_CHECK(ledc_channel_config(&c));
  servo_write(90);
}

/* ---------- button ---------- */

static void button_task(void* arg) {
  (void)arg;
  static const int angles[] = {150, 30, 90};
  gpio_config_t io = {.pin_bit_mask = 1ull << PIN_BUTTON, .mode = GPIO_MODE_INPUT, .pull_up_en = GPIO_PULLUP_ENABLE};
  gpio_config(&io);
  int was = 1;
  for (;;) {
    const int now = gpio_get_level(PIN_BUTTON);
    if (was == 1 && now == 0) {
      s_mode = !s_mode;
      s_presses++;
      ESP_LOGI(TAG, "button pressed (%d)", s_presses);
      servo_write(angles[(s_presses - 1) % 3]);
    }
    was = now;
    vTaskDelay(pdMS_TO_TICKS(10));
  }
}

/* ---------- USB echo ---------- */

static void usb_task(void* arg) {
  (void)arg;
  usb_serial_jtag_driver_config_t cfg = USB_SERIAL_JTAG_DRIVER_CONFIG_DEFAULT();
  ESP_ERROR_CHECK(usb_serial_jtag_driver_install(&cfg));
  uint8_t buf[256];
  for (;;) {
    const int n = usb_serial_jtag_read_bytes(buf, sizeof buf, pdMS_TO_TICKS(20));
    if (n > 0) usb_serial_jtag_write_bytes(buf, (size_t)n, pdMS_TO_TICKS(100));
  }
}

void app_main(void) {
  ESP_LOGI(TAG, "boot v%s", TEST_DEVICE_VERSION);
  lcd_init();
  servo_init();
  xTaskCreate(screen_task, "screen", 4096, NULL, 5, NULL);
  xTaskCreate(button_task, "button", 2048, NULL, 6, NULL);
  xTaskCreate(usb_task, "usb", 4096, NULL, 4, NULL);
}
