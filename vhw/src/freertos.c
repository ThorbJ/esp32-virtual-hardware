/*
 * FreeRTOS（ESP-IDF 版）→ pthread。见 include/freertos/FreeRTOS.h 的说明。
 * 只追求"上游代码按原意运行"，不追求调度细节（优先级 / 绑核 / 时间片）一致。
 * 实时版：时间 = 浏览器单调时钟。虚拟时间版见 freertos_vt.c（-DVHW_VIRTUAL_TIME=1 时编译那一份，这份为空）。
 */
#if !VHW_VIRTUAL_TIME
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/idf_additions.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "freertos/task.h"

#include <emscripten.h>
#include <errno.h>
#include <pthread.h>
#include <sched.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

#include "vdev_io.h"
#include "vhw_clock.h"

#define VHW_MAX_TASKS 64
#define VHW_NOTIFY_SLOTS 3
#define VHW_TLS_SLOTS 4

struct vhw_task {
  pthread_t thread;
  char name[24];
  TaskFunction_t fn;
  void* arg;
  UBaseType_t prio;
  BaseType_t core;
  uint32_t stack_bytes;
  int id;
  volatile int alive;
  pthread_mutex_t m;
  pthread_cond_t cv;
  uint32_t notify_value[VHW_NOTIFY_SLOTS];
  int notify_pending[VHW_NOTIFY_SLOTS];
  void* tls[VHW_TLS_SLOTS];
};

static pthread_mutex_t s_tasks_lock = PTHREAD_MUTEX_INITIALIZER;
static struct vhw_task* s_tasks[VHW_MAX_TASKS];
static int s_task_count;
static __thread struct vhw_task* t_self;
static double s_boot_ms = -1;

static double now_ms(void) {
  double t = emscripten_get_now();
  if (s_boot_ms < 0) s_boot_ms = t;
  return t - s_boot_ms;
}

/* 共用时钟（vhw_clock.h）：实时 */
int64_t vhw_clock_us(void) {
  const double ms = now_ms();
  __atomic_store_n(&vdev_io()->clock_ms, (uint32_t)ms, __ATOMIC_RELAXED);
  return (int64_t)(ms * 1000.0);
}
void vhw_clock_busy_wait_us(uint32_t us) {
  const double until = now_ms() + us / 1000.0;
  while (now_ms() < until) {}
}

/* 节拍 = 毫秒（configTICK_RATE_HZ = 1000） */
TickType_t xTaskGetTickCount(void) { return (TickType_t)(vhw_clock_us() / 1000); }
TickType_t xTaskGetTickCountFromISR(void) { return xTaskGetTickCount(); }

static void abs_deadline(struct timespec* ts, TickType_t wait) {
  clock_gettime(CLOCK_REALTIME, ts);
  uint64_t ns = (uint64_t)ts->tv_nsec + (uint64_t)wait * 1000000ull;
  ts->tv_sec += (time_t)(ns / 1000000000ull);
  ts->tv_nsec = (long)(ns % 1000000000ull);
}

/* 在条件变量上等，直到 pred 为真或超时；返回 pred 结果。调用前持有 m。 */
#define WAIT_UNTIL(cv, m, wait, pred)                                   \
  ({                                                                    \
    int ok_ = (pred);                                                   \
    if (!ok_ && (wait) != 0) {                                          \
      struct timespec ts_;                                              \
      if ((wait) != portMAX_DELAY) abs_deadline(&ts_, (wait));          \
      while (!(ok_ = (pred))) {                                         \
        int rc_ = (wait) == portMAX_DELAY ? pthread_cond_wait((cv), (m)) \
                                          : pthread_cond_timedwait((cv), (m), &ts_); \
        if (rc_ == ETIMEDOUT) { ok_ = (pred); break; }                  \
      }                                                                 \
    }                                                                   \
    ok_;                                                                \
  })

/* ---------------- 任务 ---------------- */

