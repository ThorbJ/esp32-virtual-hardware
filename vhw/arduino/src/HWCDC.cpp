/* USB 串口（HWCDC）→ 接口字节流。见 include/HWCDC.h。 */
#include "HWCDC.h"

#include <Arduino.h>

#include "vdev_io.h"

HWCDC HWCDCSerial;

HWCDC::HWCDC() {}
size_t HWCDC::setRxBufferSize(size_t n) { return n; }
size_t HWCDC::setTxBufferSize(size_t n) { return n; }
void HWCDC::setTxTimeoutMs(uint32_t t) { tx_timeout_ms_ = t; }
void HWCDC::begin(unsigned long baud) { (void)baud; }
void HWCDC::end() {}

int HWCDC::available(void) { return (int)vdev_ring_readable(VDEV_RING_HOST_RX) + (peeked_ >= 0 ? 1 : 0); }
int HWCDC::availableForWrite(void) { return isPlugged() ? (int)vdev_ring_writable(VDEV_RING_HOST_TX) : 0; }

int HWCDC::peek(void) {
  if (peeked_ < 0) {
    uint8_t b;
    if (vdev_ring_read(VDEV_RING_HOST_RX, &b, 1) == 1) peeked_ = b;
  }
  return peeked_;
}

int HWCDC::read(void) {
  if (peeked_ >= 0) { int v = peeked_; peeked_ = -1; return v; }
  uint8_t b;
  return vdev_ring_read(VDEV_RING_HOST_RX, &b, 1) == 1 ? b : -1;
}

size_t HWCDC::read(uint8_t* buf, size_t size) {
  size_t n = 0;
  if (size && peeked_ >= 0) { buf[n++] = (uint8_t)peeked_; peeked_ = -1; }
  return n + vdev_ring_read(VDEV_RING_HOST_RX, buf + n, size - n);
}

size_t HWCDC::write(uint8_t b) { return write(&b, 1); }

size_t HWCDC::write(const uint8_t* buf, size_t size) {
  /* 串口打印：总是进日志通道；电脑端在线时同时发给电脑端 */
  vdev_log_write(reinterpret_cast<const char*>(buf), size);
  vdev_host_write(buf, size, tx_timeout_ms_);
  return size;
}

void HWCDC::flush(void) {}
bool HWCDC::isPlugged(void) { return __atomic_load_n(&vdev_io()->host_present, __ATOMIC_ACQUIRE) != 0; }
bool HWCDC::isConnected(void) { return isPlugged(); }
HWCDC::operator bool() const { return isPlugged(); }
void HWCDC::setDebugOutput(bool) {}
