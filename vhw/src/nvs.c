/* NVS：内存里的键值表（命名空间 + 键 → 类型 + 字节）。刷新页面 = 重新上电 = 清空。 */
#include <pthread.h>
#include <stdlib.h>
#include <string.h>

#include "nvs.h"
#include "nvs_flash.h"

#define MAX_HANDLES 64

typedef struct entry {
  struct entry* next;
  char ns[NVS_NS_NAME_MAX_SIZE];
  char key[NVS_KEY_NAME_MAX_SIZE];
  nvs_type_t type;
  size_t len;
  uint8_t* data;
} entry_t;

typedef struct { int used; char ns[NVS_NS_NAME_MAX_SIZE]; nvs_open_mode_t mode; } handle_t;

static pthread_mutex_t s_lock = PTHREAD_MUTEX_INITIALIZER;
static entry_t* s_entries;
static handle_t s_handles[MAX_HANDLES];

esp_err_t nvs_flash_init(void) { return ESP_OK; }
esp_err_t nvs_flash_init_partition(const char* p) { (void)p; return ESP_OK; }
esp_err_t nvs_flash_deinit(void) { return ESP_OK; }
esp_err_t nvs_flash_erase_partition(const char* p) { (void)p; return nvs_flash_erase(); }
esp_err_t nvs_flash_erase(void) {
  pthread_mutex_lock(&s_lock);
  while (s_entries) { entry_t* e = s_entries; s_entries = e->next; free(e->data); free(e); }
  pthread_mutex_unlock(&s_lock);
  return ESP_OK;
}

esp_err_t nvs_open(const char* ns, nvs_open_mode_t mode, nvs_handle_t* out) {
  if (!ns || strlen(ns) >= NVS_NS_NAME_MAX_SIZE) return ESP_ERR_NVS_INVALID_NAME;
  pthread_mutex_lock(&s_lock);
  for (int i = 1; i < MAX_HANDLES; i++) {
    if (!s_handles[i].used) {
      s_handles[i].used = 1;
      strcpy(s_handles[i].ns, ns);
      s_handles[i].mode = mode;
      *out = (nvs_handle_t)i;
      pthread_mutex_unlock(&s_lock);
      return ESP_OK;
    }
  }
  pthread_mutex_unlock(&s_lock);
  return ESP_ERR_NVS_NOT_ENOUGH_SPACE;
}
esp_err_t nvs_open_from_partition(const char* part, const char* ns, nvs_open_mode_t mode, nvs_handle_t* out) {
  (void)part;
  return nvs_open(ns, mode, out);
}
void nvs_close(nvs_handle_t h) {
  if (h > 0 && h < MAX_HANDLES) s_handles[h].used = 0;
}
esp_err_t nvs_commit(nvs_handle_t h) { return h > 0 && h < MAX_HANDLES && s_handles[h].used ? ESP_OK : ESP_ERR_NVS_INVALID_HANDLE; }

static handle_t* get(nvs_handle_t h) { return h > 0 && h < MAX_HANDLES && s_handles[h].used ? &s_handles[h] : NULL; }

static entry_t* find(const char* ns, const char* key) {
  for (entry_t* e = s_entries; e; e = e->next)
    if (strcmp(e->ns, ns) == 0 && strcmp(e->key, key) == 0) return e;
  return NULL;
}

static esp_err_t set(nvs_handle_t h, const char* key, nvs_type_t type, const void* v, size_t len) {
  handle_t* hd = get(h);
  if (!hd) return ESP_ERR_NVS_INVALID_HANDLE;
  if (hd->mode == NVS_READONLY) return ESP_ERR_NVS_READ_ONLY;
  if (!key || strlen(key) >= NVS_KEY_NAME_MAX_SIZE) return ESP_ERR_NVS_KEY_TOO_LONG;
  pthread_mutex_lock(&s_lock);
  entry_t* e = find(hd->ns, key);
  if (!e) {
    e = calloc(1, sizeof *e);
    strcpy(e->ns, hd->ns);
    strcpy(e->key, key);
    e->next = s_entries;
    s_entries = e;
  }
  free(e->data);
  e->data = malloc(len ? len : 1);
  memcpy(e->data, v, len);
  e->len = len;
  e->type = type;
  pthread_mutex_unlock(&s_lock);
  return ESP_OK;
}

static esp_err_t get_fixed(nvs_handle_t h, const char* key, nvs_type_t type, void* out, size_t len) {
  handle_t* hd = get(h);
  if (!hd) return ESP_ERR_NVS_INVALID_HANDLE;
  pthread_mutex_lock(&s_lock);
  entry_t* e = find(hd->ns, key);
  esp_err_t rc = ESP_OK;
  if (!e) rc = ESP_ERR_NVS_NOT_FOUND;
  else if (e->type != type) rc = ESP_ERR_NVS_TYPE_MISMATCH;
  else memcpy(out, e->data, len);
  pthread_mutex_unlock(&s_lock);
  return rc;
}

