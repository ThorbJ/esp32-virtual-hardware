/* GPIO 电平表 + 虚拟 SPI 总线分发。 */
#include <pthread.h>
#include <string.h>

#include "driver/gpio.h"
#include "vhw_spi.h"

static volatile int s_out_level[VHW_GPIO_COUNT];
static volatile int s_mode[VHW_GPIO_COUNT];

__attribute__((weak)) void vhw_gpio_on_output(int gpio, int level) { (void)gpio; (void)level; }
__attribute__((weak)) int vhw_gpio_input_level(int gpio, int last_output_level) { (void)gpio; return last_output_level; }

int vhw_gpio_output_level(int gpio) { return gpio >= 0 && gpio < VHW_GPIO_COUNT ? s_out_level[gpio] : 0; }

esp_err_t gpio_set_level(gpio_num_t gpio, uint32_t level) {
  if (gpio < 0 || gpio >= VHW_GPIO_COUNT) return ESP_ERR_INVALID_ARG;
  int l = level ? 1 : 0;
  int changed = s_out_level[gpio] != l;
  s_out_level[gpio] = l;
  if (changed) {
    vhw_spi_on_gpio(gpio, l);
    vhw_gpio_on_output(gpio, l);
  }
  return ESP_OK;
}

int gpio_get_level(gpio_num_t gpio) {
  if (gpio < 0 || gpio >= VHW_GPIO_COUNT) return 0;
  return vhw_gpio_input_level(gpio, s_out_level[gpio]);
}

esp_err_t gpio_config(const gpio_config_t* cfg) {
  for (int i = 0; i < VHW_GPIO_COUNT; i++)
    if (cfg->pin_bit_mask & (1ull << i)) s_mode[i] = cfg->mode;
  return ESP_OK;
}
esp_err_t gpio_reset_pin(gpio_num_t g) { if (g >= 0 && g < VHW_GPIO_COUNT) s_mode[g] = GPIO_MODE_DISABLE; return ESP_OK; }
esp_err_t gpio_set_direction(gpio_num_t g, gpio_mode_t m) { if (g >= 0 && g < VHW_GPIO_COUNT) s_mode[g] = m; return ESP_OK; }
esp_err_t gpio_set_pull_mode(gpio_num_t g, gpio_pull_mode_t p) { (void)g; (void)p; return ESP_OK; }
esp_err_t gpio_pullup_en(gpio_num_t g) { (void)g; return ESP_OK; }
esp_err_t gpio_pullup_dis(gpio_num_t g) { (void)g; return ESP_OK; }
esp_err_t gpio_pulldown_en(gpio_num_t g) { (void)g; return ESP_OK; }
esp_err_t gpio_pulldown_dis(gpio_num_t g) { (void)g; return ESP_OK; }
esp_err_t gpio_set_intr_type(gpio_num_t g, gpio_int_type_t t) { (void)g; (void)t; return ESP_OK; }
esp_err_t gpio_intr_enable(gpio_num_t g) { (void)g; return ESP_OK; }
esp_err_t gpio_intr_disable(gpio_num_t g) { (void)g; return ESP_OK; }
esp_err_t gpio_install_isr_service(int f) { (void)f; return ESP_OK; }
void gpio_uninstall_isr_service(void) {}
esp_err_t gpio_isr_handler_add(gpio_num_t g, gpio_isr_t isr, void* arg) { (void)g; (void)isr; (void)arg; return ESP_OK; }
esp_err_t gpio_isr_handler_remove(gpio_num_t g) { (void)g; return ESP_OK; }
esp_err_t gpio_set_drive_capability(gpio_num_t g, gpio_drive_cap_t s) { (void)g; (void)s; return ESP_OK; }
esp_err_t gpio_hold_en(gpio_num_t g) { (void)g; return ESP_OK; }
esp_err_t gpio_hold_dis(gpio_num_t g) { (void)g; return ESP_OK; }
void gpio_deep_sleep_hold_en(void) {}
void gpio_deep_sleep_hold_dis(void) {}

/* ---------- SPI 总线 ---------- */

#define MAX_SPI_DEVICES 8
static vhw_spi_device_t* s_dev[MAX_SPI_DEVICES];
static int s_dev_bus[MAX_SPI_DEVICES];
static int s_dev_count;

void vhw_spi_attach(int bus, vhw_spi_device_t* dev) {
  if (s_dev_count < MAX_SPI_DEVICES) {
    s_dev_bus[s_dev_count] = bus;
    s_dev[s_dev_count++] = dev;
  }
  /* 片选默认高（未选中） */
  if (dev->cs_pin >= 0 && dev->cs_pin < VHW_GPIO_COUNT) s_out_level[dev->cs_pin] = 1;
}

void vhw_spi_write(int bus, const uint8_t* data, size_t len) {
  for (int i = 0; i < s_dev_count; i++) {
    vhw_spi_device_t* d = s_dev[i];
    if (s_dev_bus[i] != bus) continue;
    if (d->cs_pin < 0 || s_out_level[d->cs_pin] == 0) d->on_bytes(d->ctx, data, len);
  }
}

void vhw_spi_on_gpio(int gpio, int level) {
  for (int i = 0; i < s_dev_count; i++)
    if (s_dev[i]->cs_pin == gpio && s_dev[i]->on_cs) s_dev[i]->on_cs(s_dev[i]->ctx, level);
}
