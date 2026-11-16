/* SPIClass → 虚拟 SPI 总线。字节顺序与 arduino-esp32 一致（writePixels 先发高字节）。 */
#include "SPI.h"

#include "vhw_spi.h"
#include <string.h>

SPIClass SPI(FSPI);

SPIClass::SPIClass(uint8_t bus) : _bus(bus) {}
bool SPIClass::begin(int8_t sck, int8_t miso, int8_t mosi, int8_t ss) {
  _sck = sck; _miso = miso; _mosi = mosi; _ss = ss;
  return true;
}
void SPIClass::end() {}
void SPIClass::setHwCs(bool use) { (void)use; }
void SPIClass::setSSInvert(bool invert) { (void)invert; }
void SPIClass::setBitOrder(uint8_t o) { (void)o; }
void SPIClass::setDataMode(uint8_t m) { _mode = m; }
void SPIClass::setFrequency(uint32_t f) { _freq = f; }
void SPIClass::setClockDivider(uint32_t d) { (void)d; }
uint32_t SPIClass::getClockDivider() { return 0; }
void SPIClass::beginTransaction(SPISettings s) { _freq = s._clock; _mode = s._dataMode; }
void SPIClass::endTransaction(void) {}

void SPIClass::write(uint8_t d) { vhw_spi_write(_bus, &d, 1); }
void SPIClass::write16(uint16_t d) {
  uint8_t b[2] = {(uint8_t)(d >> 8), (uint8_t)d};
  vhw_spi_write(_bus, b, 2);
}
void SPIClass::write32(uint32_t d) {
  uint8_t b[4] = {(uint8_t)(d >> 24), (uint8_t)(d >> 16), (uint8_t)(d >> 8), (uint8_t)d};
  vhw_spi_write(_bus, b, 4);
}
void SPIClass::writeBytes(const uint8_t* data, uint32_t size) { vhw_spi_write(_bus, data, size); }
void SPIClass::writePixels(const void* data, uint32_t size) {
  const uint8_t* p = static_cast<const uint8_t*>(data);
  uint8_t buf[256];
  uint32_t i = 0;
  while (i + 1 < size) {
    size_t n = 0;
    while (n + 2 <= sizeof buf && i + 1 < size) { buf[n++] = p[i + 1]; buf[n++] = p[i]; i += 2; }
    vhw_spi_write(_bus, buf, n);
  }
}
void SPIClass::writePattern(const uint8_t* data, uint8_t size, uint32_t repeat) {
  while (repeat--) vhw_spi_write(_bus, data, size);
}
/* 虚拟总线上没有会回话的外设：读回 0 */
uint8_t SPIClass::transfer(uint8_t d) { write(d); return 0; }
uint16_t SPIClass::transfer16(uint16_t d) { write16(d); return 0; }
uint32_t SPIClass::transfer32(uint32_t d) { write32(d); return 0; }
void SPIClass::transfer(void* data, uint32_t size) {
  vhw_spi_write(_bus, static_cast<uint8_t*>(data), size);
  memset(data, 0, size);
}
void SPIClass::transferBytes(const uint8_t* data, uint8_t* out, uint32_t size) {
  if (data) vhw_spi_write(_bus, data, size);
  if (out) memset(out, 0, size);
}
void SPIClass::transferBits(uint32_t data, uint32_t* out, uint8_t bits) {
  (void)bits;
  write32(data);
  if (out) *out = 0;
}
