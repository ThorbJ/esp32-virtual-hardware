/* 内存段属性：浏览器里只有一块线性内存，全部为空。 */
#pragma once
#define IRAM_ATTR
#define DRAM_ATTR
#define IRAM_DATA_ATTR
#define IRAM_BSS_ATTR
#define DMA_ATTR
#define WORD_ALIGNED_ATTR __attribute__((aligned(4)))
#define EXT_RAM_ATTR
#define EXT_RAM_BSS_ATTR
#define EXT_RAM_NOINIT_ATTR
#define RTC_DATA_ATTR
#define RTC_NOINIT_ATTR
#define RTC_RODATA_ATTR
#define RTC_IRAM_ATTR
#define RTC_FAST_ATTR
#define RTC_SLOW_ATTR
#define NOINIT_ATTR
#define COREDUMP_DRAM_ATTR
#define FLASH_ATTR
#define PSRAM_ATTR
#define IRAM_ATTR_FN
#define NOINLINE_ATTR __attribute__((noinline))
#define FORCE_INLINE_ATTR static inline __attribute__((always_inline))
#define ESP_ATTR_NO_RETURN __attribute__((noreturn))
#ifndef __NOINIT_ATTR
#define __NOINIT_ATTR
#endif
#define _SECTION_ATTR_IMPL(s, c)
#define TCM_IRAM_ATTR
#define TCM_DRAM_ATTR
#define ESP_ALWAYS_INLINE inline __attribute__((always_inline))
#define ESP_STATIC_ASSERT _Static_assert
