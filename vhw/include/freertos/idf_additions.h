/* ESP-IDF 对 FreeRTOS 的扩展：带内存能力参数的创建函数（能力参数在浏览器里无意义，忽略）。 */
#pragma once
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"

#ifdef __cplusplus
extern "C" {
#endif

static inline BaseType_t xTaskCreatePinnedToCoreWithCaps(TaskFunction_t fn, const char* name, uint32_t stack, void* arg,
                                                         UBaseType_t prio, TaskHandle_t* out, BaseType_t core, uint32_t caps) {
  (void)caps;
  return xTaskCreatePinnedToCore(fn, name, stack, arg, prio, out, core);
}
static inline BaseType_t xTaskCreateWithCaps(TaskFunction_t fn, const char* name, uint32_t stack, void* arg,
                                             UBaseType_t prio, TaskHandle_t* out, uint32_t caps) {
  (void)caps;
  return xTaskCreatePinnedToCore(fn, name, stack, arg, prio, out, tskNO_AFFINITY);
}
static inline void vTaskDeleteWithCaps(TaskHandle_t t) { vTaskDelete(t); }
static inline QueueHandle_t xQueueCreateWithCaps(UBaseType_t len, UBaseType_t size, uint32_t caps) {
  (void)caps;
  return vhw_queue_create(len, size, VHW_Q_QUEUE, 0);
}
static inline void vQueueDeleteWithCaps(QueueHandle_t q) { vQueueDelete(q); }
static inline SemaphoreHandle_t xSemaphoreCreateMutexWithCaps(uint32_t caps) { (void)caps; return xSemaphoreCreateMutex(); }
static inline SemaphoreHandle_t xSemaphoreCreateBinaryWithCaps(uint32_t caps) { (void)caps; return xSemaphoreCreateBinary(); }
static inline void vSemaphoreDeleteWithCaps(SemaphoreHandle_t s) { vSemaphoreDelete(s); }

#ifdef __cplusplus
}
#endif
