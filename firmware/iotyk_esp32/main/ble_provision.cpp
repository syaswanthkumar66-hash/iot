#include "sdkconfig.h"

#if CONFIG_BT_ENABLED

#include "ble_provision.h"
#include "NimBLEDevice.h"
#include "cJSON.h"
#include "mbedtls/base64.h"
#include "nvs_manager.h"
#include "config.h"
#include <esp_log.h>
#include <esp_system.h>
#include <stdlib.h>
#include <string>

static const char* TAG = "BLE_PROV";
static bool s_ble_active = false;
static NimBLEServer* pServer = NULL;

static std::string s_ssid = "";
static std::string s_pass = "";
static std::string s_temp_user = "";
static std::string s_temp_pass = "";
static std::string s_local_token = "";
static bool s_wifi_received = false;
static bool s_token_received = false;

// Decodes standard Base64 string natively
static std::string decode_base64(const std::string& input) {
    size_t out_len = 0;
    size_t max_len = (input.length() * 3) / 4 + 2;
    unsigned char* out_buf = (unsigned char*)malloc(max_len);
    if (!out_buf) return "";

    int ret = mbedtls_base64_decode(out_buf, max_len, &out_len, (const unsigned char*)input.c_str(), input.length());
    if (ret != 0) {
        free(out_buf);
        ESP_LOGE(TAG, "Base64 decode error: %d", ret);
        return "";
    }

    std::string result((char*)out_buf, out_len);
    free(out_buf);
    return result;
}

// Handler for WIFI provisioning characteristic
class WifiCallbacks : public NimBLECharacteristicCallbacks {
    void onWrite(NimBLECharacteristic* pChar) override {
        std::string val = pChar->getValue();
        if (val.empty()) return;

        std::string decoded = decode_base64(val);
        if (decoded.empty()) {
            ESP_LOGE(TAG, "Failed to decode WiFi payload");
            return;
        }

        size_t comma = decoded.find(',');
        if (comma != std::string::npos) {
            s_ssid = decoded.substr(0, comma);
            s_pass = decoded.substr(comma + 1);
            ESP_LOGI(TAG, "SSID & Password received over BLE: %s", s_ssid.c_str());
            printf("Received WiFi configuration via App\n");
            s_wifi_received = true;
        } else {
            s_ssid = decoded;
            s_pass = "";
            ESP_LOGI(TAG, "SSID received over BLE (no password): %s", s_ssid.c_str());
            printf("Received WiFi configuration via App (No Password)\n");
            s_wifi_received = true;
        }
    }
};

// Handler for pairing tokens & permanent keys
class TokenCallbacks : public NimBLECharacteristicCallbacks {
    void onWrite(NimBLECharacteristic* pChar) override {
        std::string val = pChar->getValue();
        if (val.empty()) return;

        std::string decoded = decode_base64(val);
        if (decoded.empty()) {
            ESP_LOGE(TAG, "Failed to decode Token pairing payload");
            return;
        }

        ESP_LOGI(TAG, "Token pairing payload received. Parsing...");
        cJSON* root = cJSON_Parse(decoded.c_str());
        if (!root) {
            ESP_LOGE(TAG, "JSON parsing error");
            return;
        }

        cJSON* json_key = cJSON_GetObjectItem(root, "key");
        cJSON* json_tok = cJSON_GetObjectItem(root, "token");
        cJSON* json_mqtt = cJSON_GetObjectItem(root, "mqtt");

        if (!json_key || !json_tok || !json_mqtt) {
            ESP_LOGE(TAG, "Missing fields in BLE pairing payload");
            cJSON_Delete(root);
            return;
        }

        // Fetch local token from redundant config
        io_tyk_config_t current_cfg;
        char stored_key[64] = {0};
        
        if (nvs_manager_load_config(&current_cfg) == ESP_OK && strlen(current_cfg.local_token) > 0) {
            strncpy(stored_key, current_cfg.local_token, sizeof(stored_key) - 1);
        } else {
            strncpy(stored_key, FACTORY_LOCAL_TOKEN, sizeof(stored_key) - 1);
        }

        // Verify key
        if (strcmp(json_key->valuestring, stored_key) != 0) {
            ESP_LOGE(TAG, "BLE Pairing authentication failed! Invalid pairing key");
            cJSON_Delete(root);
            return;
        }

        cJSON* json_mqtt_u = cJSON_GetObjectItem(json_mqtt, "u");
        cJSON* json_mqtt_p = cJSON_GetObjectItem(json_mqtt, "p");

        if (!json_mqtt_u || !json_mqtt_p) {
            ESP_LOGE(TAG, "Missing MQTT temporary credentials");
            cJSON_Delete(root);
            return;
        }

        s_temp_user = json_mqtt_u->valuestring;
        s_temp_pass = json_mqtt_p->valuestring;
        s_local_token = json_tok->valuestring;
        s_token_received = true;

        ESP_LOGI(TAG, "BLE Pairing authenticated successfully!");
        printf("Received temporary MQTT credentials via BLE\n");

        cJSON_Delete(root);
    }
};

