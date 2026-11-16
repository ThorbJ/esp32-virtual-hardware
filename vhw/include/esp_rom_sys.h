#pragma once
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
/* 忙等微秒：虚拟时钟下直接把时间往前推。 */
void esp_rom_delay_us(uint32_t us);
int esp_rom_printf(const char* fmt, ...);
int esp_rom_get_reset_reason(int cpu_no);
#ifdef __cplusplus
}
#endif
