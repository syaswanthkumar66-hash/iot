#include "nvs_manager.h"
#include "nvs_flash.h"
#include "nvs.h"
#include <string.h>
#include <esp_log.h>

static const char* TAG = "NVS_MGR";

esp_err_t nvs_manager_init(void) {
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_LOGW(TAG, "NVS partition format issues. Erasing and retrying...");
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    return ret;
}

esp_err_t nvs_manager_get_str(const char* key, char* out_buf, size_t max_len, const char* default_val) {
    nvs_handle_t my_handle;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READONLY, &my_handle);
    if (err != ESP_OK) {
        if (default_val) {
            strncpy(out_buf, default_val, max_len - 1);
            out_buf[max_len - 1] = '\0';
        } else {
            out_buf[0] = '\0';
        }
        return err;
    }

    size_t required_size = max_len;
    err = nvs_get_str(my_handle, key, out_buf, &required_size);
    nvs_close(my_handle);

    if (err != ESP_OK) {
        if (default_val) {
            strncpy(out_buf, default_val, max_len - 1);
            out_buf[max_len - 1] = '\0';
        } else {
            out_buf[0] = '\0';
        }
    }
    return err;
}

esp_err_t nvs_manager_set_str(const char* key, const char* val) {
    nvs_handle_t my_handle;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READWRITE, &my_handle);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Error opening NVS write handle: %s", esp_err_to_name(err));
        return err;
    }

    err = nvs_set_str(my_handle, key, val);
    if (err == ESP_OK) {
        err = nvs_commit(my_handle);
    }
    nvs_close(my_handle);
    return err;
}

esp_err_t nvs_manager_get_bool(const char* key, bool* out_val, bool default_val) {
    nvs_handle_t my_handle;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READONLY, &my_handle);
    if (err != ESP_OK) {
        *out_val = default_val;
        return err;
    }

    uint8_t u8_val = 0;
    err = nvs_get_u8(my_handle, key, &u8_val);
    nvs_close(my_handle);

    if (err == ESP_OK) {
        *out_val = (u8_val != 0);
    } else {
        *out_val = default_val;
    }
    return err;
}

esp_err_t nvs_manager_set_bool(const char* key, bool val) {
    nvs_handle_t my_handle;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READWRITE, &my_handle);
    if (err != ESP_OK) {
        return err;
    }

    uint8_t u8_val = val ? 1 : 0;
    err = nvs_set_u8(my_handle, key, u8_val);
    if (err == ESP_OK) {
        err = nvs_commit(my_handle);
    }
    nvs_close(my_handle);
    return err;
}

esp_err_t nvs_manager_clear_all(void) {
    nvs_handle_t my_handle;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READWRITE, &my_handle);
    if (err != ESP_OK) {
        return err;
    }

    err = nvs_erase_all(my_handle);
    if (err == ESP_OK) {
        err = nvs_commit(my_handle);
    }
    nvs_close(my_handle);
    return err;
}

#include "esp_rom_crc.h"

esp_err_t nvs_manager_save_config(const io_tyk_config_t* cfg) {
    io_tyk_config_t local_cfg = *cfg;
    local_cfg.version++;
    
    size_t crc_len = sizeof(io_tyk_config_t) - sizeof(uint32_t);
    local_cfg.crc32 = esp_rom_crc32_le(0, (const uint8_t*)&local_cfg, crc_len);
    
    nvs_handle_t my_handle;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READWRITE, &my_handle);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to open NVS namespace for config save!");
        return err;
    }
    
    io_tyk_config_t temp_cfg_a;
    io_tyk_config_t temp_cfg_b;
    size_t size_a = sizeof(io_tyk_config_t);
    size_t size_b = sizeof(io_tyk_config_t);
    
    esp_err_t err_a = nvs_get_blob(my_handle, KEY_CONFIG_A, &temp_cfg_a, &size_a);
    esp_err_t err_b = nvs_get_blob(my_handle, KEY_CONFIG_B, &temp_cfg_b, &size_b);
    
    bool write_a_first = true;
    if (err_a == ESP_OK && err_b == ESP_OK) {
        if (temp_cfg_a.version > temp_cfg_b.version) {
            write_a_first = false;
        }
    } else if (err_a == ESP_OK) {
        write_a_first = false;
    }
    
    const char* first_key = write_a_first ? KEY_CONFIG_A : KEY_CONFIG_B;
    const char* second_key = write_a_first ? KEY_CONFIG_B : KEY_CONFIG_A;
    
    err = nvs_set_blob(my_handle, first_key, &local_cfg, sizeof(io_tyk_config_t));
    if (err == ESP_OK) {
        err = nvs_commit(my_handle);
        if (err == ESP_OK) {
            ESP_LOGI(TAG, "Config successfully written to primary slot: %s (v:%lu)", first_key, (unsigned long)local_cfg.version);
        }
    }
    
    esp_err_t err_sec = nvs_set_blob(my_handle, second_key, &local_cfg, sizeof(io_tyk_config_t));
    if (err_sec == ESP_OK) {
        err_sec = nvs_commit(my_handle);
        if (err_sec == ESP_OK) {
            ESP_LOGI(TAG, "Config successfully duplicated to secondary slot: %s (v:%lu)", second_key, (unsigned long)local_cfg.version);
        }
    }
    
    nvs_close(my_handle);
    return err;
}

