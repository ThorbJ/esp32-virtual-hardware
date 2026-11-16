/*
 * The test device's board, the only device-specific virtual hardware: which pins and buses its firmware uses.
 *   ST7789 on SPI2 (CS 10, DC 8), 240×320 panel memory, a 160×128 window showing;
 *   button 0 of the interface = GPIO 0, low while pressed;
 *   LEDC channel 0 = servo 0, pulse 500–2500 µs = 0–180°.
 */
#include <stdint.h>

#include "vdev_io.h"
#include "vhw_panel_st7789.h"

void vhw_board_init(void) {
  static const vhw_st7789_config_t panel = {
      .spi_bus = 1, /* SPI2_HOST */
      .cs_pin = 10,
      .dc_pin = 8,
      .gram_width = 240,
      .gram_height = 320,
      .visible_x = 0,
      .visible_y = 0,
      .visible_width = 160,
      .visible_height = 128,
      .ips_inverted = 0,
  };
  vhw_st7789_attach(&panel);
}

int vhw_gpio_input_level(int gpio, int last_output_level) {
  if (gpio == 0) return (__atomic_load_n(&vdev_io()->buttons, __ATOMIC_ACQUIRE) & 1u) ? 0 : 1;
  return last_output_level;
}

void vhw_ledc_on_duty(int channel, int gpio, uint32_t duty, uint32_t bits, uint32_t freq_hz) {
  (void)gpio;
  if (channel != 0 || freq_hz == 0 || bits == 0) return;
  const double period_us = 1e6 / (double)freq_hz;
  const uint32_t pulse_us = (uint32_t)((double)duty * period_us / (double)(1u << bits) + 0.5);
  if (duty == 0) { vdev_servo_emit(0, 0, 0); return; }
  const double deg = ((double)pulse_us - 500.0) / 2000.0 * 180.0;
  vdev_servo_emit(0, (int32_t)(deg * 1000.0 + (deg >= 0 ? 0.5 : -0.5)), pulse_us);
}