static struct vhw_task* task_new(const char* name, TaskFunction_t fn, void* arg, UBaseType_t prio, BaseType_t core, uint32_t stack) {
  struct vhw_task* t = calloc(1, sizeof *t);
  if (!t) return NULL;
  snprintf(t->name, sizeof t->name, "%s", name ? name : "task");
  t->fn = fn;
  t->arg = arg;
  t->prio = prio;
  t->core = core;
  t->stack_bytes = stack;
  t->alive = 1;
  pthread_mutex_init(&t->m, NULL);
  pthread_cond_init(&t->cv, NULL);
  pthread_mutex_lock(&s_tasks_lock);
  t->id = s_task_count;
  if (s_task_count < VHW_MAX_TASKS) s_tasks[s_task_count++] = t;
  pthread_mutex_unlock(&s_tasks_lock);
  return t;
}

/* 主线程（Arduino loopTask / app_main）也要有任务句柄 */
struct vhw_task* vhw_task_adopt_current(const char* name, uint32_t stack) {
  if (!t_self) {
    t_self = task_new(name, NULL, NULL, 1, 1, stack);
    if (t_self) t_self->thread = pthread_self();
  }
  return t_self;
}

static void* task_trampoline(void* p) {
  struct vhw_task* t = p;
  t_self = t;
  t->fn(t->arg);
  /* FreeRTOS 任务函数不允许返回；真机上会断言。这里当作 vTaskDelete(NULL)。 */
  t->alive = 0;
  return NULL;
}

BaseType_t xTaskCreatePinnedToCore(TaskFunction_t fn, const char* name, uint32_t stack_bytes, void* arg,
                                   UBaseType_t prio, TaskHandle_t* out, BaseType_t core) {
  struct vhw_task* t = task_new(name, fn, arg, prio, core, stack_bytes);
  if (!t) return errCOULD_NOT_ALLOCATE_REQUIRED_MEMORY;
  pthread_attr_t attr;
  pthread_attr_init(&attr);
  pthread_attr_setdetachstate(&attr, PTHREAD_CREATE_DETACHED);
  /* wasm 的栈用量和 Xtensa 不同：给足余量（至少 256 KB 或上游请求的 4 倍）。 */
  size_t stack = (size_t)stack_bytes * 4;
  if (stack < 256 * 1024) stack = 256 * 1024;
  pthread_attr_setstacksize(&attr, stack);
  int rc = pthread_create(&t->thread, &attr, task_trampoline, t);
  pthread_attr_destroy(&attr);
  if (rc != 0) {
    vdev_logf("[vhw] xTaskCreate(%s) failed rc=%d\n", t->name, rc);
    t->alive = 0;
    return errCOULD_NOT_ALLOCATE_REQUIRED_MEMORY;
  }
  if (out) *out = t;
  return pdPASS;
}

TaskHandle_t xTaskCreateStaticPinnedToCore(TaskFunction_t fn, const char* name, uint32_t stack_bytes, void* arg,
                                           UBaseType_t prio, StackType_t* stack, StaticTask_t* tcb, BaseType_t core) {
  (void)stack;
  (void)tcb;
  TaskHandle_t h = NULL;
  return xTaskCreatePinnedToCore(fn, name, stack_bytes, arg, prio, &h, core) == pdPASS ? h : NULL;
}

void vTaskDelete(TaskHandle_t t) {
  if (t == NULL || t == t_self) {
    if (t_self) t_self->alive = 0;
    pthread_exit(NULL);
  }
  /* pthread 不能从外部强杀；被删的任务通常已经在等待退出，这里只做标记。 */
  t->alive = 0;
}

void vhw_yield(void) { sched_yield(); }

void vTaskDelay(TickType_t ticks) {
  if (ticks == 0) { sched_yield(); return; }
  struct timespec ts = {(time_t)(ticks / 1000), (long)(ticks % 1000) * 1000000L};
  while (nanosleep(&ts, &ts) == -1 && errno == EINTR) {}
}

