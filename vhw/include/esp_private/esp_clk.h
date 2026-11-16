#pragma once
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
int esp_clk_cpu_freq(void);
int esp_clk_apb_freq(void);
#ifdef __cplusplus
}
#endif