static esp_err_t get_var(nvs_handle_t h, const char* key, nvs_type_t type, void* out, size_t* len) {
  handle_t* hd = get(h);
  if (!hd) return ESP_ERR_NVS_INVALID_HANDLE;
  pthread_mutex_lock(&s_lock);
  entry_t* e = find(hd->ns, key);
  esp_err_t rc = ESP_OK;
  if (!e) rc = ESP_ERR_NVS_NOT_FOUND;
  else if (e->type != type) rc = ESP_ERR_NVS_TYPE_MISMATCH;
  else if (!out) *len = e->len;
  else if (*len < e->len) rc = ESP_ERR_NVS_INVALID_LENGTH;
  else { memcpy(out, e->data, e->len); *len = e->len; }
  pthread_mutex_unlock(&s_lock);
  return rc;
}

#define FIXED(sfx, T, NT)                                                                          \
  esp_err_t nvs_set_##sfx(nvs_handle_t h, const char* k, T v) { return set(h, k, NT, &v, sizeof v); } \
  esp_err_t nvs_get_##sfx(nvs_handle_t h, const char* k, T* o) { return get_fixed(h, k, NT, o, sizeof *o); }
FIXED(i8, int8_t, NVS_TYPE_I8)
FIXED(u8, uint8_t, NVS_TYPE_U8)
FIXED(i16, int16_t, NVS_TYPE_I16)
FIXED(u16, uint16_t, NVS_TYPE_U16)
FIXED(i32, int32_t, NVS_TYPE_I32)
FIXED(u32, uint32_t, NVS_TYPE_U32)
FIXED(i64, int64_t, NVS_TYPE_I64)
FIXED(u64, uint64_t, NVS_TYPE_U64)

esp_err_t nvs_set_str(nvs_handle_t h, const char* k, const char* v) { return set(h, k, NVS_TYPE_STR, v, strlen(v) + 1); }
esp_err_t nvs_set_blob(nvs_handle_t h, const char* k, const void* v, size_t len) { return set(h, k, NVS_TYPE_BLOB, v, len); }
esp_err_t nvs_get_str(nvs_handle_t h, const char* k, char* out, size_t* len) { return get_var(h, k, NVS_TYPE_STR, out, len); }
esp_err_t nvs_get_blob(nvs_handle_t h, const char* k, void* out, size_t* len) { return get_var(h, k, NVS_TYPE_BLOB, out, len); }

esp_err_t nvs_find_key(nvs_handle_t h, const char* key, nvs_type_t* out_type) {
  handle_t* hd = get(h);
  if (!hd) return ESP_ERR_NVS_INVALID_HANDLE;
  pthread_mutex_lock(&s_lock);
  entry_t* e = find(hd->ns, key);
  if (e && out_type) *out_type = e->type;
  pthread_mutex_unlock(&s_lock);
  return e ? ESP_OK : ESP_ERR_NVS_NOT_FOUND;
}

esp_err_t nvs_erase_key(nvs_handle_t h, const char* key) {
  handle_t* hd = get(h);
  if (!hd) return ESP_ERR_NVS_INVALID_HANDLE;
  pthread_mutex_lock(&s_lock);
  esp_err_t rc = ESP_ERR_NVS_NOT_FOUND;
  for (entry_t** pp = &s_entries; *pp; pp = &(*pp)->next) {
    entry_t* e = *pp;
    if (strcmp(e->ns, hd->ns) == 0 && strcmp(e->key, key) == 0) {
      *pp = e->next;
      free(e->data);
      free(e);
      rc = ESP_OK;
      break;
    }
  }
  pthread_mutex_unlock(&s_lock);
  return rc;
}

esp_err_t nvs_erase_all(nvs_handle_t h) {
  handle_t* hd = get(h);
  if (!hd) return ESP_ERR_NVS_INVALID_HANDLE;
  pthread_mutex_lock(&s_lock);
  for (entry_t** pp = &s_entries; *pp;) {
    entry_t* e = *pp;
    if (strcmp(e->ns, hd->ns) == 0) { *pp = e->next; free(e->data); free(e); } else pp = &e->next;
  }
  pthread_mutex_unlock(&s_lock);
  return ESP_OK;
}

esp_err_t nvs_get_stats(const char* part, nvs_stats_t* st) {
  (void)part;
  size_t n = 0;
  pthread_mutex_lock(&s_lock);
  for (entry_t* e = s_entries; e; e = e->next) n++;
  pthread_mutex_unlock(&s_lock);
  st->used_entries = n;
  st->total_entries = 630;
  st->free_entries = st->available_entries = 630 - n;
  st->namespace_count = 0;
  return ESP_OK;
}
esp_err_t nvs_get_used_entry_count(nvs_handle_t h, size_t* used) { (void)h; *used = 0; return ESP_OK; }
esp_err_t nvs_entry_find(const char* part, const char* ns, nvs_type_t type, nvs_iterator_t* out) {
  (void)part; (void)ns; (void)type;
  *out = NULL;
  return ESP_ERR_NVS_NOT_FOUND;
}
esp_err_t nvs_entry_next(nvs_iterator_t* it) { *it = NULL; return ESP_ERR_NVS_NOT_FOUND; }
esp_err_t nvs_entry_info(nvs_iterator_t it, nvs_entry_info_t* out) { (void)it; (void)out; return ESP_ERR_INVALID_ARG; }
void nvs_release_iterator(nvs_iterator_t it) { (void)it; }
