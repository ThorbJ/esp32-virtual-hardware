/*
 * 虚拟硬件层的时钟：固件看到的全部时间（esp_timer、FreeRTOS 节拍、CPU 周期）都从这里来。
 *
 * 两种实现，编译时二选一（设备 build.mjs 决定）：
 *   实时（默认，src/freertos.c）：浏览器的单调时钟；任务是普通线程，由宿主调度。
 *   虚拟时间（-DVHW_VIRTUAL_TIME=1，src/freertos_vt.c）：时钟只在所有任务都在等待时才前进，
 *     一次只运行一个任务（按优先级 + 就绪先后），所以同样的输入两次运行得到同样的结果。
 *     时钟不会跑到墙上时间前面（固件慢于真机时虚拟时间随之变慢）。
 */
#pragma once
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
/** 上电以来的微秒数。 */
int64_t vhw_clock_us(void);
/** 忙等若干微秒（esp_rom_delay_us 等）。虚拟时间下直接把时钟往前推。 */
void vhw_clock_busy_wait_us(uint32_t us);
#ifdef __cplusplus
}
#endif
