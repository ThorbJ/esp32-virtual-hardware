/*
 * ST7789 系列 SPI 屏幕的命令级模型：接收 SPI 字节 + DC 脚电平，维护 240×320 显存（GRAM），
 * 把可见区域按面板原生扫描方向输出成接口的屏幕帧。图形库（Adafruit GFX 等）原样编译，只需它发出的命令正确。
 *
 * 支持：SWRESET SLPIN SLPOUT INVOFF INVON DISPOFF DISPON CASET RASET RAMWR RAMWRC MADCTL COLMOD(16 位)；
 * 其他命令接收参数后忽略。
 */
#pragma once
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
  int spi_bus;
  int cs_pin;       /* -1 = 总是选中 */
  int dc_pin;       /* DC 低 = 命令，高 = 数据 */
  int gram_width;   /* 显存列数（ST7789：240） */
  int gram_height;  /* 显存行数（ST7789：320） */
  int visible_x, visible_y, visible_width, visible_height; /* 面板实际露出来的显存窗口 */
  int ips_inverted; /* 1 = IPS 屏：固件发 INVON 时颜色才正常（不发则显示反色） */
} vhw_st7789_config_t;

/* 创建并挂到虚拟 SPI 总线上；屏幕帧输出到接口（vdev_screen_*）。 */
void vhw_st7789_attach(const vhw_st7789_config_t* cfg);

#ifdef __cplusplus
}
#endif
