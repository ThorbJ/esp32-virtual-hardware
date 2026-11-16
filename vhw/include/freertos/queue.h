#pragma once
#include "freertos/FreeRTOS.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef QueueHandle_t QueueSetHandle_t;
typedef QueueHandle_t QueueSetMemberHandle_t;

enum { VHW_Q_QUEUE = 0, VHW_Q_MUTEX = 1, VHW_Q_COUNTING = 2, VHW_Q_BINARY = 3, VHW_Q_RECURSIVE = 4 };
#define queueSEND_TO_BACK 0
#define queueSEND_TO_FRONT 1
#define queueOVERWRITE 2

QueueHandle_t vhw_queue_create(UBaseType_t len, UBaseType_t item_size, int type, UBaseType_t initial);
BaseType_t vhw_queue_send(QueueHandle_t q, const void* item, TickType_t wait, int pos);
BaseType_t vhw_queue_receive(QueueHandle_t q, void* out, TickType_t wait, int peek);
void vQueueDelete(QueueHandle_t q);
BaseType_t xQueueReset(QueueHandle_t q);
UBaseType_t uxQueueMessagesWaiting(QueueHandle_t q);
UBaseType_t uxQueueSpacesAvailable(QueueHandle_t q);
#define uxQueueMessagesWaitingFromISR uxQueueMessagesWaiting
BaseType_t xQueueIsQueueEmptyFromISR(QueueHandle_t q);
BaseType_t xQueueIsQueueFullFromISR(QueueHandle_t q);
void vQueueAddToRegistry(QueueHandle_t q, const char* name);

#define xQueueCreate(len, size) vhw_queue_create((len), (size), VHW_Q_QUEUE, 0)
#define xQueueCreateStatic(len, size, buf, st) ((void)(buf), (void)(st), vhw_queue_create((len), (size), VHW_Q_QUEUE, 0))
#define xQueueSend(q, i, w) vhw_queue_send((q), (i), (w), queueSEND_TO_BACK)
#define xQueueSendToBack(q, i, w) vhw_queue_send((q), (i), (w), queueSEND_TO_BACK)
#define xQueueSendToFront(q, i, w) vhw_queue_send((q), (i), (w), queueSEND_TO_FRONT)
#define xQueueOverwrite(q, i) vhw_queue_send((q), (i), 0, queueOVERWRITE)
#define xQueueGenericSend(q, i, w, p) vhw_queue_send((q), (i), (w), (p))
#define xQueueSendFromISR(q, i, w) ((void)(w), vhw_queue_send((q), (i), 0, queueSEND_TO_BACK))
#define xQueueSendToBackFromISR(q, i, w) ((void)(w), vhw_queue_send((q), (i), 0, queueSEND_TO_BACK))
#define xQueueSendToFrontFromISR(q, i, w) ((void)(w), vhw_queue_send((q), (i), 0, queueSEND_TO_FRONT))
#define xQueueOverwriteFromISR(q, i, w) ((void)(w), vhw_queue_send((q), (i), 0, queueOVERWRITE))
#define xQueueReceive(q, o, w) vhw_queue_receive((q), (o), (w), 0)
#define xQueuePeek(q, o, w) vhw_queue_receive((q), (o), (w), 1)
#define xQueueReceiveFromISR(q, o, w) ((void)(w), vhw_queue_receive((q), (o), 0, 0))

#ifdef __cplusplus
}
#endif