BaseType_t xTaskDelayUntil(TickType_t* prev, TickType_t inc) {
  TickType_t target = *prev + inc;
  TickType_t now = xTaskGetTickCount();
  BaseType_t delayed = pdFALSE;
  if ((int32_t)(target - now) > 0) { vTaskDelay(target - now); delayed = pdTRUE; }
  *prev = target;
  return delayed;
}

TaskHandle_t xTaskGetCurrentTaskHandle(void) {
  if (!t_self) vhw_task_adopt_current("pthread", 0);
  return t_self;
}
TaskHandle_t xTaskGetCurrentTaskHandleForCore(BaseType_t core) { (void)core; return xTaskGetCurrentTaskHandle(); }
TaskHandle_t xTaskGetIdleTaskHandleForCore(BaseType_t core) { (void)core; return NULL; }

TaskHandle_t xTaskGetHandle(const char* name) {
  TaskHandle_t found = NULL;
  pthread_mutex_lock(&s_tasks_lock);
  for (int i = 0; i < s_task_count; i++)
    if (s_tasks[i]->alive && strncmp(s_tasks[i]->name, name, sizeof s_tasks[i]->name - 1) == 0) found = s_tasks[i];
  pthread_mutex_unlock(&s_tasks_lock);
  return found;
}

char* pcTaskGetName(TaskHandle_t t) {
  if (!t) t = xTaskGetCurrentTaskHandle();
  return t ? t->name : (char*)"?";
}

/* 栈余量：报告请求值的一半，避免上游"栈快满了"的保护分支误触发 */
UBaseType_t uxTaskGetStackHighWaterMark(TaskHandle_t t) {
  if (!t) t = xTaskGetCurrentTaskHandle();
  return t && t->stack_bytes ? t->stack_bytes / 2 : 4096;
}
configSTACK_DEPTH_TYPE uxTaskGetStackHighWaterMark2(TaskHandle_t t) { return uxTaskGetStackHighWaterMark(t); }
UBaseType_t uxTaskPriorityGet(TaskHandle_t t) {
  if (!t) t = xTaskGetCurrentTaskHandle();
  return t ? t->prio : 1;
}
void vTaskPrioritySet(TaskHandle_t t, UBaseType_t prio) {
  if (!t) t = xTaskGetCurrentTaskHandle();
  if (t) t->prio = prio;
}
UBaseType_t uxTaskGetNumberOfTasks(void) {
  int n = 0;
  pthread_mutex_lock(&s_tasks_lock);
  for (int i = 0; i < s_task_count; i++) n += s_tasks[i]->alive ? 1 : 0;
  pthread_mutex_unlock(&s_tasks_lock);
  return (UBaseType_t)n;
}
UBaseType_t uxTaskGetSystemState(TaskStatus_t* arr, UBaseType_t n, uint32_t* total) {
  UBaseType_t k = 0;
  pthread_mutex_lock(&s_tasks_lock);
  for (int i = 0; i < s_task_count && k < n; i++) {
    struct vhw_task* t = s_tasks[i];
    if (!t->alive) continue;
    arr[k] = (TaskStatus_t){t, t->name, (UBaseType_t)t->id, eBlocked, t->prio, t->prio, 0, NULL, t->stack_bytes / 2, t->core};
    k++;
  }
  pthread_mutex_unlock(&s_tasks_lock);
  if (total) *total = 0;
  return k;
}
void vTaskGetRunTimeStats(char* buf) { if (buf) buf[0] = '\0'; }
void vTaskList(char* buf) { if (buf) buf[0] = '\0'; }
eTaskState eTaskGetState(TaskHandle_t t) { return t && t->alive ? eBlocked : eDeleted; }
void vTaskSuspend(TaskHandle_t t) { (void)t; }
void vTaskResume(TaskHandle_t t) { (void)t; }
static pthread_mutex_t s_suspend_all = PTHREAD_MUTEX_INITIALIZER;
void vTaskSuspendAll(void) { pthread_mutex_lock(&s_suspend_all); }
BaseType_t xTaskResumeAll(void) { pthread_mutex_unlock(&s_suspend_all); return pdFALSE; }
BaseType_t xTaskGetSchedulerState(void) { return taskSCHEDULER_RUNNING; }
BaseType_t xTaskGetCoreID(TaskHandle_t t) {
  if (!t) t = xTaskGetCurrentTaskHandle();
  return t && t->core != tskNO_AFFINITY ? t->core : 0;
}
BaseType_t xPortGetCoreID(void) { return xTaskGetCoreID(NULL); }
void vTaskSetThreadLocalStoragePointer(TaskHandle_t t, BaseType_t idx, void* v) {
  if (!t) t = xTaskGetCurrentTaskHandle();
  if (t && idx >= 0 && idx < VHW_TLS_SLOTS) t->tls[idx] = v;
}
void* pvTaskGetThreadLocalStoragePointer(TaskHandle_t t, BaseType_t idx) {
  if (!t) t = xTaskGetCurrentTaskHandle();
  return t && idx >= 0 && idx < VHW_TLS_SLOTS ? t->tls[idx] : NULL;
}

