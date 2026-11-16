#pragma once
#include "freertos/queue.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef QueueHandle_t SemaphoreHandle_t;

#define xSemaphoreCreateMutex() vhw_queue_create(1, 0, VHW_Q_MUTEX, 1)
#define xSemaphoreCreateMutexStatic(b) ((void)(b), vhw_queue_create(1, 0, VHW_Q_MUTEX, 1))
#define xSemaphoreCreateRecursiveMutex() vhw_queue_create(1, 0, VHW_Q_RECURSIVE, 1)
#define xSemaphoreCreateRecursiveMutexStatic(b) ((void)(b), vhw_queue_create(1, 0, VHW_Q_RECURSIVE, 1))
#define xSemaphoreCreateBinary() vhw_queue_create(1, 0, VHW_Q_BINARY, 0)
#define xSemaphoreCreateBinaryStatic(b) ((void)(b), vhw_queue_create(1, 0, VHW_Q_BINARY, 0))
#define xSemaphoreCreateCounting(max, init) vhw_queue_create((max), 0, VHW_Q_COUNTING, (init))
#define xSemaphoreCreateCountingStatic(max, init, b) ((void)(b), vhw_queue_create((max), 0, VHW_Q_COUNTING, (init)))
#define vSemaphoreCreateBinary(s) do { (s) = vhw_queue_create(1, 0, VHW_Q_BINARY, 1); } while (0)
#define xSemaphoreTake(s, w) vhw_queue_receive((s), NULL, (w), 0)
#define xSemaphoreGive(s) vhw_queue_send((s), NULL, 0, queueSEND_TO_BACK)
#define xSemaphoreTakeRecursive(s, w) vhw_queue_receive((s), NULL, (w), 0)
#define xSemaphoreGiveRecursive(s) vhw_queue_send((s), NULL, 0, queueSEND_TO_BACK)
#define xSemaphoreTakeFromISR(s, w) ((void)(w), vhw_queue_receive((s), NULL, 0, 0))
#define xSemaphoreGiveFromISR(s, w) ((void)(w), vhw_queue_send((s), NULL, 0, queueSEND_TO_BACK))
#define vSemaphoreDelete(s) vQueueDelete(s)
#define uxSemaphoreGetCount(s) uxQueueMessagesWaiting(s)
TaskHandle_t xSemaphoreGetMutexHolder(SemaphoreHandle_t s);
#define xQueueGetMutexHolder xSemaphoreGetMutexHolder

#ifdef __cplusplus
}
#endif
