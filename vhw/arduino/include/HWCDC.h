/*
 * USB 串口（ESP32-S3 内置 USB Serial/JTAG 的 CDC）→ 接口的电脑端字节流。
 * 写出的字节进 hostTx（电脑端在线时），同时抄一份到日志通道（这就是"串口打印"）；
 * 读入的字节来自 hostRx；isPlugged() = 接口的 hostPresent。
 */
#pragma once
#include <stdint.h>
#include <string.h>
#include "Stream.h"
#include "soc/soc_caps.h"

class HWCDC : public Stream {
public:
  HWCDC();
  size_t setRxBufferSize(size_t);
  size_t setTxBufferSize(size_t);
  void setTxTimeoutMs(uint32_t timeout);
  void begin(unsigned long baud = 0);
  void end();
  int available(void) override;
  int availableForWrite(void) override;
  int peek(void) override;
  int read(void) override;
  size_t read(uint8_t* buffer, size_t size);
  size_t write(uint8_t) override;
  size_t write(const uint8_t* buffer, size_t size) override;
  void flush(void) override;
  static bool isPlugged(void);
  static bool isConnected(void);
  inline size_t read(char* buffer, size_t size) { return read((uint8_t*)buffer, size); }
  inline size_t write(const char* buffer, size_t size) { return write((uint8_t*)buffer, size); }
  inline size_t write(const char* s) { return write((uint8_t*)s, strlen(s)); }
  inline size_t write(unsigned long n) { return write((uint8_t)n); }
  inline size_t write(long n) { return write((uint8_t)n); }
  inline size_t write(unsigned int n) { return write((uint8_t)n); }
  inline size_t write(int n) { return write((uint8_t)n); }
  operator bool() const;
  void setDebugOutput(bool);
  uint32_t baudRate() { return 115200; }

private:
  int peeked_ = -1;
  uint32_t tx_timeout_ms_ = 100;
};

#if ARDUINO_USB_MODE && ARDUINO_USB_CDC_ON_BOOT
#ifndef HWCDC_SERIAL_IS_DEFINED
#define HWCDC_SERIAL_IS_DEFINED 1
#endif
extern HWCDC HWCDCSerial;
#define Serial HWCDCSerial
#endif
