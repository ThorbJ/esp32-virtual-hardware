/*
 * FreeRTOS（ESP-IDF 版）→ pthread，虚拟时间版（-DVHW_VIRTUAL_TIME=1）。实时版见 freertos.c（那份此时为空）。
 *
 * 为什么：上游固件按时间推进画面（桌宠动画按毫秒选帧），线程由宿主调度时两次运行的画面不同。
 * 这里把调度做成确定的离散事件模拟：
 *   - 任务仍是 pthread，但一次只有一个任务在跑（持有"CPU"），其余都在等自己的条件变量；
 *   - 正在跑的任务只在 FreeRTOS 阻塞点（延时、队列 / 信号量 / 通知 / 事件组等待、让出）交出 CPU；
 *   - 就绪队列先进先出（不按优先级抢占：真机是双核，上游代码不能依赖严格优先级；FIFO 也不会饿死低优先级任务）；
 *   - 所有任务都在等待时，虚拟时钟跳到最早的超时时刻并唤醒到期的任务（同一时刻按任务编号顺序）；
 *   - 虚拟时钟不超过墙上时间（跳之前先睡到对应的真实时刻），所以设备不会"快进"，比真机慢时随之变慢；
 *   - 任务运行期间时钟基本不走，每次读时钟加 1 µs（保证"读时钟忙等"的代码也能前进，次数确定所以结果仍可重复）；
 *     任务让出 / 阻塞时先唤醒因此已到期的任务，忙等中途 taskYIELD 的任务不会独占 CPU。
 *   - 虚拟硬件等外界（摄像头帧、出口缓冲）要经 vTaskDelay 交出 CPU，不能真睡（会让整机一起停住，见 vdev_io.c）。
 * 同样的外部输入在同样的设备时刻到达时，两次运行的全部输出逐帧相同。外部输入（电脑端字节、按键）按真实时间到达，
 * 固件在下一次轮询时看到；需要可重复的交互测试时，按设备时钟（接口的 clockMs）安排输入。
 *
 * 临界区（portENTER_CRITICAL）只计嵌套：同一时刻只有一个任务在跑，不会有竞争。
 */
#if VHW_VIRTUAL_TIME
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/idf_additions.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "freertos/task.h"

#include <emscripten.h>
#include <errno.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include "vdev_io.h"
#include "vhw_clock.h"

#define VHW_MAX_TASKS 64
#define VHW_NOTIFY_SLOTS 3
#define VHW_TLS_SLOTS 4
#define NO_DEADLINE UINT64_MAX

enum { T_READY = 1, T_RUNNING, T_BLOCKED, T_DELETED };

struct vhw_task {
  pthread_t thread;
  char name[24];
  TaskFunction_t fn;
  void* arg;
  UBaseType_t prio;
  BaseType_t core;
  uint32_t stack_bytes;
  int id;
  int state;
  pthread_cond_t cv;      /* 轮到自己跑时被唤醒 */
  const void* waiting_on; /* 阻塞在哪个对象上（NULL = 纯延时） */
  uint64_t deadline;      /* 虚拟时钟到这个时刻超时唤醒 */
  int timed_out;
  uint64_t ready_seq;     /* 进就绪队列的先后 */
  uint32_t notify_value[VHW_NOTIFY_SLOTS];
  int notify_pending[VHW_NOTIFY_SLOTS];
  void* tls[VHW_TLS_SLOTS];
};

static pthread_mutex_t G = PTHREAD_MUTEX_INITIALIZER; /* 保护全部调度状态 */
static struct vhw_task* s_tasks[VHW_MAX_TASKS];
static int s_task_count;
static struct vhw_task* s_running;
static uint64_t s_ready_seq;
static uint64_t s_now_us;           /* 虚拟时钟 */
static double s_real_boot_ms = -1;  /* 上电时的墙上时间 */
static __thread struct vhw_task* t_self;
static int s_stall_logged;

static double real_ms(void) {
  double t = emscripten_get_now();
  if (s_real_boot_ms < 0) s_real_boot_ms = t;
  return t - s_real_boot_ms;
}

static void publish_clock(void) { __atomic_store_n(&vdev_io()->clock_ms, (uint32_t)(s_now_us / 1000), __ATOMIC_RELEASE); }

/* ---------------- 时钟 ---------------- */

