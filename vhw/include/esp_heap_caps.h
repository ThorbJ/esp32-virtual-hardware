/* 内存能力（内部 RAM / PSRAM / DMA）：浏览器里只有一块堆，能力参数忽略；
 * 剩余量按真机量级报告（固件会据此决定是否启动相机等），避免因"内存不足"走降级分支。 */
#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

#define MALLOC_CAP_EXEC (1 << 0)
#define MALLOC_CAP_32BIT (1 << 1)
#define MALLOC_CAP_8BIT (1 << 2)
#define MALLOC_CAP_DMA (1 << 3)
#define MALLOC_CAP_PID2 (1 << 4)
#define MALLOC_CAP_SPIRAM (1 << 10)
#define MALLOC_CAP_INTERNAL (1 << 11)
#define MALLOC_CAP_DEFAULT (1 << 12)
#define MALLOC_CAP_IRAM_8BIT (1 << 13)
#define MALLOC_CAP_RETENTION (1 << 14)
#define MALLOC_CAP_RTCRAM (1 << 15)
#define MALLOC_CAP_TCM (1 << 16)
#define MALLOC_CAP_DMA_DESC_AHB (1 << 17)
#define MALLOC_CAP_DMA_DESC_AXI (1 << 18)
#define MALLOC_CAP_CACHE_ALIGNED (1 << 19)
#define MALLOC_CAP_SIMD (1 << 20)
#define MALLOC_CAP_INVALID (1 << 31)

typedef struct {
  size_t total_free_bytes;
  size_t total_allocated_bytes;
  size_t largest_free_block;
  size_t minimum_free_bytes;
  size_t allocated_blocks;
  size_t free_blocks;
  size_t total_blocks;
} multi_heap_info_t;

typedef void (*esp_alloc_failed_hook_t)(size_t size, uint32_t caps, const char* function_name);

void* heap_caps_malloc(size_t size, uint32_t caps);
void* heap_caps_calloc(size_t n, size_t size, uint32_t caps);
void* heap_caps_realloc(void* ptr, size_t size, uint32_t caps);
void* heap_caps_aligned_alloc(size_t alignment, size_t size, uint32_t caps);
void* heap_caps_aligned_calloc(size_t alignment, size_t n, size_t size, uint32_t caps);
void* heap_caps_malloc_prefer(size_t size, size_t num, ...);
void heap_caps_free(void* ptr);
void heap_caps_aligned_free(void* ptr);
size_t heap_caps_get_free_size(uint32_t caps);
size_t heap_caps_get_total_size(uint32_t caps);
size_t heap_caps_get_minimum_free_size(uint32_t caps);
size_t heap_caps_get_largest_free_block(uint32_t caps);
size_t heap_caps_get_allocated_size(void* ptr);
void heap_caps_get_info(multi_heap_info_t* info, uint32_t caps);
void heap_caps_print_heap_info(uint32_t caps);
bool heap_caps_check_integrity_all(bool print_errors);
bool heap_caps_check_integrity(uint32_t caps, bool print_errors);
void heap_caps_malloc_extmem_enable(size_t limit);
esp_err_t heap_caps_register_failed_alloc_callback(esp_alloc_failed_hook_t callback);
void heap_caps_dump(uint32_t caps);
void heap_caps_dump_all(void);
bool esp_ptr_external_ram(const void* p);
bool esp_ptr_internal(const void* p);
bool esp_ptr_dma_capable(const void* p);
bool esp_ptr_in_dram(const void* p);

#ifdef __cplusplus
}
#endif
