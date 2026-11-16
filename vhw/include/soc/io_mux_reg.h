/* IO MUX 寄存器：浏览器里没有引脚复用，选择功能是空操作。 */
#pragma once
#include <stdint.h>
#define PIN_FUNC_GPIO 2
#define FUNC_GPIO 2
#define PIN_FUNC_SELECT(reg, func) ((void)(reg), (void)(func))
#define PIN_INPUT_ENABLE(reg) ((void)(reg))
#define PIN_INPUT_DISABLE(reg) ((void)(reg))
#define PIN_SET_DRV(reg, drv) ((void)(reg), (void)(drv))
#define PIN_PULLUP_EN(reg) ((void)(reg))
#define PIN_PULLUP_DIS(reg) ((void)(reg))
#define PIN_PULLDWN_EN(reg) ((void)(reg))
#define PIN_PULLDWN_DIS(reg) ((void)(reg))
