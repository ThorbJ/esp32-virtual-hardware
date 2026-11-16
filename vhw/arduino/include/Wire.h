/* I2C（Wire）：上游小歪固件只 include 了头文件、没有用到总线；给一个空壳以便编译。 */
#pragma once
#include "Arduino.h"
class TwoWire : public Stream {
public:
  explicit TwoWire(uint8_t bus = 0) : _bus(bus) {}
  bool begin(int sda = -1, int scl = -1, uint32_t frequency = 0) { (void)sda; (void)scl; (void)frequency; return true; }
  bool end() { return true; }
  void beginTransmission(uint16_t) {}
  uint8_t endTransmission(bool = true) { return 2; /* NACK：总线上没有设备 */ }
  size_t requestFrom(uint16_t, size_t, bool = true) { return 0; }
  size_t write(uint8_t) override { return 0; }
  size_t write(const uint8_t*, size_t) override { return 0; }
  int available() override { return 0; }
  int read() override { return -1; }
  int peek() override { return -1; }
  void flush() override {}
  bool setClock(uint32_t) { return true; }
private:
  uint8_t _bus;
};
extern TwoWire Wire;
