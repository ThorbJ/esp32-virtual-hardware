/* GPIO：记住每个脚的方向和电平（固件会回读校验，例如功放使能脚）；输入脚的电平可由设备专用层提供（按键等）。 */
#pragma once
#include <stdbool.h>
#include <stdint.h>
#include "esp_err.h"
#include "esp_attr.h"
#include "soc/gpio_num.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef enum { GPIO_MODE_DISABLE = 0, GPIO_MODE_INPUT = 1, GPIO_MODE_OUTPUT = 2, GPIO_MODE_OUTPUT_OD = 6, GPIO_MODE_INPUT_OUTPUT_OD = 7, GPIO_MODE_INPUT_OUTPUT = 3 } gpio_mode_t;
typedef enum { GPIO_PULLUP_DISABLE = 0, GPIO_PULLUP_ENABLE = 1 } gpio_pullup_t;
typedef enum { GPIO_PULLDOWN_DISABLE = 0, GPIO_PULLDOWN_ENABLE = 1 } gpio_pulldown_t;
typedef enum { GPIO_PULLUP_ONLY, GPIO_PULLDOWN_ONLY, GPIO_PULLUP_PULLDOWN, GPIO_FLOATING } gpio_pull_mode_t;
typedef enum { GPIO_INTR_DISABLE = 0, GPIO_INTR_POSEDGE, GPIO_INTR_NEGEDGE, GPIO_INTR_ANYEDGE, GPIO_INTR_LOW_LEVEL, GPIO_INTR_HIGH_LEVEL, GPIO_INTR_MAX } gpio_int_type_t;
typedef enum { GPIO_DRIVE_CAP_0, GPIO_DRIVE_CAP_1, GPIO_DRIVE_CAP_2, GPIO_DRIVE_CAP_DEFAULT = 2, GPIO_DRIVE_CAP_3, GPIO_DRIVE_CAP_MAX } gpio_drive_cap_t;
typedef void (*gpio_isr_t)(void* arg);
typedef struct {
  uint64_t pin_bit_mask;
  gpio_mode_t mode;
  gpio_pullup_t pull_up_en;
  gpio_pulldown_t pull_down_en;
  gpio_int_type_t intr_type;
} gpio_config_t;

esp_err_t gpio_config(const gpio_config_t* cfg);
esp_err_t gpio_reset_pin(gpio_num_t gpio);
esp_err_t gpio_set_direction(gpio_num_t gpio, gpio_mode_t mode);
esp_err_t gpio_set_level(gpio_num_t gpio, uint32_t level);
int gpio_get_level(gpio_num_t gpio);
esp_err_t gpio_set_pull_mode(gpio_num_t gpio, gpio_pull_mode_t pull);
esp_err_t gpio_pullup_en(gpio_num_t gpio);
esp_err_t gpio_pullup_dis(gpio_num_t gpio);
esp_err_t gpio_pulldown_en(gpio_num_t gpio);
esp_err_t gpio_pulldown_dis(gpio_num_t gpio);
esp_err_t gpio_set_intr_type(gpio_num_t gpio, gpio_int_type_t t);
esp_err_t gpio_intr_enable(gpio_num_t gpio);
esp_err_t gpio_intr_disable(gpio_num_t gpio);
esp_err_t gpio_install_isr_service(int flags);
void gpio_uninstall_isr_service(void);
esp_err_t gpio_isr_handler_add(gpio_num_t gpio, gpio_isr_t isr, void* arg);
esp_err_t gpio_isr_handler_remove(gpio_num_t gpio);
esp_err_t gpio_set_drive_capability(gpio_num_t gpio, gpio_drive_cap_t strength);
esp_err_t gpio_hold_en(gpio_num_t gpio);
esp_err_t gpio_hold_dis(gpio_num_t gpio);
void gpio_deep_sleep_hold_en(void);
void gpio_deep_sleep_hold_dis(void);

/* 设备专用层的钩子：输出电平变化通知（例如 SPI 屏的 DC 脚、舵机位翻转），输入电平来源。默认实现为空（弱符号）。 */
void vhw_gpio_on_output(int gpio, int level);
int vhw_gpio_input_level(int gpio, int last_output_level);

#ifdef __cplusplus
}
#endif
