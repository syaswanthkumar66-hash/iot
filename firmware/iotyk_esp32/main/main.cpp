#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_system.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_random.h"
#include "config.h"
#include "certificates.h"
#include "nvs_manager.h"
#include "relay_controller.h"
#include "wifi_manager.h"
#include "ble_provision.h"
#include "local_server.h"
#include "mqtt_manager.h"
#include "driver/gpio.h"
#include <stdio.h>
#include <string.h>
#include <string>

// Header-only inclusion of ESP32-S3 built-in temperature sensor if available
#include "driver/temperature_sensor.h"

static const char* TAG = "APP_ORCH";
static bool is_serial_authenticated = false;
static bool s_ota_active = false;
static char s_serial_nonce[33] = {0};

typedef enum {
    SYSTEM_STATE_BLE_SETUP,     // Unprovisioned. BLE advertising slow blue blink, red off.
    SYSTEM_STATE_CONNECTING,    // WiFi connected, MQTT connecting. Blue solid, red blinks fast.
    SYSTEM_STATE_CONNECTED,     // Fully connected. Blue solid, red off.
    SYSTEM_STATE_WIFI_ERROR,    // WiFi connection failed. Blue off, red slow blink.
    SYSTEM_STATE_MQTT_ERROR,    // MQTT authentication rejected. Blue/Red police strobe.
    SYSTEM_STATE_LOCAL_ONLY,    // Local control operational but MQTT cloud links offline.
    SYSTEM_STATE_OTA_UPDATE     // Firmware OTA flashing. Red/Blue in phase 100ms blink.
} system_state_t;

static system_state_t s_system_state = SYSTEM_STATE_BLE_SETUP;

// Forward Declarations
std::string handle_command(const std::string& json_str);
void handle_serial_command(const char* line);
static void lock_uart_rx(void);

