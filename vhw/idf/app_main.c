/*
 * ESP-IDF 的启动流程（对应 IDF components/freertos/app_startup.c 的 main_task）：上电 → app_main()。
 * 浏览器里 main() 本身就跑在一个 wasm 线程上（-sPROXY_TO_PTHREAD），直接当作 IDF 的 main 任务
 * （优先级 ESP_TASK_MAIN_PRIO=1，栈 CONFIG_ESP_MAIN_TASK_STACK_SIZE）。纯 ESP-IDF 固件（哈基米机）用这一份，
 * Arduino 固件（小歪）用 vhw/arduino/src/arduino_main.cpp。
 */
#include <stdint.h>

#include "esp_task.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "sdkconfig.h"
#include "vdev_io.h"

struct vhw_task* vhw_task_adopt_current(const char* name, uint32_t stack);
void app_main(void);

/* 设备专用层在这里挂外设；默认为空 */
__attribute__((weak)) void vhw_board_init(void) {}

int main(void) {
  (void)vdev_io();
  vhw_task_adopt_current("main", CONFIG_ESP_MAIN_TASK_STACK_SIZE);
  vTaskPrioritySet(NULL, ESP_TASK_MAIN_PRIO);
  vhw_board_init();
  vdev_logf("[vhw] power on: ESP-IDF 5.5.1 virtual hardware (%s), main task stack=%u\n",
#if VHW_VIRTUAL_TIME
            "virtual time",
#else
            "real time",
#endif
            (unsigned)CONFIG_ESP_MAIN_TASK_STACK_SIZE);
  app_main();
  /* IDF：app_main 返回后 main 任务被删除，其他任务继续运行 */
  vTaskDelete(NULL);
  return 0;
}