/* ---------------- 任务通知 ---------------- */

BaseType_t xTaskGenericNotify(TaskHandle_t t, UBaseType_t idx, uint32_t value, eNotifyAction action, uint32_t* prev) {
  if (!t || idx >= VHW_NOTIFY_SLOTS) return pdFAIL;
  BaseType_t rc = pdPASS;
  pthread_mutex_lock(&t->m);
  if (prev) *prev = t->notify_value[idx];
  switch (action) {
    case eSetBits: t->notify_value[idx] |= value; break;
    case eIncrement: t->notify_value[idx]++; break;
    case eSetValueWithOverwrite: t->notify_value[idx] = value; break;
    case eSetValueWithoutOverwrite:
      if (t->notify_pending[idx]) rc = pdFAIL; else t->notify_value[idx] = value;
      break;
    case eNoAction: break;
  }
  t->notify_pending[idx] = 1;
  pthread_cond_broadcast(&t->cv);
  pthread_mutex_unlock(&t->m);
  return rc;
}

uint32_t ulTaskGenericNotifyTake(UBaseType_t idx, BaseType_t clear, TickType_t wait) {
  struct vhw_task* t = xTaskGetCurrentTaskHandle();
  if (!t || idx >= VHW_NOTIFY_SLOTS) return 0;
  pthread_mutex_lock(&t->m);
  WAIT_UNTIL(&t->cv, &t->m, wait, t->notify_value[idx] != 0);
  uint32_t v = t->notify_value[idx];
  if (v) t->notify_value[idx] = clear ? 0 : v - 1;
  t->notify_pending[idx] = 0;
  pthread_mutex_unlock(&t->m);
  return v;
}

BaseType_t xTaskGenericNotifyWait(UBaseType_t idx, uint32_t clear_entry, uint32_t clear_exit, uint32_t* value, TickType_t wait) {
  struct vhw_task* t = xTaskGetCurrentTaskHandle();
  if (!t || idx >= VHW_NOTIFY_SLOTS) return pdFAIL;
  pthread_mutex_lock(&t->m);
  if (!t->notify_pending[idx]) t->notify_value[idx] &= ~clear_entry;
  int got = WAIT_UNTIL(&t->cv, &t->m, wait, t->notify_pending[idx]);
  if (value) *value = t->notify_value[idx];
  if (got) { t->notify_value[idx] &= ~clear_exit; t->notify_pending[idx] = 0; }
  pthread_mutex_unlock(&t->m);
  return got ? pdPASS : pdFAIL;
}

/* ---------------- 临界区（可重入自旋锁） ---------------- */

static int self_id(void) {
  static __thread int id;
  static int next = 1;
  if (!id) id = __atomic_fetch_add(&next, 1, __ATOMIC_RELAXED);
  return id;
}

