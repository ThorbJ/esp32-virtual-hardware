/* eFuse MAC：固定的虚拟 MAC（编译时 VDEV_VIRTUAL_MAC），设备编号因此固定。 */
#pragma once
#include <stdint.h>
#include "esp_err.h"
#ifdef __cplusplus
extern "C" {
#endif
typedef enum { ESP_MAC_WIFI_STA, ESP_MAC_WIFI_SOFTAP, ESP_MAC_BT, ESP_MAC_ETH, ESP_MAC_IEEE802154, ESP_MAC_BASE, ESP_MAC_EFUSE_FACTORY, ESP_MAC_EFUSE_CUSTOM, ESP_MAC_EFUSE_EXT } esp_mac_type_t;
#define MAC2STR(a) (a)[0], (a)[1], (a)[2], (a)[3], (a)[4], (a)[5]
#define MACSTR "%02x:%02x:%02x:%02x:%02x:%02x"
esp_err_t esp_efuse_mac_get_default(uint8_t* mac);
esp_err_t esp_read_mac(uint8_t* mac, esp_mac_type_t type);
esp_err_t esp_base_mac_addr_get(uint8_t* mac);
esp_err_t esp_base_mac_addr_set(const uint8_t* mac);
esp_err_t esp_efuse_mac_get_custom(uint8_t* mac);
esp_err_t esp_derive_local_mac(uint8_t* local_mac, const uint8_t* universal_mac);
#ifdef __cplusplus
}
#endif
