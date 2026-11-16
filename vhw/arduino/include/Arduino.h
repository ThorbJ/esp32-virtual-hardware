/*
 * 虚拟硬件层的 Arduino.h（对应 arduino-esp32 3.3.2 的 cores/esp32/Arduino.h）。
 *
 * 只换掉"直接操作芯片"的部分（引脚、时间、ESP 对象、串口），String / Print / Stream 等可移植部分
 * 直接用上游核心源码（编译时复制到 build/<设备>/arduino-core/，内容不改）。
 */
#pragma once

#include <inttypes.h>
#include <math.h>
#include <stdarg.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "sdkconfig.h"
#include "esp_arduino_version.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"
#include "esp32-hal.h"
#include "stdlib_noniso.h"
#include "binary.h"

#define PI 3.1415926535897932384626433832795
#define HALF_PI 1.5707963267948966192313216916398
#define TWO_PI 6.283185307179586476925286766559
#define DEG_TO_RAD 0.017453292519943295769236907684886
#define RAD_TO_DEG 57.295779513082320876798154814105
#define EULER 2.718281828459045235360287471352
#define SERIAL 0x0
#define DISPLAY 0x1
#define LSBFIRST 0
#define MSBFIRST 1
#define RISING 0x01
#define FALLING 0x02
#define CHANGE 0x03
#define ONLOW 0x04
#define ONHIGH 0x05
#define DEFAULT 1
#define EXTERNAL 0
#ifndef __STRINGIFY
#define __STRINGIFY(a) #a
#endif
#define _min(a, b) ((a) < (b) ? (a) : (b))
#define _max(a, b) ((a) > (b) ? (a) : (b))
#define _abs(x) ((x) > 0 ? (x) : -(x))
#define constrain(amt, low, high) ((amt) < (low) ? (low) : ((amt) > (high) ? (high) : (amt)))
#define _round(x) ((x) >= 0 ? (long)((x) + 0.5) : (long)((x) - 0.5))
#define radians(deg) ((deg) * DEG_TO_RAD)
#define degrees(rad) ((rad) * RAD_TO_DEG)
#define sq(x) ((x) * (x))
#define sei() portENABLE_INTERRUPTS()
#define cli() portDISABLE_INTERRUPTS()
#define interrupts() sei()
#define noInterrupts() cli()
#define clockCyclesPerMicrosecond() ((long int)getCpuFrequencyMhz())
#define clockCyclesToMicroseconds(a) ((a) / clockCyclesPerMicrosecond())
#define microsecondsToClockCycles(a) ((a) * clockCyclesPerMicrosecond())
#define lowByte(w) ((uint8_t)((w) & 0xff))
#define highByte(w) ((uint8_t)((w) >> 8))
#define bitRead(value, bit) (((value) >> (bit)) & 0x01)
#define bitSet(value, bit) ((value) |= (1UL << (bit)))
#define bitClear(value, bit) ((value) &= ~(1UL << (bit)))
#define bitToggle(value, bit) ((value) ^= (1UL << (bit)))
#define bitWrite(value, bit, bitvalue) ((bitvalue) ? bitSet(value, bit) : bitClear(value, bit))
#define bit(b) (1UL << (b))
#define _BV(b) (1UL << (b))
#define NOT_A_PIN -1
#define NOT_A_PORT -1
#define NOT_AN_INTERRUPT -1
#define NOT_ON_TIMER 0
#define NUM_DIGITAL_PINS SOC_GPIO_PIN_COUNT
#define digitalPinToInterrupt(p) (p)
#define digitalPinHasPWM(p) ((p) < NUM_DIGITAL_PINS)
#define digitalPinToGPIONumber(p) (p)

typedef bool boolean;
typedef uint8_t byte;
typedef unsigned int word;

#ifdef __cplusplus
void setup(void);
void loop(void);
long random(long);
long random(long, long);
void randomSeed(unsigned long);
void useRealRandomGenerator(bool useRandomHW);
#endif
long map(long, long, long, long, long);

#ifdef __cplusplus
extern "C" {
#endif
void init(void);
void initVariant(void);
void initArduino(void);
unsigned long pulseIn(uint8_t pin, uint8_t state, unsigned long timeout);
unsigned long pulseInLong(uint8_t pin, uint8_t state, unsigned long timeout);
uint8_t shiftIn(uint8_t dataPin, uint8_t clockPin, uint8_t bitOrder);
void shiftOut(uint8_t dataPin, uint8_t clockPin, uint8_t bitOrder, uint8_t val);
#ifdef __cplusplus
}

#include <algorithm>
#include <cmath>

#include "WCharacter.h"
#include "WString.h"
#include "Stream.h"
#include "Printable.h"
#include "Print.h"
#include "Esp.h"
#include "HWCDC.h"

using std::abs;
using std::isinf;
using std::isnan;
using std::max;
using std::min;
using std::round;

uint16_t makeWord(uint16_t w);
uint16_t makeWord(uint8_t h, uint8_t l);
#define word(...) makeWord(__VA_ARGS__)

size_t getArduinoLoopTaskStackSize(void);
#define SET_LOOP_TASK_STACK_SIZE(sz) \
  size_t getArduinoLoopTaskStackSize() { return sz; }
#define SET_TIME_BEFORE_STARTING_SKETCH_MS(time_ms) \
  uint64_t getArduinoSetupWaitTime_ms() { return (time_ms); }

#endif /* __cplusplus */