void vhw_enter_critical(portMUX_TYPE* mux) {
  const int me = self_id();
  if (__atomic_load_n(&mux->owner, __ATOMIC_ACQUIRE) == me) { mux->count++; return; }
  for (;;) {
    int expected = 0;
    if (__atomic_compare_exchange_n(&mux->owner, &expected, me, false, __ATOMIC_ACQUIRE, __ATOMIC_RELAXED)) break;
    sched_yield();
  }
  mux->count = 1;
}

void vhw_exit_critical(portMUX_TYPE* mux) {
  if (--mux->count == 0) __atomic_store_n(&mux->owner, 0, __ATOMIC_RELEASE);
}

/* ---------------- 队列 / 信号量 ---------------- */

struct vhw_queue {
  pthread_mutex_t m;
  pthread_cond_t cv;
  int type;
  UBaseType_t len, item_size, count, head;
  uint8_t* buf;
  struct vhw_task* owner;
  int recursion;
};

QueueHandle_t vhw_queue_create(UBaseType_t len, UBaseType_t item_size, int type, UBaseType_t initial) {
  struct vhw_queue* q = calloc(1, sizeof *q);
  if (!q) return NULL;
  pthread_mutex_init(&q->m, NULL);
  pthread_cond_init(&q->cv, NULL);
  q->type = type;
  q->len = len ? len : 1;
  q->item_size = item_size;
  q->count = initial;
  if (item_size) {
    q->buf = malloc((size_t)q->len * item_size);
    if (!q->buf) { free(q); return NULL; }
  }
  return q;
}

void vQueueDelete(QueueHandle_t q) {
  if (!q) return;
  pthread_mutex_destroy(&q->m);
  pthread_cond_destroy(&q->cv);
  free(q->buf);
  free(q);
}

BaseType_t vhw_queue_send(QueueHandle_t q, const void* item, TickType_t wait, int pos) {
  if (!q) return pdFAIL;
  pthread_mutex_lock(&q->m);
  if (q->type == VHW_Q_MUTEX || q->type == VHW_Q_RECURSIVE) {
    /* 释放互斥量 */
    BaseType_t rc = pdFAIL;
    if (q->owner == xTaskGetCurrentTaskHandle() || q->owner == NULL) {
      if (q->type == VHW_Q_RECURSIVE && q->recursion > 1) { q->recursion--; rc = pdPASS; }
      else if (q->count == 0) { q->count = 1; q->owner = NULL; q->recursion = 0; rc = pdPASS; }
    }
    pthread_cond_broadcast(&q->cv);
    pthread_mutex_unlock(&q->m);
    return rc;
  }
  if (pos == queueOVERWRITE && q->count >= q->len) q->count = 0, q->head = 0;
  int ok = WAIT_UNTIL(&q->cv, &q->m, wait, q->count < q->len);
  if (ok) {
    if (q->item_size) {
      UBaseType_t slot;
      if (pos == queueSEND_TO_FRONT) {
        q->head = (q->head + q->len - 1) % q->len;
        slot = q->head;
      } else {
        slot = (q->head + q->count) % q->len;
      }
      memcpy(q->buf + (size_t)slot * q->item_size, item, q->item_size);
    }
    q->count++;
    pthread_cond_broadcast(&q->cv);
  }
  pthread_mutex_unlock(&q->m);
  return ok ? pdPASS : errQUEUE_FULL;
}

