/*
 * 虚拟 SPI 总线：上层（Arduino SPIClass 或 IDF spi_master）把字节交给这里，
 * 这里转给片选脚为低的虚拟外设。外设在设备专用层挂上来（vhw_spi_attach）。
 */
#pragma once
#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif

typedef struct vhw_spi_device {
  int cs_pin;  /* 片选脚；-1 = 总线上唯一外设，总是选中 */
  void* ctx;
  void (*on_bytes)(void* ctx, const uint8_t* data, size_t len);
  void (*on_cs)(void* ctx, int level); /* 片选电平变化（高 = 一次传输结束） */
} vhw_spi_device_t;

void vhw_spi_attach(int bus, vhw_spi_device_t* dev);
void vhw_spi_write(int bus, const uint8_t* data, size_t len);
/* GPIO 层在任何输出脚变化时调用，SPI 层据此通知外设片选变化 */
void vhw_spi_on_gpio(int gpio, int level);
/* 读 GPIO 输出电平（外设用来看 DC 脚等） */
int vhw_gpio_output_level(int gpio);

#ifdef __cplusplus
}
#endif