int64_t vhw_clock_us(void) {
  pthread_mutex_lock(&G);
  s_now_us += 1;
  uint64_t v = s_now_us;
  pthread_mutex_unlock(&G);
  return (int64_t)v;
}

void vhw_clock_busy_wait_us(uint32_t us) {
  pthread_mutex_lock(&G);
  s_now_us += us;
  publish_clock();
  pthread_mutex_unlock(&G);
}

TickType_t xTaskGetTickCount(void) {
  pthread_mutex_lock(&G);
  TickType_t t = (TickType_t)(s_now_us / 1000);
  pthread_mutex_unlock(&G);
  return t;
}
TickType_t xTaskGetTickCountFromISR(void) { return xTaskGetTickCount(); }

static uint64_t deadline_after(TickType_t ticks) {
  return ticks == portMAX_DELAY ? NO_DEADLINE : s_now_us + (uint64_t)ticks * 1000u;
}

/* ---------------- 调度核心（调用者持有 G） ---------------- */

static void make_ready(struct vhw_task* t) {
  t->state = T_READY;
  t->ready_seq = ++s_ready_seq;
  t->waiting_on = NULL;
  t->deadline = NO_DEADLINE;
}

static struct vhw_task* pick_ready(void) {
  struct vhw_task* best = NULL;
  for (int i = 0; i < s_task_count; i++) {
    struct vhw_task* t = s_tasks[i];
    if (t->state == T_READY && (!best || t->ready_seq < best->ready_seq)) best = t;
  }
  return best;
}

/* 唤醒已到期的任务（按任务编号顺序）。运行中的任务读时钟、忙等也会让时钟前进，
 * 所以让出 CPU 时要先看一眼：否则"边忙等边 taskYIELD"的任务（如上游摄像头 120 ms 采样）会一直被重新选中，
 * 到期的任务（喇叭、屏幕）一个都轮不到，整机看起来停住。 */
static void wake_expired(void) {
  for (int i = 0; i < s_task_count; i++) {
    struct vhw_task* t = s_tasks[i];
    if (t->state == T_BLOCKED && t->deadline <= s_now_us) {
      make_ready(t);
      t->timed_out = 1;
    }
  }
  publish_clock();
}

/* 没有就绪任务：时钟跳到最早的超时时刻（不超过墙上时间），唤醒到期任务 */
static void advance_clock(void) {
  for (;;) {
    uint64_t next = NO_DEADLINE;
    for (int i = 0; i < s_task_count; i++)
      if (s_tasks[i]->state == T_BLOCKED && s_tasks[i]->deadline < next) next = s_tasks[i]->deadline;
    if (next == NO_DEADLINE) {
      /* 全部任务无限期等待：外界不会唤醒它们（输入都是轮询），记一次日志后空等 */
      if (!s_stall_logged) {
        s_stall_logged = 1;
        vdev_logf("[vhw] all tasks blocked forever at t=%llu ms\n", (unsigned long long)(s_now_us / 1000));
      }
      pthread_mutex_unlock(&G);
      struct timespec ts = {0, 20 * 1000000L};
      nanosleep(&ts, NULL);
      pthread_mutex_lock(&G);
      continue;
    }
    const uint32_t hold_ms = __atomic_load_n(&vdev_io()->clock_hold_ms, __ATOMIC_ACQUIRE);
    if (hold_ms && next > (uint64_t)hold_ms * 1000u) {
      /* Clock hold: park here until the outside world releases or raises the hold (vdev_io.h). */
      if (s_now_us < (uint64_t)hold_ms * 1000u) { s_now_us = (uint64_t)hold_ms * 1000u; publish_clock(); }
      __atomic_store_n(&vdev_io()->clock_parked, 1u, __ATOMIC_RELEASE);
      pthread_mutex_unlock(&G);
      struct timespec ts = {0, 1000000L};
      nanosleep(&ts, NULL);
      pthread_mutex_lock(&G);
      continue;
    }
    __atomic_store_n(&vdev_io()->clock_parked, 0u, __ATOMIC_RELEASE);
    if (next > s_now_us) {
      /* 不跑到墙上时间前面 */
      double lag_ms = (double)next / 1000.0 - real_ms();
      if (lag_ms > 0) {
        pthread_mutex_unlock(&G);
        struct timespec ts = {(time_t)(lag_ms / 1000.0), (long)(((long long)(lag_ms * 1000.0) % 1000000LL) * 1000LL)};
        nanosleep(&ts, NULL);
        pthread_mutex_lock(&G);
      }
      s_now_us = next;
      publish_clock();
    }
    wake_expired();
    return;
  }
}