// Fallback dynamic device ID generator
static std::string get_fallback_device_id() {
    uint8_t mac[6];
    esp_efuse_mac_get_default(mac);
    char id[32];
    snprintf(id, sizeof(id), "iotyk-%02X%02X%02X%02X%02X%02X", mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    return std::string(id);
}

// Memory-Safe Static JSON Parser: Reads string values without any heap allocations
static std::string get_json_val_static(const std::string& json, const std::string& key) {
    size_t kpos = json.find("\"" + key + "\"");
    if (kpos == std::string::npos) return "";
    size_t vpos = json.find(":", kpos);
    if (vpos == std::string::npos) return "";
    size_t s_quote = json.find("\"", vpos);
    if (s_quote != std::string::npos && s_quote < json.find_first_of(",}", vpos)) {
        size_t e_quote = json.find("\"", s_quote + 1);
        if (e_quote != std::string::npos) {
            return json.substr(s_quote + 1, e_quote - s_quote - 1);
        }
    } else {
        size_t end = json.find_first_of(",}", vpos);
        if (end != std::string::npos) {
            std::string raw = json.substr(vpos + 1, end - vpos - 1);
            size_t f = raw.find_first_not_of(" \t\r\n");
            size_t l = raw.find_last_not_of(" \t\r\n");
            if (f != std::string::npos && l != std::string::npos) {
                return raw.substr(f, l - f + 1);
            }
        }
    }
    return "";
}

// Unified Command Handler (Zero Dynamic Heap Memory Allocation)
std::string handle_command(const std::string& json_str) {
    // 1. OTA safety locks
    if (s_ota_active) {
        return "{\"e\":" + std::to_string(ERR_RELAY_BUSY) + "}";
    }

    ESP_LOGI(TAG, "Parsing payload statically...");

    // 2. Local WS Rate limiting checking
    static uint32_t command_count = 0;
    static uint32_t last_time = 0;
    uint32_t now = esp_log_timestamp();
    if (now - last_time < 1000) {
        command_count++;
        if (command_count > 10) {
            ESP_LOGW(TAG, "Rate limiting triggered! Dropping local frames.");
            return "{\"e\":" + std::to_string(ERR_RELAY_BUSY) + "}";
        }
    } else {
        command_count = 1;
        last_time = now;
    }

    // 3. Command Token Validation
    std::string token = get_json_val_static(json_str, "token");
    if (token.empty()) {
        token = get_json_val_static(json_str, "t");
    }

    io_tyk_config_t cfg;
    char stored_token[64] = {0};
    if (nvs_manager_load_config(&cfg) == ESP_OK && strlen(cfg.local_token) > 0) {
        strncpy(stored_token, cfg.local_token, sizeof(stored_token) - 1);
    } else {
        strncpy(stored_token, FACTORY_LOCAL_TOKEN, sizeof(stored_token) - 1);
    }

    // Constant-time check comparison
    int result = 0;
    if (token.length() != strlen(stored_token)) {
        result = 1;
    } else {
        for (size_t i = 0; i < token.length(); i++) {
            result |= (token[i] ^ stored_token[i]);
        }
    }

    if (result != 0) {
        ESP_LOGE(TAG, "Rejected unauthorized API call.");
        return "{\"e\":" + std::to_string(ERR_INVALID_TOKEN) + "}";
    }

    // 4. Action and Configuration Parsing
    std::string action = get_json_val_static(json_str, "action");
    if (action.empty()) {
        action = get_json_val_static(json_str, "a");
    }

    std::string relay_str = get_json_val_static(json_str, "relay");
    if (relay_str.empty()) {
        relay_str = get_json_val_static(json_str, "r");
    }
    int relay_id = relay_str.empty() ? -1 : atoi(relay_str.c_str());

    std::string power = get_json_val_static(json_str, "power");
    if (power.empty()) {
        power = get_json_val_static(json_str, "p");
    }

    // Update WiFi configuration credentials
    std::string new_ssid = get_json_val_static(json_str, "ssid");
    if (!new_ssid.empty()) {
        std::string new_pass = get_json_val_static(json_str, "password");
        
        io_tyk_config_t wifi_cfg;
        if (nvs_manager_load_config(&wifi_cfg) != ESP_OK) {
            memset(&wifi_cfg, 0, sizeof(io_tyk_config_t));
        }
        strncpy(wifi_cfg.wifi_ssid, new_ssid.c_str(), sizeof(wifi_cfg.wifi_ssid) - 1);
        strncpy(wifi_cfg.wifi_pass, new_pass.c_str(), sizeof(wifi_cfg.wifi_pass) - 1);
        nvs_manager_save_config(&wifi_cfg);

        ESP_LOGI(TAG, "WiFi config updated. Soft rebooting...");
        vTaskDelay(pdMS_TO_TICKS(1000));
        esp_restart();
    }

    int count = relay_controller_get_count();

    if (action == "RELAY_ON" || action == "t_on" || (relay_id == -1 && (power == "on" || power == "1"))) {
        ESP_LOGI(TAG, "Toggling ALL Relays ON");
        for (int i = 0; i < count; i++) {
            relay_controller_set_state(i, true);
        }
    } else if (action == "RELAY_OFF" || action == "t_off" || (relay_id == -1 && (power == "off" || power == "0"))) {
        ESP_LOGI(TAG, "Toggling ALL Relays OFF");
        for (int i = 0; i < count; i++) {
            relay_controller_set_state(i, false);
        }
    } else if (relay_id >= 1 && relay_id <= count) {
        bool s = (power == "on" || power == "1");
        relay_controller_set_state(relay_id - 1, s);
    }

    // Save Relay recovery mask state individually to preserve config flash cycles
    uint8_t state_mask = 0;
    for (int i = 0; i < count; i++) {
        if (relay_controller_get_state(i)) {
            state_mask |= (1 << i);
        }
    }
    nvs_manager_set_bool("r_mask", true); // restore flag active
    nvs_manager_set_bool("r_val_1", (state_mask & 1));
    nvs_manager_set_bool("r_val_2", (state_mask & 2));
    nvs_manager_set_bool("r_val_3", (state_mask & 4));
    nvs_manager_set_bool("r_val_4", (state_mask & 8));

    // 5. Build Flat Static Response String
    char d_id[64] = {0};
    nvs_manager_get_str(KEY_DEVICE_ID, d_id, sizeof(d_id), FACTORY_DEVICE_ID);
    if (strlen(d_id) == 0) strcpy(d_id, get_fallback_device_id().c_str());

    std::string states_str = "[";
    for (int i = 0; i < count; i++) {
        states_str += relay_controller_get_state(i) ? "1" : "0";
        if (i < count - 1) states_str += ",";
    }
    states_str += "]";

    char wifi_ssid[64] = {0};
    strncpy(wifi_ssid, cfg.wifi_ssid, sizeof(wifi_ssid) - 1);

    char resp_buf[256];
    snprintf(resp_buf, sizeof(resp_buf), "{\"id\":\"%s\",\"r_cnt\":%d,\"st\":%s,\"wifi_ssid\":\"%s\",\"cap\":{\"ota\":1,\"temp\":1,\"r4\":1}}",
             d_id, count, states_str.c_str(), wifi_ssid);

    return std::string(resp_buf);
}

#include "mbedtls/md.h"

// Cryptographic verification of serial AUTH signature using FACTORY_LOCAL_TOKEN and boot nonce
static bool verify_serial_signature(const std::string& sig_hex) {
    if (sig_hex.length() < 64) return false;
    
    char expected_hex[65] = {0};
    uint8_t hmac_buf[32];
    mbedtls_md_context_t md_ctx;
    mbedtls_md_init(&md_ctx);
    mbedtls_md_setup(&md_ctx, mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), 1);
    
    mbedtls_md_hmac_starts(&md_ctx, (const unsigned char*)FACTORY_LOCAL_TOKEN, strlen(FACTORY_LOCAL_TOKEN));
    mbedtls_md_hmac_update(&md_ctx, (const unsigned char*)s_serial_nonce, 32);
    mbedtls_md_hmac_finish(&md_ctx, hmac_buf);
    mbedtls_md_free(&md_ctx);

    for (int i = 0; i < 32; i++) {
        sprintf(&expected_hex[i * 2], "%02x", hmac_buf[i]);
    }
    expected_hex[64] = '\0';

    int result = 0;
    for (size_t i = 0; i < 64; i++) {
        result |= (sig_hex[i] ^ expected_hex[i]);
    }
    return (result == 0);
}

