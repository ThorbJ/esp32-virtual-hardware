/*
 * 虚拟硬件层：FreeRTOS（ESP-IDF 版）API → WebAssembly 线程（pthread）。
 * 任务 = pthread，队列 / 信号量 = 互斥锁 + 条件变量，临界区 = 可重入自旋锁，节拍 = 1 ms 实时时钟。
 * 优先级和绑核只记录不生效（浏览器里线程由宿主调度）。
 */
#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef int BaseType_t;
typedef unsigned int UBaseType_t;
typedef uint32_t TickType_t;
typedef uint8_t StackType_t;
typedef struct vhw_task* TaskHandle_t;
typedef void (*TaskFunction_t)(void*);
typedef struct vhw_queue* QueueHandle_t;

#define pdTRUE 1
#define pdFALSE 0
#define pdPASS pdTRUE
#define pdFAIL pdFALSE
#define errQUEUE_EMPTY 0
#define errQUEUE_FULL 0
#define errCOULD_NOT_ALLOCATE_REQUIRED_MEMORY (-1)

#define portMAX_DELAY ((TickType_t)0xffffffffUL)
#define configTICK_RATE_HZ 1000
#define portTICK_PERIOD_MS ((TickType_t)1)
#define portTICK_RATE_MS portTICK_PERIOD_MS
#define pdMS_TO_TICKS(ms) ((TickType_t)(ms))
#define pdTICKS_TO_MS(t) ((uint32_t)(t))
#define configMAX_PRIORITIES 25
#define configMINIMAL_STACK_SIZE 768
#define configNUMBER_OF_CORES 2
#define portNUM_PROCESSORS 2
#define CONFIG_FREERTOS_HZ 1000
#define tskNO_AFFINITY ((BaseType_t)0x7fffffff)
#define tskIDLE_PRIORITY 0
#define PRO_CPU_NUM 0
#define APP_CPU_NUM 1
#define portBYTE_ALIGNMENT 16
#define portSTACK_TYPE uint8_t
#define portBASE_TYPE int
#define configSTACK_DEPTH_TYPE uint32_t

typedef struct vhw_mux {
  volatile int owner; /* 持有者线程号，0 = 空闲 */
  volatile int count;
} portMUX_TYPE;
#define portMUX_INITIALIZER_UNLOCKED {0, 0}
#define portMUX_FREE_VAL 0
typedef portMUX_TYPE spinlock_t;
#define SPINLOCK_INITIALIZER portMUX_INITIALIZER_UNLOCKED

void vhw_enter_critical(portMUX_TYPE* mux);
void vhw_exit_critical(portMUX_TYPE* mux);
static inline void vhw_mux_init(portMUX_TYPE* mux) { mux->owner = 0; mux->count = 0; }
#define portMUX_INITIALIZE(m) vhw_mux_init(m)
#define spinlock_initialize(m) vhw_mux_init(m)
#define portENTER_CRITICAL(m) vhw_enter_critical(m)
#define portEXIT_CRITICAL(m) vhw_exit_critical(m)
#define portENTER_CRITICAL_ISR(m) vhw_enter_critical(m)
#define portEXIT_CRITICAL_ISR(m) vhw_exit_critical(m)
#define portENTER_CRITICAL_SAFE(m) vhw_enter_critical(m)
#define portEXIT_CRITICAL_SAFE(m) vhw_exit_critical(m)
#define taskENTER_CRITICAL(m) vhw_enter_critical(m)
#define taskEXIT_CRITICAL(m) vhw_exit_critical(m)
#define taskENTER_CRITICAL_ISR(m) vhw_enter_critical(m)
#define taskEXIT_CRITICAL_ISR(m) vhw_exit_critical(m)
#define portDISABLE_INTERRUPTS() ((void)0)
#define portENABLE_INTERRUPTS() ((void)0)
#define portYIELD() vhw_yield()
#define portYIELD_FROM_ISR(...) ((void)0)
#define portYIELD_WITHIN_API() vhw_yield()
#define taskYIELD() vhw_yield()
#define portEND_SWITCHING_ISR(x) ((void)(x))
#define portNOP() ((void)0)
#define xPortInIsrContext() 0
#define xPortCanYield() 1
#define xPortInterruptedFromISRContext() 0
#define portCHECK_IF_IN_ISR() 0
BaseType_t xPortGetCoreID(void);
#define portGET_CORE_ID() xPortGetCoreID()
void vhw_yield(void);

/* 静态分配用的占位结构（够大即可，内容不用） */
typedef struct { uint8_t opaque[512]; } StaticTask_t;
typedef struct { uint8_t opaque[256]; } StaticQueue_t;
typedef StaticQueue_t StaticSemaphore_t;
typedef struct { uint8_t opaque[64]; } StaticEventGroup_t;
typedef struct { uint8_t opaque[64]; } StaticTimer_t;
typedef struct { uint8_t opaque[64]; } StaticStreamBuffer_t;

#define configASSERT(x) ((void)0)
#define configSUPPORT_STATIC_ALLOCATION 1
#define configSUPPORT_DYNAMIC_ALLOCATION 1
#define INCLUDE_vTaskDelete 1
#define INCLUDE_xTaskGetHandle 1

#ifdef __cplusplus
}
#endif

#include "freertos/portmacro_vhw.h"