/* 把 CPU 交给下一个就绪任务（必要时推进时钟） */
static void dispatch(void) {
  struct vhw_task* next;
  while (!(next = pick_ready())) advance_clock();
  next->state = T_RUNNING;
  s_running = next;
  pthread_cond_signal(&next->cv);
}

/* 当前任务等到轮到自己 */
static void wait_turn(struct vhw_task* self) {
  while (self->state != T_RUNNING) pthread_cond_wait(&self->cv, &G);
}

/* 当前任务阻塞在 obj 上直到被唤醒或到 deadline；返回 1 = 被唤醒，0 = 超时 */
static int block_on(const void* obj, uint64_t deadline) {
  struct vhw_task* self = t_self;
  self->state = T_BLOCKED;
  self->waiting_on = obj;
  self->deadline = deadline;
  self->timed_out = 0;
  wake_expired();
  dispatch();
  wait_turn(self);
  return !self->timed_out;
}

/* 唤醒所有阻塞在 obj 上的任务（它们醒来后自己重新检查条件） */
static void wake_all(const void* obj) {
  for (int i = 0; i < s_task_count; i++) {
    struct vhw_task* t = s_tasks[i];
    if (t->state == T_BLOCKED && t->waiting_on == obj && obj) {
      make_ready(t);
      t->timed_out = 0;
    }
  }
}

/* 让出 CPU：排到就绪队列末尾 */
static void yield_locked(void) {
  struct vhw_task* self = t_self;
  wake_expired(); /* 先于自己排队：到期的任务排在让出者前面 */
  make_ready(self);
  dispatch();
  wait_turn(self);
}

/* 排查用：把全部任务的状态打到日志（JS 侧 module._vhw_vt_dump()）。 */
EMSCRIPTEN_KEEPALIVE void vhw_vt_dump(void) {
  pthread_mutex_lock(&G);
  static const char* names[] = {"?", "ready", "running", "blocked", "deleted"};
  vdev_logf("[vt] t=%llu ms, %d tasks\n", (unsigned long long)(s_now_us / 1000), s_task_count);
  for (int i = 0; i < s_task_count; i++) {
    struct vhw_task* t = s_tasks[i];
    vdev_logf("[vt]   #%d %-20s %-8s on=%p deadline=%lld\n", t->id, t->name, names[t->state < 5 ? t->state : 0], t->waiting_on,
              t->deadline == NO_DEADLINE ? -1LL : (long long)(t->deadline / 1000));
  }
  pthread_mutex_unlock(&G);
}

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
  t->deadline = NO_DEADLINE;
  pthread_cond_init(&t->cv, NULL);
  t->id = s_task_count;
  if (s_task_count < VHW_MAX_TASKS) s_tasks[s_task_count++] = t;
  return t;
}

/* 主线程（IDF main 任务）成为第一个任务，直接持有 CPU */
struct vhw_task* vhw_task_adopt_current(const char* name, uint32_t stack) {
  pthread_mutex_lock(&G);
  if (!t_self) {
    (void)real_ms();
    t_self = task_new(name, NULL, NULL, 1, 0, stack);
    if (t_self) {
      t_self->thread = pthread_self();
      if (!s_running) {
        t_self->state = T_RUNNING;
        s_running = t_self;
      } else {
        /* 非任务线程：排队等 CPU */
        make_ready(t_self);
        wait_turn(t_self);
      }
    }
  }
  pthread_mutex_unlock(&G);
  return t_self;
}

static void* task_trampoline(void* p) {
  struct vhw_task* t = p;
  t_self = t;
  pthread_mutex_lock(&G);
  wait_turn(t);
  pthread_mutex_unlock(&G);
  t->fn(t->arg);
  vTaskDelete(NULL); /* FreeRTOS 任务函数不允许返回；当作删除自己 */
  return NULL;
}

