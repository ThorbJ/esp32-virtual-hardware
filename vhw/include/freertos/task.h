#pragma once
#include "freertos/FreeRTOS.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef enum { eRunning = 0, eReady, eBlocked, eSuspended, eDeleted, eInvalid } eTaskState;
typedef enum { eNoAction = 0, eSetBits, eIncrement, eSetValueWithOverwrite, eSetValueWithoutOverwrite } eNotifyAction;

typedef struct {
  TaskHandle_t xHandle;
  const char* pcTaskName;
  UBaseType_t xTaskNumber;
  eTaskState eCurrentState;
  UBaseType_t uxCurrentPriority;
  UBaseType_t uxBasePriority;
  uint32_t ulRunTimeCounter;
  StackType_t* pxStackBase;
  configSTACK_DEPTH_TYPE usStackHighWaterMark;
  BaseType_t xCoreID;
} TaskStatus_t;

#define tskKERNEL_VERSION_NUMBER "V10.5.1"
#define taskSCHEDULER_RUNNING 2

BaseType_t xTaskCreatePinnedToCore(TaskFunction_t fn, const char* name, uint32_t stack_bytes, void* arg,
                                   UBaseType_t prio, TaskHandle_t* out, BaseType_t core);
static inline BaseType_t xTaskCreate(TaskFunction_t fn, const char* name, uint32_t stack_bytes, void* arg,
                                     UBaseType_t prio, TaskHandle_t* out) {
  return xTaskCreatePinnedToCore(fn, name, stack_bytes, arg, prio, out, tskNO_AFFINITY);
}
TaskHandle_t xTaskCreateStaticPinnedToCore(TaskFunction_t fn, const char* name, uint32_t stack_bytes, void* arg,
                                           UBaseType_t prio, StackType_t* stack, StaticTask_t* tcb, BaseType_t core);
static inline TaskHandle_t xTaskCreateStatic(TaskFunction_t fn, const char* name, uint32_t stack_bytes, void* arg,
                                             UBaseType_t prio, StackType_t* stack, StaticTask_t* tcb) {
  return xTaskCreateStaticPinnedToCore(fn, name, stack_bytes, arg, prio, stack, tcb, tskNO_AFFINITY);
}
void vTaskDelete(TaskHandle_t t);
void vTaskDelay(TickType_t ticks);
BaseType_t xTaskDelayUntil(TickType_t* prev, TickType_t inc);
#define vTaskDelayUntil(p, i) ((void)xTaskDelayUntil((p), (i)))
TickType_t xTaskGetTickCount(void);
TickType_t xTaskGetTickCountFromISR(void);
TaskHandle_t xTaskGetCurrentTaskHandle(void);
TaskHandle_t xTaskGetCurrentTaskHandleForCore(BaseType_t core);
TaskHandle_t xTaskGetHandle(const char* name);
TaskHandle_t xTaskGetIdleTaskHandleForCore(BaseType_t core);
char* pcTaskGetName(TaskHandle_t t);
#define pcTaskGetTaskName pcTaskGetName
UBaseType_t uxTaskGetStackHighWaterMark(TaskHandle_t t);
configSTACK_DEPTH_TYPE uxTaskGetStackHighWaterMark2(TaskHandle_t t);
UBaseType_t uxTaskPriorityGet(TaskHandle_t t);
void vTaskPrioritySet(TaskHandle_t t, UBaseType_t prio);
UBaseType_t uxTaskGetNumberOfTasks(void);
UBaseType_t uxTaskGetSystemState(TaskStatus_t* arr, UBaseType_t n, uint32_t* total_runtime);
void vTaskGetRunTimeStats(char* buf);
void vTaskList(char* buf);
eTaskState eTaskGetState(TaskHandle_t t);
void vTaskSuspend(TaskHandle_t t);
void vTaskResume(TaskHandle_t t);
void vTaskSuspendAll(void);
BaseType_t xTaskResumeAll(void);
BaseType_t xTaskGetSchedulerState(void);
BaseType_t xTaskGetCoreID(TaskHandle_t t);
#define xTaskGetAffinity xTaskGetCoreID
void vTaskSetThreadLocalStoragePointer(TaskHandle_t t, BaseType_t idx, void* v);
void* pvTaskGetThreadLocalStoragePointer(TaskHandle_t t, BaseType_t idx);

/* 任务通知 */
BaseType_t xTaskGenericNotify(TaskHandle_t t, UBaseType_t idx, uint32_t value, eNotifyAction action, uint32_t* prev);
uint32_t ulTaskGenericNotifyTake(UBaseType_t idx, BaseType_t clear, TickType_t wait);
BaseType_t xTaskGenericNotifyWait(UBaseType_t idx, uint32_t clear_entry, uint32_t clear_exit, uint32_t* value, TickType_t wait);
#define xTaskNotifyGive(t) xTaskGenericNotify((t), 0, 0, eIncrement, NULL)
#define vTaskNotifyGiveFromISR(t, w) ((void)(w), (void)xTaskGenericNotify((t), 0, 0, eIncrement, NULL))
#define xTaskNotifyGiveIndexed(t, i) xTaskGenericNotify((t), (i), 0, eIncrement, NULL)
#define ulTaskNotifyTake(c, w) ulTaskGenericNotifyTake(0, (c), (w))
#define ulTaskNotifyTakeIndexed(i, c, w) ulTaskGenericNotifyTake((i), (c), (w))
#define xTaskNotify(t, v, a) xTaskGenericNotify((t), 0, (v), (a), NULL)
#define xTaskNotifyFromISR(t, v, a, w) ((void)(w), xTaskGenericNotify((t), 0, (v), (a), NULL))
#define xTaskNotifyAndQuery(t, v, a, p) xTaskGenericNotify((t), 0, (v), (a), (p))
#define xTaskNotifyWait(ce, cx, v, w) xTaskGenericNotifyWait(0, (ce), (cx), (v), (w))
#define xTaskNotifyStateClear(t) ((void)(t), pdTRUE)

#ifdef __cplusplus
}
#endif
