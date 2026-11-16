#pragma once
#include "nvs.h"
#ifdef __cplusplus
extern "C" {
#endif
esp_err_t nvs_flash_init(void);
esp_err_t nvs_flash_init_partition(const char* part);
esp_err_t nvs_flash_erase(void);
esp_err_t nvs_flash_erase_partition(const char* part);
esp_err_t nvs_flash_deinit(void);
#ifdef __cplusplus
}
#endif