void ble_provision_start(const char* device_id) {
    if (s_ble_active) return;

    ESP_LOGI(TAG, "Initializing NimBLE Provisioner...");
    NimBLEDevice::init(device_id);

    pServer = NimBLEDevice::createServer();
    NimBLEService* pService = pServer->createService(BLE_SERVICE_UUID);

    NimBLECharacteristic* pWifiChar = pService->createCharacteristic(
        BLE_WIFI_CHAR_UUID,
        NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR
    );
    pWifiChar->setCallbacks(new WifiCallbacks());

    NimBLECharacteristic* pTokenChar = pService->createCharacteristic(
        BLE_TOKEN_CHAR_UUID,
        NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR
    );
    pTokenChar->setCallbacks(new TokenCallbacks());

    pService->start();

    NimBLEAdvertising* pAdvertising = NimBLEDevice::getAdvertising();
    pAdvertising->addServiceUUID(BLE_SERVICE_UUID);
    pAdvertising->setScanResponse(true);
    pAdvertising->setMinPreferred(0x06);
    pAdvertising->start();

    s_ble_active = true;
    s_wifi_received = false;
    s_token_received = false;
    ESP_LOGI(TAG, "BLE advertising started: %s", device_id);

    // Dynamic reboot monitor task
    xTaskCreate([](void* p) {
        while (s_ble_active) {
            if (s_wifi_received && s_token_received) {
                ESP_LOGI(TAG, "Credentials fully verified over BLE! Saving redundant configuration and Rebooting...");
                
                io_tyk_config_t cfg;
                if (nvs_manager_load_config(&cfg) != ESP_OK) {
                    memset(&cfg, 0, sizeof(io_tyk_config_t));
                }
                
                strncpy(cfg.wifi_ssid, s_ssid.c_str(), sizeof(cfg.wifi_ssid) - 1);
                strncpy(cfg.wifi_pass, s_pass.c_str(), sizeof(cfg.wifi_pass) - 1);
                strncpy(cfg.temp_user, s_temp_user.c_str(), sizeof(cfg.temp_user) - 1);
                strncpy(cfg.temp_pass, s_temp_pass.c_str(), sizeof(cfg.temp_pass) - 1);
                strncpy(cfg.local_token, s_local_token.c_str(), sizeof(cfg.local_token) - 1);
                
                if (strlen(cfg.r_cnt) == 0) {
                    strcpy(cfg.r_cnt, "4"); // Default to 4 relays
                }
                
                nvs_manager_save_config(&cfg);
                
                // BLE Kill: Release all bluetooth memory allocation before restart/link
                NimBLEDevice::deinit(true);
                
                vTaskDelay(pdMS_TO_TICKS(1500));
                esp_restart();
            }
            vTaskDelay(pdMS_TO_TICKS(200));
        }
        vTaskDelete(NULL);
    }, "ble_monitor", 3072, NULL, 5, NULL);
}

void ble_provision_stop(void) {
    if (!s_ble_active) return;
    NimBLEDevice::deinit(true);
    s_ble_active = false;
    ESP_LOGI(TAG, "BLE stopped");
}

bool ble_provision_is_active(void) {
    return s_ble_active;
}

#else // CONFIG_BT_ENABLED

#include "ble_provision.h"
#include "esp_log.h"

void ble_provision_start(const char* device_id) {
    ESP_LOGW("BLE_PROV", "Bluetooth hardware is not available on this chip target. Pairing is restricted to Serial/WiFi.");
}

void ble_provision_stop(void) {}
bool ble_provision_is_active(void) { return false; }

#endif // CONFIG_BT_ENABLED
