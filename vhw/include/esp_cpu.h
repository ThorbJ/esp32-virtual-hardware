/* CPU 周期计数：按 CONFIG_ESP_DEFAULT_CPU_FREQ_MHZ 由（虚拟）时钟换算。 */
#pragma once
#include <stdint.h>
#include <stdbool.h>
#include "esp_attr.h"
#ifdef __cplusplus
extern "C" {
#endif
typedef uint32_t esp_cpu_cycle_count_t;
esp_cpu_cycle_count_t esp_cpu_get_cycle_count(void);
int esp_cpu_get_core_id(void);
#ifdef __cplusplus
}
#endif
