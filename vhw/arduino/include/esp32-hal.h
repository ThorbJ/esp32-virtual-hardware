/* arduino-esp32 的 HAL 层（时间、引脚、PSRAM、温度）在虚拟硬件上的对应。 */
#pragma once
#ifndef HAL_ESP32_HAL_H_
#define HAL_ESP32_HAL_H_
#endif
#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include "sdkconfig.h"
#include "esp_system.h"
#include "esp_sleep.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "soc/soc_caps.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "freertos/event_groups.h"
#include "esp32-hal-log.h"

#ifdef __cplusplus
extern "C" {
#endif

#ifndef F_CPU
#define F_CPU 240000000U
#endif
#define ARDUINO_ISR_ATTR
#define ARDUINO_ISR_FLAG 0
#define ARDUINO_RUNNING_CORE CONFIG_ARDUINO_RUNNING_CORE
#define ARDUINO_EVENT_RUNNING_CORE CONFIG_ARDUINO_EVENT_RUNNING_CORE

/* 引脚 */
#define LOW 0x0
#define HIGH 0x1
#define INPUT 0x01
#define OUTPUT 0x03
#define PULLUP 0x04
#define INPUT_PULLUP 0x05
#define PULLDOWN 0x08
#define INPUT_PULLDOWN 0x09
#define OPEN_DRAIN 0x10
#define OUTPUT_OPEN_DRAIN 0x13
#define ANALOG 0xC0
void pinMode(uint8_t pin, uint8_t mode);
void digitalWrite(uint8_t pin, uint8_t val);
int digitalRead(uint8_t pin);
uint16_t analogRead(uint8_t pin);
uint32_t analogReadMilliVolts(uint8_t pin);
void analogWrite(uint8_t pin, int value);
void attachInterrupt(uint8_t pin, void (*)(void), int mode);
void attachInterruptArg(uint8_t pin, void (*)(void*), void* arg, int mode);
void detachInterrupt(uint8_t pin);

/* 时间 */
unsigned long micros(void);
unsigned long millis(void);
void delay(uint32_t ms);
void delayMicroseconds(uint32_t us);
void yield(void);

/* 芯片 */
float temperatureRead(void);
bool psramFound(void);
bool psramInit(void);
void* ps_malloc(size_t size);
void* ps_calloc(size_t n, size_t size);
void* ps_realloc(void* ptr, size_t size);
bool setCpuFrequencyMhz(uint32_t cpu_freq_mhz);
uint32_t getCpuFrequencyMhz(void);
uint32_t getXtalFrequencyMhz(void);
uint32_t getApbFrequency(void);
const char* pathToFileName(const char* path);
bool btInUse(void);
void arduino_phy_init(void);
bool verifyOta(void);
bool verifyRollbackLater(void);

#ifdef __cplusplus
}
#endif