BaseType_t xTaskCreatePinnedToCore(TaskFunction_t fn, const char* name, uint32_t stack_bytes, void* arg,
                                   UBaseType_t prio, TaskHandle_t* out, BaseType_t core) {
  pthread_mutex_lock(&G);
  struct vhw_task* t = task_new(name, fn, arg, prio, core, stack_bytes);
  if (!t) { pthread_mutex_unlock(&G); return errCOULD_NOT_ALLOCATE_REQUIRED_MEMORY; }
  t->state = T_BLOCKED; /* 线程起来之前不参与调度 */
  pthread_mutex_unlock(&G);
  pthread_attr_t attr;
  pthread_attr_init(&attr);
  pthread_attr_setdetachstate(&attr, PTHREAD_CREATE_DETACHED);
  size_t stack = (size_t)stack_bytes * 4;
  if (stack < 256 * 1024) stack = 256 * 1024;
  pthread_attr_setstacksize(&attr, stack);
  int rc = pthread_create(&t->thread, &attr, task_trampoline, t);
  pthread_attr_destroy(&attr);
  pthread_mutex_lock(&G);
  if (rc != 0) {
    t->state = T_DELETED;
    pthread_mutex_unlock(&G);
    vdev_logf("[vhw] xTaskCreate(%s) failed rc=%d\n", t->name, rc);
    return errCOULD_NOT_ALLOCATE_REQUIRED_MEMORY;
  }
  make_ready(t);
  pthread_mutex_unlock(&G);
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
  pthread_mutex_lock(&G);
  if (t == NULL || t == t_self) {
    struct vhw_task* self = t_self;
    self->state = T_DELETED;
    if (s_running == self) dispatch();
    pthread_mutex_unlock(&G);
    pthread_exit(NULL);
  }
  t->state = T_DELETED; /* 它的线程永远等不到 CPU */
  pthread_mutex_unlock(&G);
}

void vhw_yield(void) {
  pthread_mutex_lock(&G);
  yield_locked();
  pthread_mutex_unlock(&G);
}

void vTaskDelay(TickType_t ticks) {
  pthread_mutex_lock(&G);
  if (ticks == 0) yield_locked();
  else (void)block_on(NULL, deadline_after(ticks));
  pthread_mutex_unlock(&G);
}

BaseType_t xTaskDelayUntil(TickType_t* prev, TickType_t inc) {
  pthread_mutex_lock(&G);
  TickType_t target = *prev + inc;
  TickType_t now = (TickType_t)(s_now_us / 1000);
  BaseType_t delayed = pdFALSE;
  if ((int32_t)(target - now) > 0) {
    (void)block_on(NULL, (uint64_t)target * 1000u);
    delayed = pdTRUE;
  }
  *prev = target;
  pthread_mutex_unlock(&G);
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
  pthread_mutex_lock(&G);
  for (int i = 0; i < s_task_count; i++)
    if (s_tasks[i]->state != T_DELETED && strncmp(s_tasks[i]->name, name, sizeof s_tasks[i]->name - 1) == 0) found = s_tasks[i];
  pthread_mutex_unlock(&G);
  return found;
}

char* pcTaskGetName(TaskHandle_t t) {
  if (!t) t = xTaskGetCurrentTaskHandle();
  return t ? t->name : (char*)"?";
}

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
  pthread_mutex_lock(&G);
  for (int i = 0; i < s_task_count; i++) n += s_tasks[i]->state != T_DELETED;
  pthread_mutex_unlock(&G);
  return (UBaseType_t)n;
}
UBaseType_t uxTaskGetSystemState(TaskStatus_t* arr, UBaseType_t n, uint32_t* total) {
  UBaseType_t k = 0;
  pthread_mutex_lock(&G);
  for (int i = 0; i < s_task_count && k < n; i++) {
    struct vhw_task* t = s_tasks[i];
    if (t->state == T_DELETED) continue;
    eTaskState st = t->state == T_RUNNING ? eRunning : t->state == T_READY ? eReady : eBlocked;
    arr[k++] = (TaskStatus_t){t, t->name, (UBaseType_t)t->id, st, t->prio, t->prio, 0, NULL, t->stack_bytes / 2, t->core};
  }
  pthread_mutex_unlock(&G);
  if (total) *total = 0;
  return k;
}
void vTaskGetRunTimeStats(char* buf) { if (buf) buf[0] = '\0'; }
void vTaskList(char* buf) { if (buf) buf[0] = '\0'; }
eTaskState eTaskGetState(TaskHandle_t t) {
  if (!t) return eInvalid;
  switch (t->state) {
    case T_RUNNING: return eRunning;
    case T_READY: return eReady;
    case T_BLOCKED: return eBlocked;
    default: return eDeleted;
  }
}
void vTaskSuspend(TaskHandle_t t) { (void)t; }
void vTaskResume(TaskHandle_t t) { (void)t; }
void vTaskSuspendAll(void) {}
BaseType_t xTaskResumeAll(void) { return pdFALSE; }
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
  pthread_mutex_lock(&G);
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
  wake_all(&t->notify_value[idx]);
  pthread_mutex_unlock(&G);
  return rc;
}

