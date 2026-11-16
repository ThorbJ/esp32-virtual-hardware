/* ST7789 命令级模型。见 include/vhw_panel_st7789.h。 */
#include <pthread.h>
#include <stdlib.h>
#include <string.h>

#include "vdev_io.h"
#include "vhw_panel_st7789.h"
#include "vhw_spi.h"

enum {
  CMD_SWRESET = 0x01, CMD_SLPIN = 0x10, CMD_SLPOUT = 0x11, CMD_INVOFF = 0x20, CMD_INVON = 0x21,
  CMD_DISPOFF = 0x28, CMD_DISPON = 0x29, CMD_CASET = 0x2A, CMD_RASET = 0x2B, CMD_RAMWR = 0x2C,
  CMD_MADCTL = 0x36, CMD_COLMOD = 0x3A, CMD_RAMWRC = 0x3C,
};
enum { MADCTL_MY = 0x80, MADCTL_MX = 0x40, MADCTL_MV = 0x20 };

typedef struct {
  vhw_st7789_config_t cfg;
  vhw_spi_device_t spi;
  uint16_t* gram;   /* 原始显存（不含反色） */
  uint16_t* frame;  /* 输出帧（可见窗口，已按显示状态处理） */
  uint8_t cmd;
  uint8_t params[8];
  int nparams;
  uint16_t xs, xe, ys, ye; /* 逻辑窗口（MADCTL 之前的坐标） */
  uint16_t cx, cy;         /* 写指针 */
  uint8_t madctl;
  int inverted;            /* INVON */
  int display_on, sleeping;
  int have_hi;
  uint8_t hi;
  int dirty;
} st7789_t;

/* 输出帧要改之前：虚拟时间下先等接口取走上一帧（逐帧交接，同哈基米机的 DPI 面板），帧序列才和轮询时机无关；
 * 实时下不等（照旧，轮询赶上哪帧算哪帧）。 */
static void before_change(st7789_t* p) {
#if VHW_VIRTUAL_TIME
  if (!p->dirty) vdev_screen_wait_consumed(1000);
#else
  (void)p;
#endif
}

static uint16_t shown(const st7789_t* p, uint16_t px) {
  if (!p->display_on || p->sleeping) return 0;
  /* IPS 屏：INVON 时显示正常颜色；普通屏：INVOFF 时正常 */
  int invert_out = p->cfg.ips_inverted ? !p->inverted : p->inverted;
  return invert_out ? (uint16_t)~px : px;
}

static void rerender(st7789_t* p) {
  const vhw_st7789_config_t* c = &p->cfg;
  before_change(p);
  for (int y = 0; y < c->visible_height; y++)
    for (int x = 0; x < c->visible_width; x++)
      p->frame[y * c->visible_width + x] = shown(p, p->gram[(y + c->visible_y) * c->gram_width + x + c->visible_x]);
  p->dirty = 1;
}

static void flush(st7789_t* p) {
  if (p->dirty) {
    p->dirty = 0;
    vdev_screen_touch();
  }
}

static void put_pixel(st7789_t* p, uint16_t color) {
  const vhw_st7789_config_t* c = &p->cfg;
  /* 逻辑坐标 → 显存物理坐标：MV 交换行列，MX/MY 镜像 */
  int col, row;
  if (p->madctl & MADCTL_MV) { col = p->cy; row = p->cx; } else { col = p->cx; row = p->cy; }
  if (p->madctl & MADCTL_MX) col = c->gram_width - 1 - col;
  if (p->madctl & MADCTL_MY) row = c->gram_height - 1 - row;
  if (col >= 0 && col < c->gram_width && row >= 0 && row < c->gram_height) {
    p->gram[row * c->gram_width + col] = color;
    int vx = col - c->visible_x, vy = row - c->visible_y;
    if (vx >= 0 && vx < c->visible_width && vy >= 0 && vy < c->visible_height) {
      before_change(p);
      p->frame[vy * c->visible_width + vx] = shown(p, color);
      p->dirty = 1;
    }
  }
  /* 推进写指针：先列后行，到窗口末尾回到起点 */
  if (++p->cx > p->xe) {
    p->cx = p->xs;
    if (++p->cy > p->ye) p->cy = p->ys;
  }
}

