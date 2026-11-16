/* arduino-esp32 的 ESP 对象：内存数字按 ESP32-S3 + 8 MB PSRAM 的量级报告。 */
#pragma once
#include <stdint.h>
#include "WString.h"

class EspClass {
public:
  uint32_t getHeapSize();
  uint32_t getFreeHeap();
  uint32_t getMinFreeHeap();
  uint32_t getMaxAllocHeap();
  uint32_t getPsramSize();
  uint32_t getFreePsram();
  uint32_t getMinFreePsram();
  uint32_t getMaxAllocPsram();
  uint16_t getChipRevision();
  const char* getChipModel();
  uint8_t getChipCores();
  uint32_t getCpuFreqMHz();
  uint32_t getCycleCount();
  const char* getSdkVersion();
  const char* getCoreVersion();
  uint32_t getFlashChipSize();
  uint32_t getFlashChipSpeed();
  uint32_t getSketchSize();
  uint32_t getFreeSketchSpace();
  String getSketchMD5();
  uint64_t getEfuseMac();
  void restart() __attribute__((noreturn));
  void deepSleep(uint64_t time_us) __attribute__((noreturn));
};

extern EspClass ESP;