BaseType_t vhw_queue_receive(QueueHandle_t q, void* out, TickType_t wait, int peek) {
  if (!q) return pdFAIL;
  pthread_mutex_lock(&q->m);
  if (q->type == VHW_Q_RECURSIVE && q->owner == xTaskGetCurrentTaskHandle() && q->count == 0) {
    q->recursion++;
    pthread_mutex_unlock(&q->m);
    return pdPASS;
  }
  int ok = WAIT_UNTIL(&q->cv, &q->m, wait, q->count > 0);
  if (ok) {
    if (q->item_size && out) memcpy(out, q->buf + (size_t)q->head * q->item_size, q->item_size);
    if (!peek) {
      if (q->item_size) q->head = (q->head + 1) % q->len;
      q->count--;
      if (q->type == VHW_Q_MUTEX || q->type == VHW_Q_RECURSIVE) {
        q->owner = xTaskGetCurrentTaskHandle();
        q->recursion = 1;
      }
    }
    pthread_cond_broadcast(&q->cv);
  }
  pthread_mutex_unlock(&q->m);
  return ok ? pdPASS : errQUEUE_EMPTY;
}

BaseType_t xQueueReset(QueueHandle_t q) {
  if (!q) return pdFAIL;
  pthread_mutex_lock(&q->m);
  q->count = 0;
  q->head = 0;
  pthread_cond_broadcast(&q->cv);
  pthread_mutex_unlock(&q->m);
  return pdPASS;
}

UBaseType_t uxQueueMessagesWaiting(QueueHandle_t q) {
  if (!q) return 0;
  pthread_mutex_lock(&q->m);
  UBaseType_t n = q->count;
  pthread_mutex_unlock(&q->m);
  return n;
}

UBaseType_t uxQueueSpacesAvailable(QueueHandle_t q) {
  if (!q) return 0;
  pthread_mutex_lock(&q->m);
  UBaseType_t n = q->len - q->count;
  pthread_mutex_unlock(&q->m);
  return n;
}

BaseType_t xQueueIsQueueEmptyFromISR(QueueHandle_t q) { return uxQueueMessagesWaiting(q) == 0; }
BaseType_t xQueueIsQueueFullFromISR(QueueHandle_t q) { return uxQueueSpacesAvailable(q) == 0; }
void vQueueAddToRegistry(QueueHandle_t q, const char* name) { (void)q; (void)name; }
TaskHandle_t xSemaphoreGetMutexHolder(SemaphoreHandle_t s) { return s ? s->owner : NULL; }

/* ---------------- 事件组 ---------------- */

struct vhw_event_group {
  pthread_mutex_t m;
  pthread_cond_t cv;
  EventBits_t bits;
};

EventGroupHandle_t xEventGroupCreate(void) {
  struct vhw_event_group* g = calloc(1, sizeof *g);
  if (!g) return NULL;
  pthread_mutex_init(&g->m, NULL);
  pthread_cond_init(&g->cv, NULL);
  return g;
}
void vEventGroupDelete(EventGroupHandle_t g) { free(g); }
EventBits_t xEventGroupSetBits(EventGroupHandle_t g, EventBits_t bits) {
  pthread_mutex_lock(&g->m);
  g->bits |= bits;
  EventBits_t v = g->bits;
  pthread_cond_broadcast(&g->cv);
  pthread_mutex_unlock(&g->m);
  return v;
}
EventBits_t xEventGroupClearBits(EventGroupHandle_t g, EventBits_t bits) {
  pthread_mutex_lock(&g->m);
  EventBits_t v = g->bits;
  g->bits &= ~bits;
  pthread_mutex_unlock(&g->m);
  return v;
}
EventBits_t xEventGroupGetBits(EventGroupHandle_t g) {
  pthread_mutex_lock(&g->m);
  EventBits_t v = g->bits;
  pthread_mutex_unlock(&g->m);
  return v;
}
EventBits_t xEventGroupWaitBits(EventGroupHandle_t g, EventBits_t bits, BaseType_t clear, BaseType_t all, TickType_t wait) {
  pthread_mutex_lock(&g->m);
  int ok = WAIT_UNTIL(&g->cv, &g->m, wait, all ? ((g->bits & bits) == bits) : ((g->bits & bits) != 0));
  EventBits_t v = g->bits;
  if (ok && clear) g->bits &= ~bits;
  pthread_mutex_unlock(&g->m);
  return v;
}

#endif /* !VHW_VIRTUAL_TIME */
