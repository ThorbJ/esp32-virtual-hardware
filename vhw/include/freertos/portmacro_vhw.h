/* ESP-IDF 习惯从 FreeRTOS.h 间接拿到的东西（IDF 的 FreeRTOS.h 末尾也会带上 idf_additions.h）：
 * 任务 / 队列 / 信号量声明一并带上，免得上游代码漏 include 时编译失败。 */
#pragma once
#include "freertos/task.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "freertos/idf_additions.h"
/* IDF 的 FreeRTOS 移植层（portable.h）也会带上内存能力 API；上游代码依赖这一点 */
#include "esp_heap_caps.h"
