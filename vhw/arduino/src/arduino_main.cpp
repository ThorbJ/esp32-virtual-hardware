/*
 * Arduino-ESP32 的启动流程（对应上游 cores/esp32/main.cpp）：初始化 → setup() → 循环 loop()。
 * 在浏览器里 main() 本身就跑在一个 wasm 线程上（-sPROXY_TO_PTHREAD），直接当作 loopTask。
 */
#include <Arduino.h>
#include <emscripten.h>
#include <sched.h>
#include <stdio.h>
#include <unistd.h>

#include "vdev_io.h"

extern "C" struct vhw_task* vhw_task_adopt_current(const char* name, uint32_t stack);
extern "C" void vhw_board_init(void);

__attribute__((weak)) size_t getArduinoLoopTaskStackSize(void) { return 8192; }
__attribute__((weak)) uint64_t getArduinoSetupWaitTime_ms(void) { return 0; }
/* 设备专用层在这里挂外设（屏幕模型等）；默认为空 */
extern "C" __attribute__((weak)) void vhw_board_init(void) {}

extern "C" void initArduino(void) {}

int main(void) {
  (void)vdev_io();
  vhw_task_adopt_current("loopTask", (uint32_t)getArduinoLoopTaskStackSize());
  vhw_board_init();
  initArduino();
  vdev_logf("[vhw] power on: Arduino-ESP32 3.3.2 virtual hardware, loopTask stack=%u\n", (unsigned)getArduinoLoopTaskStackSize());
  if (getArduinoSetupWaitTime_ms()) delay((uint32_t)getArduinoSetupWaitTime_ms());
  setup();
  for (;;) {
    loop();
    /* 上游 loopTask 在每次 loop() 之后不主动让出 CPU；浏览器线程由宿主调度，这里让一下避免空转占满。
     * 虚拟时间下一次只跑一个任务，要经 FreeRTOS 让出（排到就绪队列末尾）别的任务才轮得到。 */
#if VHW_VIRTUAL_TIME
    vTaskDelay(0);
#else
    sched_yield();
#endif
  }
  return 0;
}