uint32_t ulTaskGenericNotifyTake(UBaseType_t idx, BaseType_t clear, TickType_t wait) {
  struct vhw_task* t = xTaskGetCurrentTaskHandle();
  if (!t || idx >= VHW_NOTIFY_SLOTS) return 0;
  pthread_mutex_lock(&G);
  const uint64_t deadline = deadline_after(wait);
  while (t->notify_value[idx] == 0 && wait != 0) {
    if (!block_on(&t->notify_value[idx], deadline)) break;
  }
  uint32_t v = t->notify_value[idx];
  if (v) t->notify_value[idx] = clear ? 0 : v - 1;
  t->notify_pending[idx] = 0;
  pthread_mutex_unlock(&G);
  return v;
}

BaseType_t xTaskGenericNotifyWait(UBaseType_t idx, uint32_t clear_entry, uint32_t clear_exit, uint32_t* value, TickType_t wait) {
  struct vhw_task* t = xTaskGetCurrentTaskHandle();
  if (!t || idx >= VHW_NOTIFY_SLOTS) return pdFAIL;
  pthread_mutex_lock(&G);
  if (!t->notify_pending[idx]) t->notify_value[idx] &= ~clear_entry;
  const uint64_t deadline = deadline_after(wait);
  while (!t->notify_pending[idx] && wait != 0) {
    if (!block_on(&t->notify_value[idx], deadline)) break;
  }
  int got = t->notify_pending[idx];
  if (value) *value = t->notify_value[idx];
  if (got) { t->notify_value[idx] &= ~clear_exit; t->notify_pending[idx] = 0; }
  pthread_mutex_unlock(&G);
  return got ? pdPASS : pdFAIL;
}

/* ---------------- 临界区：同一时刻只有一个任务在跑，只计嵌套 ---------------- */

void vhw_enter_critical(portMUX_TYPE* mux) { mux->count++; }
void vhw_exit_critical(portMUX_TYPE* mux) { if (mux->count > 0) mux->count--; }

/* ---------------- 队列 / 信号量 ---------------- */

struct vhw_queue {
  int type;
  UBaseType_t len, item_size, count, head;
  uint8_t* buf;
  struct vhw_task* owner;
  int recursion;
};

QueueHandle_t vhw_queue_create(UBaseType_t len, UBaseType_t item_size, int type, UBaseType_t initial) {
  struct vhw_queue* q = calloc(1, sizeof *q);
  if (!q) return NULL;
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
  free(q->buf);
  free(q);
}

BaseType_t vhw_queue_send(QueueHandle_t q, const void* item, TickType_t wait, int pos) {
  if (!q) return pdFAIL;
  pthread_mutex_lock(&G);
  if (q->type == VHW_Q_MUTEX || q->type == VHW_Q_RECURSIVE) {
    BaseType_t rc = pdFAIL;
    if (q->owner == t_self || q->owner == NULL) {
      if (q->type == VHW_Q_RECURSIVE && q->recursion > 1) { q->recursion--; rc = pdPASS; }
      else if (q->count == 0) { q->count = 1; q->owner = NULL; q->recursion = 0; rc = pdPASS; wake_all(q); }
    }
    pthread_mutex_unlock(&G);
    return rc;
  }
  if (pos == queueOVERWRITE && q->count >= q->len) q->count = 0, q->head = 0;
  const uint64_t deadline = deadline_after(wait);
  while (q->count >= q->len && wait != 0) {
    if (!block_on(q, deadline)) break;
  }
  int ok = q->count < q->len;
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
    wake_all(q);
  }
  pthread_mutex_unlock(&G);
  return ok ? pdPASS : errQUEUE_FULL;
}