static void begin_cmd(st7789_t* p, uint8_t cmd) {
  flush(p);
  p->cmd = cmd;
  p->nparams = 0;
  p->have_hi = 0;
  switch (cmd) {
    case CMD_SWRESET:
      p->madctl = 0; p->inverted = 0; p->display_on = 0; p->sleeping = 1;
      rerender(p);
      break;
    case CMD_SLPIN: p->sleeping = 1; rerender(p); break;
    case CMD_SLPOUT: p->sleeping = 0; rerender(p); break;
    case CMD_INVOFF: p->inverted = 0; rerender(p); break;
    case CMD_INVON: p->inverted = 1; rerender(p); break;
    case CMD_DISPOFF: p->display_on = 0; rerender(p); break;
    case CMD_DISPON: p->display_on = 1; rerender(p); break;
    case CMD_RAMWR: p->cx = p->xs; p->cy = p->ys; break;
    default: break;
  }
  vdev_io()->screen_on = (uint32_t)(p->display_on && !p->sleeping);
}

static void on_data(st7789_t* p, uint8_t b) {
  switch (p->cmd) {
    case CMD_RAMWR:
    case CMD_RAMWRC:
      if (!p->have_hi) { p->hi = b; p->have_hi = 1; }
      else { p->have_hi = 0; put_pixel(p, (uint16_t)((p->hi << 8) | b)); }
      return;
    default: break;
  }
  if (p->nparams < (int)sizeof p->params) p->params[p->nparams++] = b;
  if (p->cmd == CMD_CASET && p->nparams == 4) {
    p->xs = (uint16_t)((p->params[0] << 8) | p->params[1]);
    p->xe = (uint16_t)((p->params[2] << 8) | p->params[3]);
  } else if (p->cmd == CMD_RASET && p->nparams == 4) {
    p->ys = (uint16_t)((p->params[0] << 8) | p->params[1]);
    p->ye = (uint16_t)((p->params[2] << 8) | p->params[3]);
  } else if (p->cmd == CMD_MADCTL && p->nparams == 1) {
    p->madctl = p->params[0];
  }
}

static void on_bytes(void* ctx, const uint8_t* data, size_t len) {
  st7789_t* p = ctx;
  const int dc = vhw_gpio_output_level(p->cfg.dc_pin);
  for (size_t i = 0; i < len; i++) {
    if (dc == 0) begin_cmd(p, data[i]);
    else on_data(p, data[i]);
  }
}

static void on_cs(void* ctx, int level) {
  if (level) flush((st7789_t*)ctx); /* 片选拉高 = 一次传输结束，交一帧 */
}

void vhw_st7789_attach(const vhw_st7789_config_t* cfg) {
  st7789_t* p = calloc(1, sizeof *p);
  p->cfg = *cfg;
  p->gram = calloc((size_t)cfg->gram_width * cfg->gram_height, sizeof(uint16_t));
  p->frame = calloc((size_t)cfg->visible_width * cfg->visible_height, sizeof(uint16_t));
  p->xe = (uint16_t)(cfg->gram_width - 1);
  p->ye = (uint16_t)(cfg->gram_height - 1);
  p->sleeping = 1; /* 上电时面板在睡眠、显示关闭，屏幕全黑 */
  p->spi = (vhw_spi_device_t){cfg->cs_pin, p, on_bytes, on_cs};
  vdev_screen_configure(p->frame, (uint32_t)cfg->visible_width, (uint32_t)cfg->visible_height);
  vhw_spi_attach(cfg->spi_bus, &p->spi);
}