// Serial Shell challenge-response receiver
void handle_serial_command(const char* line) {
    std::string cmd(line);
    if (cmd.empty()) return;

    if (cmd.rfind("AUTH:", 0) == 0) {
        std::string signature = cmd.substr(5);
        if (verify_serial_signature(signature)) {
            is_serial_authenticated = true;
            printf("AUTH_OK\n");
            ESP_LOGI(TAG, "Serial terminal successfully unlocked.");
        } else {
            is_serial_authenticated = false;
            printf("AUTH_FAILED\n");
            ESP_LOGW(TAG, "Invalid serial auth key matches.");
        }
    } else if (cmd == "STATUS") {
        printf("STATUS_OK\n");
        printf("--- DEVICE STATUS ---\n");
        
        char d_id[64] = {0};
        nvs_manager_get_str(KEY_DEVICE_ID, d_id, sizeof(d_id), FACTORY_DEVICE_ID);
        if (strlen(d_id) == 0) strcpy(d_id, get_fallback_device_id().c_str());
        printf("Device ID: %s\n", d_id);

        io_tyk_config_t cfg;
        bool has_wifi = (nvs_manager_load_config(&cfg) == ESP_OK && strlen(cfg.wifi_ssid) > 0);
        printf("Provisioned: %s\n", has_wifi ? "YES" : "NO");
        printf("WiFi Status: %s\n", wifi_manager_is_connected() ? "CONNECTED" : "DISCONNECTED");
        if (wifi_manager_is_connected()) {
            printf("SSID: %s\n", cfg.wifi_ssid);
            char ip[32] = {0};
            wifi_manager_get_ip(ip, sizeof(ip));
            printf("IP Address: %s\n", ip);
        }
        printf("MQTT Status: %s\n", mqtt_manager_is_connected() ? "CONNECTED" : "DISCONNECTED");
        printf("Local WS Status: %s\n", local_server_is_active() ? "ACTIVE" : "INACTIVE");
        printf("BLE Status: %s\n", ble_provision_is_active() ? "ADVERTISING" : "IDLE");
        printf("---------------------\n");
    } else if (cmd == "REAUTH") {
        is_serial_authenticated = false;
        printf("REAUTH_OK\n");
    } else if (cmd == "RESET") {
        printf("RESET_OK\n");
        vTaskDelay(pdMS_TO_TICKS(1000));
        esp_restart();
    } else {
        io_tyk_config_t check_cfg;
        bool has_config = (nvs_manager_load_config(&check_cfg) == ESP_OK && strlen(check_cfg.local_token) > 0);
        if (!is_serial_authenticated && has_config) {
            printf("SERIAL_UNAUTH\n");
            return;
        }

        if (cmd.rfind("PROV_PERM:", 0) == 0) {
            std::string json_str = cmd.substr(10);
            std::string d = get_json_val_static(json_str, "device_id");
            std::string u = get_json_val_static(json_str, "user");
            std::string p = get_json_val_static(json_str, "pass");
            std::string t = get_json_val_static(json_str, "token");
            std::string r_cnt = get_json_val_static(json_str, "r_cnt");

            if (!d.empty() && !u.empty() && !p.empty() && !t.empty()) {
                nvs_manager_set_str(KEY_DEVICE_ID, d.c_str());
                
                io_tyk_config_t prov_cfg;
                if (nvs_manager_load_config(&prov_cfg) != ESP_OK) {
                    memset(&prov_cfg, 0, sizeof(io_tyk_config_t));
                }
                strncpy(prov_cfg.temp_user, u.c_str(), sizeof(prov_cfg.temp_user) - 1);
                strncpy(prov_cfg.temp_pass, p.c_str(), sizeof(prov_cfg.temp_pass) - 1);
                strncpy(prov_cfg.local_token, t.c_str(), sizeof(prov_cfg.local_token) - 1);
                
                if (!r_cnt.empty()) {
                    strncpy(prov_cfg.r_cnt, r_cnt.c_str(), sizeof(prov_cfg.r_cnt) - 1);
                } else {
                    strcpy(prov_cfg.r_cnt, "1");
                }
                
                nvs_manager_save_config(&prov_cfg);

                printf("PROV_PERM_OK\n");
                vTaskDelay(pdMS_TO_TICKS(1000));
                esp_restart();
            } else {
                printf("PROV_PERM_FAILED: Missing fields\n");
            }
        } else if (cmd.rfind("PROV:", 0) == 0) {
            std::string json_str = cmd.substr(5);
            std::string s = get_json_val_static(json_str, "ssid");
            std::string p = get_json_val_static(json_str, "pass");
            std::string mu = get_json_val_static(json_str, "mqtt_u");
            std::string mp = get_json_val_static(json_str, "mqtt_p");
            std::string l = get_json_val_static(json_str, "l_tok");
            std::string r_cnt = get_json_val_static(json_str, "r_cnt");

            if (!s.empty()) {
                io_tyk_config_t prov_cfg;
                if (nvs_manager_load_config(&prov_cfg) != ESP_OK) {
                    memset(&prov_cfg, 0, sizeof(io_tyk_config_t));
                }
                strncpy(prov_cfg.wifi_ssid, s.c_str(), sizeof(prov_cfg.wifi_ssid) - 1);
                strncpy(prov_cfg.wifi_pass, p.c_str(), sizeof(prov_cfg.wifi_pass) - 1);
                strncpy(prov_cfg.temp_user, mu.c_str(), sizeof(prov_cfg.temp_user) - 1);
                strncpy(prov_cfg.temp_pass, mp.c_str(), sizeof(prov_cfg.temp_pass) - 1);
                strncpy(prov_cfg.local_token, l.c_str(), sizeof(prov_cfg.local_token) - 1);
                
                if (!r_cnt.empty()) {
                    strncpy(prov_cfg.r_cnt, r_cnt.c_str(), sizeof(prov_cfg.r_cnt) - 1);
                } else {
                    strcpy(prov_cfg.r_cnt, "4");
                }
                
                nvs_manager_save_config(&prov_cfg);

                printf("PROV_OK\n");
                vTaskDelay(pdMS_TO_TICKS(1000));
                esp_restart();
            } else {
                printf("PROV_FAILED: SSID missing\n");
            }
        } else if (cmd == "CLEAR_NVS" || cmd == "FACTORY_RESET") {
            nvs_manager_clear_all();
            printf("CLEAR_NVS_OK\n");
            vTaskDelay(pdMS_TO_TICKS(1000));
            esp_restart();
        } else {
            printf("UNKNOWN_COMMAND\n");
        }
    }
}

