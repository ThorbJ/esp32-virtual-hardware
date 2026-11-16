#pragma once
#include <stdint.h>
#include "soc/io_mux_reg.h"
#include "soc/soc_caps.h"
#ifdef __cplusplus
extern "C" {
#endif
/* 每个 GPIO 的 IO MUX 寄存器地址表（只作为 PIN_FUNC_SELECT 的参数，不会被解引用） */
extern const uint32_t GPIO_PIN_MUX_REG[64];
#ifdef __cplusplus
}
#endif
