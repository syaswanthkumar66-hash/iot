#include "ble_provision.h"
#include "NimBLEDevice.h"
#include "cJSON.h"
#include "mbedtls/base64.h"
#include "nvs_manager.h"
#include "config.h"
#include <esp_log.h>
#include <esp_system.h>
#include <string>

static const char* TAG = "BLE_PROV";
static bool s_ble_active = false;
static NimBLEServer* pServer = NULL;

static std::string s_ssid = "";
static std::string s_pass = "";
static bool s_wifi_received = false;
static bool s_token_received = false;

// Decodes standard Base64 string natively
static std::string decode_base64(const std::string& input) {
    size_t out_len = 0;
    // Estimate output length
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

        // Parse "ssid,password"
        size_t comma = decoded.find(',');
        if (comma != std::string::npos) {
            s_ssid = decoded.substr(0, comma);
            s_pass = decoded.substr(comma + 1);
            ESP_LOGI(TAG, "SSID & Password received over BLE: %s", s_ssid.c_str());
            s_wifi_received = true;
        } else {
            // No password
            s_ssid = decoded;
            s_pass = "";
            ESP_LOGI(TAG, "SSID received over BLE (no password): %s", s_ssid.c_str());
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

        // Fetch permanent key from NVS
        char stored_key[64] = {0};
        nvs_manager_get_str(KEY_LOCAL_TOKEN, stored_key, sizeof(stored_key), FACTORY_LOCAL_TOKEN);

        // Verify key
        if (strcmp(json_key->valuestring, stored_key) != 0) {
            ESP_LOGE(TAG, "BLE Pairing authentication failed! Invalid pairing key: %s (Expected: %s)", json_key->valuestring, stored_key);
            cJSON_Delete(root);
            return;
        }

        cJSON* json_mqtt_u = cJSON_GetObjectItem(json_mqtt, "u");
        cJSON* json_mqtt_p = cJSON_GetObjectItem(json_mqtt, "p");

        if (!json_mqtt_u || !json_mqtt_p) {
            ESP_LOGE(TAG, "Missing MQTT temporary credentials inside BLE JSON");
            cJSON_Delete(root);
            return;
        }

        // Save pairing values to NVS
        nvs_manager_set_str(KEY_TEMP_USER, json_mqtt_u->valuestring);
        nvs_manager_set_str(KEY_TEMP_PASS, json_mqtt_p->valuestring);
        
        // Save pairing session token
        nvs_manager_set_str(KEY_LOCAL_TOKEN, json_tok->valuestring); // session promotes to auth token

        ESP_LOGI(TAG, "BLE Pairing authenticated successfully! Storing credentials...");
        s_token_received = true;

        cJSON_Delete(root);
    }
};

void ble_provision_start(const char* device_id) {
    if (s_ble_active) return;

    ESP_LOGI(TAG, "Initializing NimBLE Provisioner...");
    NimBLEDevice::init(device_id);

    pServer = NimBLEDevice::createServer();
    NimBLEService* pService = pServer->createService(BLE_SERVICE_UUID);

    // Create WiFi characteristic (SSID,PASS)
    NimBLECharacteristic* pWifiChar = pService->createCharacteristic(
        BLE_WIFI_CHAR_UUID,
        NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR
    );
    pWifiChar->setCallbacks(new WifiCallbacks());

    // Create Token characteristic
    NimBLECharacteristic* pTokenChar = pService->createCharacteristic(
        BLE_TOKEN_CHAR_UUID,
        NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR
    );
    pTokenChar->setCallbacks(new TokenCallbacks());

    pService->start();

    // Start advertising
    NimBLEAdvertising* pAdvertising = NimBLEDevice::getAdvertising();
    pAdvertising->addServiceUUID(BLE_SERVICE_UUID);
    pAdvertising->setScanResponse(true);
    pAdvertising->setMinPreferred(0x06);  // helper for iOS connections
    pAdvertising->start();

    s_ble_active = true;
    s_wifi_received = false;
    s_token_received = false;
    ESP_LOGI(TAG, "BLE advertising started: %s", device_id);

    // Dynamic reboot monitor task
    xTaskCreate([](void* p) {
        while (s_ble_active) {
            if (s_wifi_received && s_token_received) {
                ESP_LOGI(TAG, "Credentials fully verified over BLE! Saving WiFi SSID and Rebooting...");
                nvs_manager_set_str(KEY_WIFI_SSID, s_ssid.c_str());
                nvs_manager_set_str(KEY_WIFI_PASS, s_pass.c_str());
                
                vTaskDelay(pdMS_TO_TICKS(1500));
                esp_restart();
            }
            vTaskDelay(pdMS_TO_TICKS(200));
        }
        vTaskDelete(NULL);
    }, "ble_monitor", 2048, NULL, 5, NULL);
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
