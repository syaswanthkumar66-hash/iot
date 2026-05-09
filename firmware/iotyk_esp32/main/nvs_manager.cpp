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
