/* NVS：放在内存里的键值存储（刷新页面 = 重新上电，内容清空；以后可选持久到浏览器存储）。 */
#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "esp_err.h"
#ifdef __cplusplus
extern "C" {
#endif
typedef uint32_t nvs_handle_t;
typedef nvs_handle_t nvs_handle;
typedef enum { NVS_READONLY, NVS_READWRITE } nvs_open_mode_t;
typedef nvs_open_mode_t nvs_open_mode;
typedef enum {
  NVS_TYPE_U8 = 0x01, NVS_TYPE_I8 = 0x11, NVS_TYPE_U16 = 0x02, NVS_TYPE_I16 = 0x12, NVS_TYPE_U32 = 0x04, NVS_TYPE_I32 = 0x14,
  NVS_TYPE_U64 = 0x08, NVS_TYPE_I64 = 0x18, NVS_TYPE_STR = 0x21, NVS_TYPE_BLOB = 0x42, NVS_TYPE_ANY = 0xff,
} nvs_type_t;
typedef struct { size_t used_entries, free_entries, available_entries, total_entries, namespace_count; } nvs_stats_t;
typedef struct nvs_opaque_iterator_t* nvs_iterator_t;
typedef struct { char namespace_name[16]; char key[16]; nvs_type_t type; } nvs_entry_info_t;

#define ESP_ERR_NVS_BASE 0x1100
#define ESP_ERR_NVS_NOT_INITIALIZED (ESP_ERR_NVS_BASE + 0x01)
#define ESP_ERR_NVS_NOT_FOUND (ESP_ERR_NVS_BASE + 0x02)
#define ESP_ERR_NVS_TYPE_MISMATCH (ESP_ERR_NVS_BASE + 0x03)
#define ESP_ERR_NVS_READ_ONLY (ESP_ERR_NVS_BASE + 0x04)
#define ESP_ERR_NVS_NOT_ENOUGH_SPACE (ESP_ERR_NVS_BASE + 0x05)
#define ESP_ERR_NVS_INVALID_NAME (ESP_ERR_NVS_BASE + 0x06)
#define ESP_ERR_NVS_INVALID_HANDLE (ESP_ERR_NVS_BASE + 0x07)
#define ESP_ERR_NVS_REMOVE_FAILED (ESP_ERR_NVS_BASE + 0x08)
#define ESP_ERR_NVS_KEY_TOO_LONG (ESP_ERR_NVS_BASE + 0x09)
#define ESP_ERR_NVS_PAGE_FULL (ESP_ERR_NVS_BASE + 0x0a)
#define ESP_ERR_NVS_INVALID_STATE (ESP_ERR_NVS_BASE + 0x0b)
#define ESP_ERR_NVS_INVALID_LENGTH (ESP_ERR_NVS_BASE + 0x0c)
#define ESP_ERR_NVS_NO_FREE_PAGES (ESP_ERR_NVS_BASE + 0x0d)
#define ESP_ERR_NVS_VALUE_TOO_LONG (ESP_ERR_NVS_BASE + 0x0e)
#define ESP_ERR_NVS_NEW_VERSION_FOUND (ESP_ERR_NVS_BASE + 0x10)
#define NVS_DEFAULT_PART_NAME "nvs"
#define NVS_KEY_NAME_MAX_SIZE 16
#define NVS_NS_NAME_MAX_SIZE 16

esp_err_t nvs_open(const char* ns, nvs_open_mode_t mode, nvs_handle_t* out);
esp_err_t nvs_open_from_partition(const char* part, const char* ns, nvs_open_mode_t mode, nvs_handle_t* out);
void nvs_close(nvs_handle_t h);
esp_err_t nvs_commit(nvs_handle_t h);
esp_err_t nvs_erase_key(nvs_handle_t h, const char* key);
esp_err_t nvs_erase_all(nvs_handle_t h);
esp_err_t nvs_set_i8(nvs_handle_t h, const char* key, int8_t v);
esp_err_t nvs_set_u8(nvs_handle_t h, const char* key, uint8_t v);
esp_err_t nvs_set_i16(nvs_handle_t h, const char* key, int16_t v);
esp_err_t nvs_set_u16(nvs_handle_t h, const char* key, uint16_t v);
esp_err_t nvs_set_i32(nvs_handle_t h, const char* key, int32_t v);
esp_err_t nvs_set_u32(nvs_handle_t h, const char* key, uint32_t v);
esp_err_t nvs_set_i64(nvs_handle_t h, const char* key, int64_t v);
esp_err_t nvs_set_u64(nvs_handle_t h, const char* key, uint64_t v);
esp_err_t nvs_set_str(nvs_handle_t h, const char* key, const char* v);
esp_err_t nvs_set_blob(nvs_handle_t h, const char* key, const void* v, size_t len);
esp_err_t nvs_get_i8(nvs_handle_t h, const char* key, int8_t* out);
esp_err_t nvs_get_u8(nvs_handle_t h, const char* key, uint8_t* out);
esp_err_t nvs_get_i16(nvs_handle_t h, const char* key, int16_t* out);
esp_err_t nvs_get_u16(nvs_handle_t h, const char* key, uint16_t* out);
esp_err_t nvs_get_i32(nvs_handle_t h, const char* key, int32_t* out);
esp_err_t nvs_get_u32(nvs_handle_t h, const char* key, uint32_t* out);
esp_err_t nvs_get_i64(nvs_handle_t h, const char* key, int64_t* out);
esp_err_t nvs_get_u64(nvs_handle_t h, const char* key, uint64_t* out);
esp_err_t nvs_get_str(nvs_handle_t h, const char* key, char* out, size_t* len);
esp_err_t nvs_get_blob(nvs_handle_t h, const char* key, void* out, size_t* len);
esp_err_t nvs_find_key(nvs_handle_t h, const char* key, nvs_type_t* out_type);
esp_err_t nvs_get_stats(const char* part, nvs_stats_t* stats);
esp_err_t nvs_get_used_entry_count(nvs_handle_t h, size_t* used);
esp_err_t nvs_entry_find(const char* part, const char* ns, nvs_type_t type, nvs_iterator_t* out);
esp_err_t nvs_entry_next(nvs_iterator_t* it);
esp_err_t nvs_entry_info(nvs_iterator_t it, nvs_entry_info_t* out);
void nvs_release_iterator(nvs_iterator_t it);
#ifdef __cplusplus
}
#endif