esp_err_t nvs_manager_load_config(io_tyk_config_t* out_cfg) {
    nvs_handle_t my_handle;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READONLY, &my_handle);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "No NVS namespace found during config load. Using empty defaults.");
        memset(out_cfg, 0, sizeof(io_tyk_config_t));
        return err;
    }
    
    io_tyk_config_t temp_cfg_a;
    io_tyk_config_t temp_cfg_b;
    size_t size_a = sizeof(io_tyk_config_t);
    size_t size_b = sizeof(io_tyk_config_t);
    
    esp_err_t err_a = nvs_get_blob(my_handle, KEY_CONFIG_A, &temp_cfg_a, &size_a);
    esp_err_t err_b = nvs_get_blob(my_handle, KEY_CONFIG_B, &temp_cfg_b, &size_b);
    nvs_close(my_handle);
    
    bool valid_a = false;
    bool valid_b = false;
    size_t crc_len = sizeof(io_tyk_config_t) - sizeof(uint32_t);
    
    if (err_a == ESP_OK && size_a == sizeof(io_tyk_config_t)) {
        uint32_t calc_crc = esp_rom_crc32_le(0, (const uint8_t*)&temp_cfg_a, crc_len);
        if (calc_crc == temp_cfg_a.crc32) {
            valid_a = true;
        } else {
            ESP_LOGE(TAG, "config_a failed CRC32 checksum verification!");
        }
    }
    
    if (err_b == ESP_OK && size_b == sizeof(io_tyk_config_t)) {
        uint32_t calc_crc = esp_rom_crc32_le(0, (const uint8_t*)&temp_cfg_b, crc_len);
        if (calc_crc == temp_cfg_b.crc32) {
            valid_b = true;
        } else {
            ESP_LOGE(TAG, "config_b failed CRC32 checksum verification!");
        }
    }
    
    if (valid_a && valid_b) {
        if (temp_cfg_a.version >= temp_cfg_b.version) {
            *out_cfg = temp_cfg_a;
            ESP_LOGI(TAG, "Loaded config_a successfully (v:%lu) [Both Valid]", (unsigned long)out_cfg->version);
        } else {
            *out_cfg = temp_cfg_b;
            ESP_LOGI(TAG, "Loaded config_b successfully (v:%lu) [Both Valid]", (unsigned long)out_cfg->version);
        }
        return ESP_OK;
    } else if (valid_a) {
        *out_cfg = temp_cfg_a;
        ESP_LOGW(TAG, "Loaded config_a successfully (v:%lu) [config_b corrupted/missing]", (unsigned long)out_cfg->version);
        return ESP_OK;
    } else if (valid_b) {
        *out_cfg = temp_cfg_b;
        ESP_LOGW(TAG, "Loaded config_b successfully (v:%lu) [config_a corrupted/missing]", (unsigned long)out_cfg->version);
        return ESP_OK;
    }
    
    ESP_LOGW(TAG, "No valid backup configurations found! Initializing defaults.");
    memset(out_cfg, 0, sizeof(io_tyk_config_t));
    return ESP_ERR_NOT_FOUND;
}
