/*
 * arduino-esp32 的 SPIClass → 虚拟 SPI 总线（vhw/include/vhw_spi.h）。
 * 发出去的字节交给片选（CS）为低的虚拟外设，例如 ST7789 屏幕模型。接口与上游 SPI.h 一致。
 */
#pragma once
#include <stdint.h>
#include <stddef.h>
#include "esp32-hal.h"

#define SPI_HAS_TRANSACTION
#define SPI_MODE0 0
#define SPI_MODE1 1
#define SPI_MODE2 2
#define SPI_MODE3 3
#define SPI_LSBFIRST 0
#define SPI_MSBFIRST 1
#define SPI_CLOCK_DIV2 0x00101001
#define SPI_CLOCK_DIV4 0x00241001
#define SPI_CLOCK_DIV8 0x004c1001
#define SPI_CLOCK_DIV16 0x009c1001
#define SPI_CLOCK_DIV32 0x013c1001
#define SPI_CLOCK_DIV64 0x027c1001
#define SPI_CLOCK_DIV128 0x04fc1001
#define FSPI 0
#define HSPI 1
#define VSPI 1

class SPISettings {
public:
  SPISettings() : _clock(1000000), _bitOrder(SPI_MSBFIRST), _dataMode(SPI_MODE0) {}
  SPISettings(uint32_t clock, uint8_t bitOrder, uint8_t dataMode) : _clock(clock), _bitOrder(bitOrder), _dataMode(dataMode) {}
  uint32_t _clock;
  uint8_t _bitOrder;
  uint8_t _dataMode;
};

class SPIClass {
public:
  explicit SPIClass(uint8_t spi_bus = FSPI);
  bool begin(int8_t sck = -1, int8_t miso = -1, int8_t mosi = -1, int8_t ss = -1);
  void end();
  void setHwCs(bool use);
  void setSSInvert(bool invert);
  void setBitOrder(uint8_t bitOrder);
  void setDataMode(uint8_t dataMode);
  void setFrequency(uint32_t freq);
  void setClockDivider(uint32_t clockDiv);
  uint32_t getClockDivider();
  void beginTransaction(SPISettings settings);
  void endTransaction(void);
  void transfer(void* data, uint32_t size);
  uint8_t transfer(uint8_t data);
  uint16_t transfer16(uint16_t data);
  uint32_t transfer32(uint32_t data);
  void transferBytes(const uint8_t* data, uint8_t* out, uint32_t size);
  void transferBits(uint32_t data, uint32_t* out, uint8_t bits);
  void write(uint8_t data);
  void write16(uint16_t data);
  void write32(uint32_t data);
  void writeBytes(const uint8_t* data, uint32_t size);
  void writePixels(const void* data, uint32_t size);
  void writePattern(const uint8_t* data, uint8_t size, uint32_t repeat);
  int8_t pinSS() { return _ss; }

private:
  uint8_t _bus;
  int8_t _sck = -1, _miso = -1, _mosi = -1, _ss = -1;
  uint32_t _freq = 1000000;
  uint8_t _mode = SPI_MODE0;
};

extern SPIClass SPI;