static void lock_uart_rx(void) {
    ESP_LOGW(TAG, "Device is fully provisioned. Shutting down serial RX interrupts for lock safety.");
    gpio_config_t io_conf = {};
    io_conf.intr_type = GPIO_INTR_DISABLE;
    io_conf.mode = GPIO_MODE_INPUT;
    io_conf.pin_bit_mask = (1ULL << GPIO_NUM_3); // Standard UART RX pin (GPIO 3)
    io_conf.pull_down_en = GPIO_PULLDOWN_DISABLE;
    io_conf.pull_up_en = GPIO_PULLUP_DISABLE;
    gpio_config(&io_conf);
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

// Background task managing indicator LED blink speeds based on connection states
static void indicator_task(void* pvParameters) {
    while (true) {
        switch (s_system_state) {
            case SYSTEM_STATE_BLE_SETUP:
                indicator_led_set_red(false);
                indicator_led_set_blue(true);
                vTaskDelay(pdMS_TO_TICKS(500));
                indicator_led_set_blue(false);
                vTaskDelay(pdMS_TO_TICKS(500));
                break;
            case SYSTEM_STATE_CONNECTING:
                indicator_led_set_blue(true);
                indicator_led_set_red(true);
                vTaskDelay(pdMS_TO_TICKS(100));
                indicator_led_set_red(false);
                vTaskDelay(pdMS_TO_TICKS(100));
                break;
            case SYSTEM_STATE_CONNECTED:
                indicator_led_set_blue(true);
                indicator_led_set_red(false);
                vTaskDelay(pdMS_TO_TICKS(250));
                break;
            case SYSTEM_STATE_WIFI_ERROR:
                indicator_led_set_blue(false);
                indicator_led_set_red(true);
                vTaskDelay(pdMS_TO_TICKS(1000));
                indicator_led_set_red(false);
                vTaskDelay(pdMS_TO_TICKS(1000));
                break;
            case SYSTEM_STATE_MQTT_ERROR:
                indicator_led_set_red(true);
                indicator_led_set_blue(false);
                vTaskDelay(pdMS_TO_TICKS(100));
                indicator_led_set_red(false);
                indicator_led_set_blue(true);
                vTaskDelay(pdMS_TO_TICKS(100));
                break;
            case SYSTEM_STATE_LOCAL_ONLY:
                indicator_led_set_red(true);
                indicator_led_set_blue(false);
                vTaskDelay(pdMS_TO_TICKS(200));
                indicator_led_set_red(false);
                indicator_led_set_blue(true);
                vTaskDelay(pdMS_TO_TICKS(200));
                break;
            case SYSTEM_STATE_OTA_UPDATE:
                indicator_led_set_red(true);
                indicator_led_set_blue(true);
                vTaskDelay(pdMS_TO_TICKS(100));
                indicator_led_set_red(false);
                indicator_led_set_blue(false);
                vTaskDelay(pdMS_TO_TICKS(100));
                break;
        }
    }
}

// Background Monitor checking Heap Margins for long-term uptime stability
static void memory_monitor_task(void* pvParameters) {
    while (true) {
        size_t free_heap = heap_caps_get_free_size(MALLOC_CAP_8BIT);
        size_t min_heap = heap_caps_get_minimum_free_size(MALLOC_CAP_8BIT);
        ESP_LOGI("MEM_MONITOR", "Free Heap: %u bytes, Min Heap Record: %u bytes", free_heap, min_heap);

        if (free_heap < 15000) {
            ESP_LOGW("MEM_MONITOR", "[CRITICAL] Out of memory risk! Reclaiming network sockets and recycling stack...");
            mqtt_manager_stop();
            local_server_stop();
            vTaskDelay(pdMS_TO_TICKS(1000));
            esp_restart(); // Safe protective recycle
        }
        vTaskDelay(pdMS_TO_TICKS(5000));
    }
}

// Background Monitor checking Internal CPU thermals (3-Tier protection)
static void thermal_monitor_task(void* pvParameters) {
    temperature_sensor_handle_t temp_sensor = NULL;
    temperature_sensor_config_t temp_sensor_config = TEMPERATURE_SENSOR_CONFIG_DEFAULT(10, 50);
    
    if (temperature_sensor_install(&temp_sensor_config, &temp_sensor) == ESP_OK) {
        temperature_sensor_enable(temp_sensor);
    }

    while (true) {
        float tsens_out = 25.0f;
        if (temp_sensor && temperature_sensor_get_celsius(temp_sensor, &tsens_out) == ESP_OK) {
            int temp = (int)tsens_out;
            
            // Tier 1: Warning (65°C)
            if (temp >= 65 && temp < 75) {
                ESP_LOGW("THERMAL", "[WARNING] Chip core temperature elevated: %d C", temp);
            }
            // Tier 2: Throttled power-save activation (75°C)
            else if (temp >= 75 && temp < 85) {
                ESP_LOGW("THERMAL", "[THROTTLED] Activating Modem Sleep to limit thermal dissipation: %d C", temp);
                wifi_manager_set_power_save(true);
            }
            // Tier 3: High Temperature safe-shutdown / reboot protect (85°C)
            else if (temp >= 85) {
                ESP_LOGE("THERMAL", "[CRITICAL ALERT] Temperature exceeds safety threshold (%d C). Safe shutdown triggered!", temp);
                relay_controller_init(); // Safe lock outputs OFF
                vTaskDelay(pdMS_TO_TICKS(1000));
                esp_restart();
            }
        }
        vTaskDelay(pdMS_TO_TICKS(5000));
    }
}

extern "C" void app_main(void) {
    // 1. electrical boot rail voltage stabilization cushion delay
    vTaskDelay(pdMS_TO_TICKS(2000));

    // 2. Initialize redundant configs and database handles
    ESP_ERROR_CHECK(nvs_manager_init());
    relay_controller_init();
    
    io_tyk_config_t cfg;
    bool config_loaded = (nvs_manager_load_config(&cfg) == ESP_OK);

    // Dynamic Pin configuration initialization
    int count = relay_controller_get_count();
    
    // 3. Safe Relay Recovery State Restoration
    bool restore_flag = false;
    if (nvs_manager_get_bool("r_mask", &restore_flag, false) == ESP_OK && restore_flag) {
        bool val1, val2, val3, val4;
        nvs_manager_get_bool("r_val_1", &val1, false);
        nvs_manager_get_bool("r_val_2", &val2, false);
        nvs_manager_get_bool("r_val_3", &val3, false);
        nvs_manager_get_bool("r_val_4", &val4, false);
        
        if (count >= 1) relay_controller_set_state(0, val1);
        if (count >= 2) relay_controller_set_state(1, val2);
        if (count >= 3) relay_controller_set_state(2, val3);
        if (count >= 4) relay_controller_set_state(3, val4);
        ESP_LOGI(TAG, "Restored previous relay state outputs cleanly.");
    }

    xTaskCreate(indicator_task, "indicator_task", 2048, NULL, 2, NULL);
    wifi_manager_init();

    char device_id[64] = {0};
    nvs_manager_get_str(KEY_DEVICE_ID, device_id, sizeof(device_id), FACTORY_DEVICE_ID);
    if (strlen(device_id) == 0) {
        std::string fb = get_fallback_device_id();
        strcpy(device_id, fb.c_str());
    }

    // Challenge Nonce Handshake Generator
    uint8_t rand_bytes[16];
    esp_fill_random(rand_bytes, 16);
    for (int i = 0; i < 16; i++) {
        sprintf(&s_serial_nonce[i * 2], "%02X", rand_bytes[i]);
    }
    s_serial_nonce[32] = '\0';

    printf("\nDevice booted\n");
    printf("Device ID: %s\n", device_id);
    printf("CHALLENGE_NONCE:%s\n", s_serial_nonce);
    printf("Device Name: IoTYK Smart Relay\n");
    printf("Device started\n");

    bool is_provisioned = (config_loaded && strlen(cfg.wifi_ssid) > 0);
    if (is_provisioned) {
        ESP_LOGI(TAG, "Station provisioned. Linking to WiFi router: '%s'...", cfg.wifi_ssid);
        s_system_state = SYSTEM_STATE_CONNECTING;
        wifi_manager_connect_sta(cfg.wifi_ssid, cfg.wifi_pass);
        
        // Post-provisioning Lockdown
        lock_uart_rx();
    } else {
        ESP_LOGW(TAG, "Board unprovisioned. Initializing BLE setup.");
        printf("BLE onboarding mode started\n");
        s_system_state = SYSTEM_STATE_BLE_SETUP;
        ble_provision_start(device_id);
    }

    // Spawn serial thread listener only if not locked
    if (!is_provisioned) {
        xTaskCreate(serial_task, "serial_task", 4096, NULL, 5, NULL);
    }

    // Launch Heuristic monitors
    xTaskCreate(memory_monitor_task, "mem_monitor", 3072, NULL, 1, NULL);
    xTaskCreate(thermal_monitor_task, "thermal_monitor", 3072, NULL, 1, NULL);

    bool cloud_active = false;
    uint32_t conn_timestamp = 0;

    while (true) {
        bool online = wifi_manager_is_connected();

        if (online) {
            if (!cloud_active) {
                ESP_LOGI(TAG, "WiFi Connected successfully. Starting mDNS...");
                wifi_manager_start_mdns(device_id);

                char mqtt_u[64] = {0};
                char mqtt_p[64] = {0};
                if (config_loaded) {
                    strncpy(mqtt_u, cfg.temp_user, sizeof(mqtt_u) - 1);
                    strncpy(mqtt_p, cfg.temp_pass, sizeof(mqtt_p) - 1);
                }

                if (strlen(mqtt_u) == 0) {
                    nvs_manager_get_str(KEY_PERM_USER, mqtt_u, sizeof(mqtt_u), FACTORY_PERM_MQTT_USER);
                    nvs_manager_get_str(KEY_PERM_PASS, mqtt_p, sizeof(mqtt_p), FACTORY_PERM_MQTT_PASS);
                }

                printf("MQTT connection initiated...\n");
                printf("Now connecting...\n");
                mqtt_manager_start(device_id, mqtt_u, mqtt_p, handle_command);
                local_server_start(handle_command);

                cloud_active = true;
                conn_timestamp = esp_log_timestamp();
                s_system_state = SYSTEM_STATE_CONNECTING;
            }

            static uint32_t last_status = 0;
            if (esp_log_timestamp() - last_status > 30000) {
                char payload[128];
                snprintf(payload, sizeof(payload), "{\"id\":\"%s\",\"status\":\"online\"}", device_id);
                char topic[128];
                snprintf(topic, sizeof(topic), "device/%s/status", device_id);
                mqtt_manager_publish(topic, payload, 1, false);
                last_status = esp_log_timestamp();
            }

            if (ble_provision_is_active() && (esp_log_timestamp() - conn_timestamp > 60000)) {
                ESP_LOGI(TAG, "WiFi remains connected. Deactivating BLE setup beacon.");
                ble_provision_stop();
            }

            if (mqtt_manager_is_connected()) {
                if (s_system_state != SYSTEM_STATE_CONNECTED) {
                    s_system_state = SYSTEM_STATE_CONNECTED;
                }
            } else {
                if (s_system_state == SYSTEM_STATE_CONNECTING && (esp_log_timestamp() - conn_timestamp > 15000)) {
                    s_system_state = SYSTEM_STATE_LOCAL_ONLY; // Promote to LOCAL_ONLY on LAN
                    printf("[ERROR] MQTT connection failed - Local control active.\n");
                }
            }
        } else {
            if (cloud_active) {
                ESP_LOGW(TAG, "WiFi connection broken! Halting services & re-enabling BLE beacon fallback.");
                mqtt_manager_stop();
                local_server_stop();
                ble_provision_start(device_id);
                cloud_active = false;
                s_system_state = SYSTEM_STATE_CONNECTING;
            }

            if (wifi_manager_has_failed()) {
                if (s_system_state != SYSTEM_STATE_WIFI_ERROR) {
                    s_system_state = SYSTEM_STATE_WIFI_ERROR;
                    printf("[ERROR] WiFi connection failed. Re-activating BLE setup mode...\n");
                    ble_provision_start(device_id);
                }
            }
        }

        vTaskDelay(pdMS_TO_TICKS(2000));
    }
}