BaseType_t vhw_queue_receive(QueueHandle_t q, void* out, TickType_t wait, int peek) {
  if (!q) return pdFAIL;
  pthread_mutex_lock(&G);
  if (q->type == VHW_Q_RECURSIVE && q->owner == t_self && q->owner && q->count == 0) {
    q->recursion++;
    pthread_mutex_unlock(&G);
    return pdPASS;
  }
  const uint64_t deadline = deadline_after(wait);
  while (q->count == 0 && wait != 0) {
    if (!block_on(q, deadline)) break;
  }
  int ok = q->count > 0;
  if (ok) {
    if (q->item_size && out) memcpy(out, q->buf + (size_t)q->head * q->item_size, q->item_size);
    if (!peek) {
      if (q->item_size) q->head = (q->head + 1) % q->len;
      q->count--;
      if (q->type == VHW_Q_MUTEX || q->type == VHW_Q_RECURSIVE) {
        q->owner = t_self;
        q->recursion = 1;
      }
    }
    wake_all(q);
  }
  pthread_mutex_unlock(&G);
  return ok ? pdPASS : errQUEUE_EMPTY;
}

BaseType_t xQueueReset(QueueHandle_t q) {
  if (!q) return pdFAIL;
  pthread_mutex_lock(&G);
  q->count = 0;
  q->head = 0;
  wake_all(q);
  pthread_mutex_unlock(&G);
  return pdPASS;
}

UBaseType_t uxQueueMessagesWaiting(QueueHandle_t q) {
  if (!q) return 0;
  pthread_mutex_lock(&G);
  UBaseType_t n = q->count;
  pthread_mutex_unlock(&G);
  return n;
}

UBaseType_t uxQueueSpacesAvailable(QueueHandle_t q) {
  if (!q) return 0;
  pthread_mutex_lock(&G);
  UBaseType_t n = q->len - q->count;
  pthread_mutex_unlock(&G);
  return n;
}

BaseType_t xQueueIsQueueEmptyFromISR(QueueHandle_t q) { return uxQueueMessagesWaiting(q) == 0; }
BaseType_t xQueueIsQueueFullFromISR(QueueHandle_t q) { return uxQueueSpacesAvailable(q) == 0; }
void vQueueAddToRegistry(QueueHandle_t q, const char* name) { (void)q; (void)name; }
TaskHandle_t xSemaphoreGetMutexHolder(SemaphoreHandle_t s) { return s ? s->owner : NULL; }

/* ---------------- 事件组 ---------------- */

struct vhw_event_group { EventBits_t bits; };

EventGroupHandle_t xEventGroupCreate(void) { return calloc(1, sizeof(struct vhw_event_group)); }
void vEventGroupDelete(EventGroupHandle_t g) { free(g); }
EventBits_t xEventGroupSetBits(EventGroupHandle_t g, EventBits_t bits) {
  pthread_mutex_lock(&G);
  g->bits |= bits;
  EventBits_t v = g->bits;
  wake_all(g);
  pthread_mutex_unlock(&G);
  return v;
}
EventBits_t xEventGroupClearBits(EventGroupHandle_t g, EventBits_t bits) {
  pthread_mutex_lock(&G);
  EventBits_t v = g->bits;
  g->bits &= ~bits;
  pthread_mutex_unlock(&G);
  return v;
}
EventBits_t xEventGroupGetBits(EventGroupHandle_t g) {
  pthread_mutex_lock(&G);
  EventBits_t v = g->bits;
  pthread_mutex_unlock(&G);
  return v;
}
EventBits_t xEventGroupWaitBits(EventGroupHandle_t g, EventBits_t bits, BaseType_t clear, BaseType_t all, TickType_t wait) {
  pthread_mutex_lock(&G);
  const uint64_t deadline = deadline_after(wait);
#define EG_OK (all ? ((g->bits & bits) == bits) : ((g->bits & bits) != 0))
  while (!EG_OK && wait != 0) {
    if (!block_on(g, deadline)) break;
  }
  int ok = EG_OK;
#undef EG_OK
  EventBits_t v = g->bits;
  if (ok && clear) g->bits &= ~bits;
  pthread_mutex_unlock(&G);
  return v;
}

#endif /* VHW_VIRTUAL_TIME */
