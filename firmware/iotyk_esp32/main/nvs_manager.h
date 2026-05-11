#ifndef MAIN_NVS_MANAGER_H
#define MAIN_NVS_MANAGER_H

#include "esp_err.h"
#include <stddef.h>
#include "config.h"

// Initialize the primary flash partition for key-value storage
esp_err_t nvs_manager_init(void);

// Read a string configuration parameter from NVS with fallback default values
esp_err_t nvs_manager_get_str(const char* key, char* out_buf, size_t max_len, const char* default_val);

// Write a string configuration parameter to NVS
esp_err_t nvs_manager_set_str(const char* key, const char* val);

// Read a boolean parameter
esp_err_t nvs_manager_get_bool(const char* key, bool* out_val, bool default_val);

// Write a boolean parameter
esp_err_t nvs_manager_set_bool(const char* key, bool val);

// Wipe all stored values inside our specific namespace
esp_err_t nvs_manager_clear_all(void);

// Redundant Dual Backup Config Handlers
esp_err_t nvs_manager_save_config(const io_tyk_config_t* cfg);
esp_err_t nvs_manager_load_config(io_tyk_config_t* out_cfg);

#endif // MAIN_NVS_MANAGER_H
