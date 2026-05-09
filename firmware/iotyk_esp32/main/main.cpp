#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_system.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "cJSON.h"
#include "config.h"
#include "certificates.h"
#include "nvs_manager.h"
#include "relay_controller.h"
#include "wifi_manager.h"
#include "ble_provision.h"
#include "local_server.h"
#include "mqtt_manager.h"
#include <stdio.h>
#include <string.h>
#include <string>

static const char* TAG = "APP_ORCH";
static bool is_serial_authenticated = false;

// Forward Declarations
std::string handle_command(const std::string& json_str);
void handle_serial_command(const char* line);

static std::string get_fallback_device_id() {
    uint8_t mac[6];
    esp_efuse_mac_get_default(mac);
    char id[32];
    snprintf(id, sizeof(id), "iotyk-%02X%02X%02X%02X%02X%02X", mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    return std::string(id);
}

std::string handle_command(const std::string& json_str) {
    ESP_LOGI(TAG, "Handling incoming request: %s", json_str.c_str());

    cJSON* root = cJSON_Parse(json_str.c_str());
    if (!root) {
        return "{\"error\":\"Invalid JSON\"}";
    }

    // 1. Extract and authenticate token
    std::string token = "";
    cJSON* json_token = cJSON_GetObjectItem(root, "token");
    if (json_token && json_token->valuestring) {
        token = json_token->valuestring;
    } else {
        // Nested lookup helper
        int tPos = json_str.find("\"token\":\"");
        if (tPos != std::string::npos) {
            size_t start = tPos + 9;
            size_t end = json_str.find("\"", start);
            if (end != std::string::npos) {
                token = json_str.substr(start, end - start);
            }
        }
    }

    char stored_token[64] = {0};
    nvs_manager_get_str(KEY_LOCAL_TOKEN, stored_token, sizeof(stored_token), FACTORY_LOCAL_TOKEN);

    bool auth_valid = false;
    if (!token.empty() && token == stored_token) {
        auth_valid = true;
    }

    if (!auth_valid) {
        ESP_LOGE(TAG, "Rejected unauthorized API call (Token: '%s', Expected: '%s')", token.c_str(), stored_token);
        cJSON_Delete(root);
        return "{\"error\":\"Unauthorized\"}";
    }

    // 2. Parse Actions
    cJSON* json_action = cJSON_GetObjectItem(root, "action");
    cJSON* json_relay = cJSON_GetObjectItem(root, "relay");
    cJSON* json_power = cJSON_GetObjectItem(root, "power");

    // Nest support: {"cmd":{"relay":1,"power":"on"}}
    cJSON* json_cmd = cJSON_GetObjectItem(root, "cmd");
    if (json_cmd) {
        if (!json_relay) json_relay = cJSON_GetObjectItem(json_cmd, "relay");
        if (!json_power) json_power = cJSON_GetObjectItem(json_cmd, "power");

        // Sub-WiFi configuration update payload
        cJSON* json_wifi = cJSON_GetObjectItem(json_cmd, "wifi");
        if (json_wifi) {
            cJSON* json_ssid = cJSON_GetObjectItem(json_wifi, "ssid");
            cJSON* json_pass = cJSON_GetObjectItem(json_wifi, "password");
            if (json_ssid && json_ssid->valuestring) {
                nvs_manager_set_str(KEY_WIFI_SSID, json_ssid->valuestring);
                if (json_pass && json_pass->valuestring) {
                    nvs_manager_set_str(KEY_WIFI_PASS, json_pass->valuestring);
                } else {
                    nvs_manager_set_str(KEY_WIFI_PASS, "");
                }
                ESP_LOGI(TAG, "WiFi configuration updated over API! Rebooting device...");
                vTaskDelay(pdMS_TO_TICKS(1000));
                esp_restart();
            }
        }
    }

    std::string action = (json_action && json_action->valuestring) ? json_action->valuestring : "";
    int relay_id = json_relay ? json_relay->valueint : -1;
    std::string power = (json_power && json_power->valuestring) ? json_power->valuestring : "";

    if (action == "RELAY_ON" || (relay_id == -1 && power == "on")) {
        ESP_LOGI(TAG, "Toggling ALL Relays ON");
        for (int i = 0; i < RELAY_COUNT; i++) {
            relay_controller_set_state(i, true);
        }
    } else if (action == "RELAY_OFF" || (relay_id == -1 && power == "off")) {
        ESP_LOGI(TAG, "Toggling ALL Relays OFF");
        for (int i = 0; i < RELAY_COUNT; i++) {
            relay_controller_set_state(i, false);
        }
    } else if (relay_id >= 1 && relay_id <= RELAY_COUNT) {
        bool s = (power == "on");
        relay_controller_set_state(relay_id - 1, s);
    } else if (action == "UPDATE_MQTT") {
        cJSON* json_u = cJSON_GetObjectItem(root, "user");
        cJSON* json_p = cJSON_GetObjectItem(root, "pass");
        if (json_u && json_u->valuestring && json_p && json_p->valuestring) {
            nvs_manager_set_str(KEY_TEMP_USER, json_u->valuestring);
            nvs_manager_set_str(KEY_TEMP_PASS, json_p->valuestring);
            ESP_LOGI(TAG, "MQTT Credentials changed. Reloading connection...");
            mqtt_manager_stop();
            char stored_id[64] = {0};
            nvs_manager_get_str(KEY_DEVICE_ID, stored_id, sizeof(stored_id), FACTORY_DEVICE_ID);
            mqtt_manager_start(stored_id, json_u->valuestring, json_p->valuestring, handle_command);
        }
    } else if (action == "NEW_SESSION") {
        cJSON* json_nt = cJSON_GetObjectItem(root, "new_token");
        if (json_nt && json_nt->valuestring) {
            nvs_manager_set_str(KEY_LOCAL_TOKEN, json_nt->valuestring);
            ESP_LOGI(TAG, "Local session token refreshed.");
        }
    }

    cJSON_Delete(root);

    // 3. Serialize Output Status JSON
    cJSON* resp = cJSON_CreateObject();
    char d_id[64] = {0};
    nvs_manager_get_str(KEY_DEVICE_ID, d_id, sizeof(d_id), FACTORY_DEVICE_ID);
    if (strlen(d_id) == 0) strcpy(d_id, get_fallback_device_id().c_str());

    cJSON_AddStringToObject(resp, "id", d_id);

    bool overall_on = false;
    cJSON* relays = cJSON_CreateArray();
    for (int i = 0; i < RELAY_COUNT; i++) {
        bool s = relay_controller_get_state(i);
        if (s) overall_on = true;
        cJSON* r = cJSON_CreateObject();
        cJSON_AddNumberToObject(r, "id", i + 1);
        cJSON_AddStringToObject(r, "power", s ? "on" : "off");
        cJSON_AddItemToArray(relays, r);
    }
    cJSON_AddStringToObject(resp, "power", overall_on ? "on" : "off");
    cJSON_AddItemToObject(resp, "relays", relays);
    cJSON_AddBoolToObject(resp, "wifi_configured", true);

    char wifi_ssid[64] = {0};
    nvs_manager_get_str(KEY_WIFI_SSID, wifi_ssid, sizeof(wifi_ssid), "");
    cJSON_AddStringToObject(resp, "wifi_ssid", wifi_ssid);

    char* print = cJSON_PrintUnformatted(resp);
    std::string result(print);
    free(print);
    cJSON_Delete(resp);

    return result;
}

void handle_serial_command(const char* line) {
    std::string cmd(line);
    if (cmd.empty()) return;

    if (cmd.rfind("AUTH:", 0) == 0) {
        std::string token = cmd.substr(5);
        char stored_token[64] = {0};
        nvs_manager_get_str(KEY_LOCAL_TOKEN, stored_token, sizeof(stored_token), FACTORY_LOCAL_TOKEN);

        if (token == stored_token) {
            is_serial_authenticated = true;
            printf("AUTH_OK\n");
            ESP_LOGI(TAG, "Serial terminal unlocked successfully.");
        } else {
            is_serial_authenticated = false;
            printf("AUTH_FAILED\n");
            ESP_LOGW(TAG, "Invalid serial unlock authentication key.");
        }
    } else if (cmd == "STATUS") {
        printf("STATUS_OK\n");
        printf("--- DEVICE STATUS ---\n");
        char d_id[64] = {0};
        nvs_manager_get_str(KEY_DEVICE_ID, d_id, sizeof(d_id), FACTORY_DEVICE_ID);
        if (strlen(d_id) == 0) strcpy(d_id, get_fallback_device_id().c_str());
        printf("Device ID: %s\n", d_id);

        char wifi_ssid[64] = {0};
        nvs_manager_get_str(KEY_WIFI_SSID, wifi_ssid, sizeof(wifi_ssid), "");
        bool has_wifi = strlen(wifi_ssid) > 0;
        printf("Provisioned: %s\n", has_wifi ? "YES" : "NO");
        printf("WiFi Status: %s\n", wifi_manager_is_connected() ? "CONNECTED" : "DISCONNECTED");
        if (wifi_manager_is_connected()) {
            printf("SSID: %s\n", wifi_ssid);
            char ip[32] = {0};
            wifi_manager_get_ip(ip, sizeof(ip));
            printf("IP Address: %s\n", ip);
        } else {
            printf("SSID: %s\n", wifi_ssid);
        }
        printf("MQTT Status: %s\n", mqtt_manager_is_connected() ? "CONNECTED" : "DISCONNECTED");
        if (mqtt_manager_is_connected()) {
            char temp_user[64] = {0};
            nvs_manager_get_str(KEY_TEMP_USER, temp_user, sizeof(temp_user), "");
            printf("MQTT Auth Method: %s\n", (strlen(temp_user) > 0) ? "TEMPORARY" : "PERMANENT");
        }
        char stored_token[64] = {0};
        nvs_manager_get_str(KEY_LOCAL_TOKEN, stored_token, sizeof(stored_token), FACTORY_LOCAL_TOKEN);
        printf("Local Session Token: %s\n", stored_token);
        printf("Local WSS Status: %s\n", local_server_is_active() ? "ACTIVE" : "INACTIVE");
        printf("BLE Status: %s\n", ble_provision_is_active() ? "ADVERTISING" : "IDLE");
        printf("---------------------\n");
    } else if (cmd == "REAUTH") {
        is_serial_authenticated = false;
        printf("REAUTH_OK\n");
        ESP_LOGI(TAG, "Serial session locked.");
    } else if (cmd == "RESET") {
        printf("RESET_OK\n");
        ESP_LOGI(TAG, "Soft reboot triggered...");
        vTaskDelay(pdMS_TO_TICKS(1000));
        esp_restart();
    } else {
        if (!is_serial_authenticated) {
            printf("SERIAL_UNAUTH\n");
            ESP_LOGW(TAG, "Command execution denied. Terminal is locked.");
            return;
        }

        if (cmd.rfind("PROV_PERM:", 0) == 0) {
            std::string json_str = cmd.substr(10);
            cJSON* root = cJSON_Parse(json_str.c_str());
            if (root) {
                cJSON* d = cJSON_GetObjectItem(root, "device_id");
                cJSON* u = cJSON_GetObjectItem(root, "user");
                cJSON* p = cJSON_GetObjectItem(root, "pass");
                cJSON* t = cJSON_GetObjectItem(root, "token");

                if (d && d->valuestring && u && u->valuestring && p && p->valuestring && t && t->valuestring) {
                    nvs_manager_set_str(KEY_DEVICE_ID, d->valuestring);
                    nvs_manager_set_str(KEY_PERM_USER, u->valuestring);
                    nvs_manager_set_str(KEY_PERM_PASS, p->valuestring);
                    nvs_manager_set_str(KEY_LOCAL_TOKEN, t->valuestring);

                    printf("PROV_PERM_OK\n");
                    ESP_LOGI(TAG, "Factory credentials written to flash! Rebooting...");
                    vTaskDelay(pdMS_TO_TICKS(1000));
                    esp_restart();
                } else {
                    printf("PROV_PERM_FAILED: Missing fields\n");
                }
                cJSON_Delete(root);
            } else {
                printf("PROV_PERM_FAILED: Invalid JSON\n");
            }
        } else if (cmd.rfind("PROV:", 0) == 0) {
            std::string json_str = cmd.substr(5);
            cJSON* root = cJSON_Parse(json_str.c_str());
            if (root) {
                cJSON* s = cJSON_GetObjectItem(root, "ssid");
                cJSON* p = cJSON_GetObjectItem(root, "pass");
                cJSON* mu = cJSON_GetObjectItem(root, "mqtt_u");
                cJSON* mp = cJSON_GetObjectItem(root, "mqtt_p");
                cJSON* l = cJSON_GetObjectItem(root, "l_tok");

                if (s && s->valuestring) {
                    nvs_manager_set_str(KEY_WIFI_SSID, s->valuestring);
                    if (p && p->valuestring) nvs_manager_set_str(KEY_WIFI_PASS, p->valuestring);
                    if (mu && mu->valuestring) nvs_manager_set_str(KEY_TEMP_USER, mu->valuestring);
                    if (mp && mp->valuestring) nvs_manager_set_str(KEY_TEMP_PASS, mp->valuestring);
                    if (l && l->valuestring) nvs_manager_set_str(KEY_LOCAL_TOKEN, l->valuestring);

                    printf("PROV_OK\n");
                    ESP_LOGI(TAG, "Serial provisioning values saved. Connecting...");
                    vTaskDelay(pdMS_TO_TICKS(1000));
                    esp_restart();
                } else {
                    printf("PROV_FAILED: SSID missing\n");
                }
                cJSON_Delete(root);
            } else {
                printf("PROV_FAILED: Invalid JSON\n");
            }
        } else if (cmd == "CLEAR_NVS" || cmd == "FACTORY_RESET") {
            nvs_manager_clear_all();
            printf("CLEAR_NVS_OK\n");
            ESP_LOGI(TAG, "Flash database formatted. Rebooting...");
            vTaskDelay(pdMS_TO_TICKS(1000));
            esp_restart();
        } else {
            printf("UNKNOWN_COMMAND\n");
        }
    }
}

// Background Task handling Web Serial input buffering
static void serial_task(void* pvParameters) {
    char line[512];
    ESP_LOGI(TAG, "Serial command receiver task active.");
    while (true) {
        if (fgets(line, sizeof(line), stdin)) {
            size_t len = strlen(line);
            while (len > 0 && (line[len - 1] == '\r' || line[len - 1] == '\n')) {
                line[--len] = '\0';
            }
            if (len > 0) {
                handle_serial_command(line);
            }
        }
        vTaskDelay(pdMS_TO_TICKS(50));
    }
}

extern "C" void app_main(void) {
    // 1. Initialize NVS Flash Partition
    ESP_ERROR_CHECK(nvs_manager_init());

    // 2. Initialize Pin Configurations
    relay_controller_init();

    // 3. Initialize WiFi stacks
    wifi_manager_init();

    // 4. Retrieve credentials
    char stored_ssid[64] = {0};
    char stored_pass[64] = {0};
    nvs_manager_get_str(KEY_WIFI_SSID, stored_ssid, sizeof(stored_ssid), "");
    nvs_manager_get_str(KEY_WIFI_PASS, stored_pass, sizeof(stored_pass), "");

    char device_id[64] = {0};
    nvs_manager_get_str(KEY_DEVICE_ID, device_id, sizeof(device_id), FACTORY_DEVICE_ID);
    if (strlen(device_id) == 0) {
        std::string fb = get_fallback_device_id();
        strcpy(device_id, fb.c_str());
    }

    printf("\n--- IoTYK ESP32 (PURE NATIVE ESP-IDF) ---\n");
    printf("Device ID: %s\n", device_id);

    // 5. Spawn BLE Advertising for discoverability/setup
    ble_provision_start(device_id);

    // 6. Connect STA if WiFi SSID exists in flash
    bool is_provisioned = (strlen(stored_ssid) > 0);
    if (is_provisioned) {
        ESP_LOGI(TAG, "Station provisioned. Linking to WiFi router: '%s'...", stored_ssid);
        wifi_manager_connect_sta(stored_ssid, stored_pass);
    } else {
        ESP_LOGW(TAG, "Board unprovisioned. Initializing BLE & Serial configurations.");
    }

    // 7. Spawn serial thread listener
    xTaskCreate(serial_task, "serial_task", 4096, NULL, 5, NULL);

    // 8. Connection monitoring supervisor loop
    bool cloud_active = false;
    uint32_t conn_timestamp = 0;

    while (true) {
        bool online = wifi_manager_is_connected();

        if (online) {
            if (!cloud_active) {
                ESP_LOGI(TAG, "WiFi Connected successfully.");

                // Fetch temporary or permanent credentials
                char mqtt_u[64] = {0};
                char mqtt_p[64] = {0};
                nvs_manager_get_str(KEY_TEMP_USER, mqtt_u, sizeof(mqtt_u), "");
                nvs_manager_get_str(KEY_TEMP_PASS, mqtt_p, sizeof(mqtt_p), "");

                if (strlen(mqtt_u) == 0) {
                    nvs_manager_get_str(KEY_PERM_USER, mqtt_u, sizeof(mqtt_u), FACTORY_PERM_MQTT_USER);
                    nvs_manager_get_str(KEY_PERM_PASS, mqtt_p, sizeof(mqtt_p), FACTORY_PERM_MQTT_PASS);
                }

                // Start native secure servers
                mqtt_manager_start(device_id, mqtt_u, mqtt_p, handle_command);
                local_server_start(handle_command);

                cloud_active = true;
                conn_timestamp = esp_log_timestamp();
            }

            // Periodically publish status (every 30 seconds)
            static uint32_t last_status = 0;
            if (esp_log_timestamp() - last_status > 30000) {
                char payload[128];
                snprintf(payload, sizeof(payload), "{\"id\":\"%s\",\"status\":\"online\"}", device_id);
                char topic[128];
                snprintf(topic, sizeof(topic), "device/%s/status", device_id);
                mqtt_manager_publish(topic, payload, 1, false);
                last_status = esp_log_timestamp();
            }

            // Halt BLE discoverability after connection remains stable for over 60 seconds
            if (ble_provision_is_active() && (esp_log_timestamp() - conn_timestamp > 60000)) {
                ESP_LOGI(TAG, "WiFi remains connected. Deactivating BLE setup beacon.");
                ble_provision_stop();
            }
        } else {
            if (cloud_active) {
                ESP_LOGW(TAG, "WiFi connection broken! Halting services & re-enabling BLE beacon fallback.");
                mqtt_manager_stop();
                local_server_stop();
                ble_provision_start(device_id);
                cloud_active = false;
            }
        }

        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}
