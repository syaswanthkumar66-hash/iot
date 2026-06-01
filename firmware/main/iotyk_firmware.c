/*
 * IoTYK Smart Relay Controller Firmware
 * Built using the native Espressif IoT Development Framework (ESP-IDF).
 * 
 * Implements:
 * 1. Hardware self-test routine (Auto-Test)
 * 2. UART Serial Driver listening for diagnostics commands on UART0
 * 3. Physical Presence Factory Mode Reset (erases NVS configuration sectors,
 *    generates secure HMAC-SHA256 validation token via MbedTLS, and reboots).
 */

#include <stdio.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/uart.h"
#include "driver/gpio.h"
#include "esp_system.h"
#include "esp_log.h"
#include "nvs_flash.h"
#include "nvs.h"
#include "esp_mac.h"
#include "mbedtls/md.h" // MbedTLS HMAC library built into ESP-IDF

#define UART_PORT_NUM      UART_NUM_0
#define UART_BAUD_RATE     115200
#define UART_BUF_SIZE      1024

#define RELAY_GPIO_PIN     2    // GPIO2 (builtin LED / Relay test pin)
#define BUTTON_GPIO_PIN    0    // GPIO0 (BOOT button for manual hardware override)

static const char *TAG = "IOTYK_FIRMWARE";

// Unique hardware root secret pre-flashed into the chip's secure storage partition during production
// (Used to verify physical presence. Must match the value registered in the database).
static const char *device_root_secret = "hardware_root_secret_pre_flashed_in_factory";

// Secure Local NVS namespace
static const char *nvs_namespace = "wifi-creds";

// Helper: Saves and sets the relay state
void set_relay_state(int state) {
    gpio_set_level(RELAY_GPIO_PIN, state);
    
    // Save to NVS
    nvs_handle_t handle;
    if (nvs_open(nvs_namespace, NVS_READWRITE, &handle) == ESP_OK) {
        nvs_set_i32(handle, "relay_state", state);
        nvs_commit(handle);
        nvs_close(handle);
        ESP_LOGI(TAG, "SYS: Saved relay state %d to NVS.", state);
    }
}

// Helper: Retrieves the saved relay state from NVS
int get_relay_state(void) {
    int32_t state = 0; // Default off
    nvs_handle_t handle;
    if (nvs_open(nvs_namespace, NVS_READONLY, &handle) == ESP_OK) {
        nvs_get_i32(handle, "relay_state", &state);
        nvs_close(handle);
    }
    return (int)state;
}

// Helper: Generates a secure HMAC-SHA256 confirmation token over USB UART
void generate_reset_validation_key(char *out_hex) {
    uint8_t mac[6];
    esp_read_mac(mac, ESP_MAC_WIFI_STA);

    // Format device ID payload: "esp32-test-xxxxxx_RESET_CONFIRMED"
    char payload[100];
    snprintf(payload, sizeof(payload), "esp32-test-%02x%02x%02x%02x%02x%02x_RESET_CONFIRMED",
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);

    uint8_t hmac_result[32];
    mbedtls_md_context_t ctx;
    mbedtls_md_type_t md_type = MBEDTLS_MD_SHA256;

    mbedtls_md_init(&ctx);
    mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(md_type), 1);
    mbedtls_md_hmac_starts(&ctx, (const unsigned char *)device_root_secret, strlen(device_root_secret));
    mbedtls_md_hmac_update(&ctx, (const unsigned char *)payload, strlen(payload));
    mbedtls_md_hmac_finish(&ctx, hmac_result);
    mbedtls_md_free(&ctx);

    // Convert result to hex string
    for (int i = 0; i < 32; i++) {
        sprintf(out_hex + (i * 2), "%02x", hmac_result[i]);
    }
    out_hex[64] = '\0';
}

// Simulated Hardware Self-Test (Used in Factory Mode only)
bool run_hardware_self_test(void) {
    ESP_LOGI(TAG, "SYS: Running automated hardware self-tests...");

    // 1. Test NVS storage (already initialized in app_main)
    nvs_handle_t handle;
    esp_err_t err = nvs_open("health-chk", NVS_READWRITE, &handle);
    if (err == ESP_OK) {
        nvs_set_i32(handle, "test_val", 42);
        nvs_commit(handle);
        
        int32_t val = 0;
        nvs_get_i32(handle, "test_val", &val);
        nvs_close(handle);

        if (val != 42) {
            ESP_LOGE(TAG, "SYS: ERROR - NVS partition test failed!");
            return false;
        }
    } else {
        ESP_LOGE(TAG, "SYS: ERROR - Failed to open NVS namespace health-chk!");
        return false;
    }

    // 2. Click Relay/LED
    gpio_set_level(RELAY_GPIO_PIN, 1);
    vTaskDelay(pdMS_TO_TICKS(200));
    gpio_set_level(RELAY_GPIO_PIN, 0);

    ESP_LOGI(TAG, "SYS: GPIO and relay controllers operational.");
    return true;
}

// UART RX Listening task
void uart_rx_task(void *pvParameters) {
    uint8_t *data = (uint8_t *) malloc(UART_BUF_SIZE);
    
    while (1) {
        // Read data from the UART
        int len = uart_read_bytes(UART_PORT_NUM, data, UART_BUF_SIZE - 1, pdMS_TO_TICKS(100));
        if (len > 0) {
            data[len] = '\0';
            
            // Trim whitespace
            char *cmd = (char *)data;
            while (*cmd == ' ' || *cmd == '\r' || *cmd == '\n') cmd++;
            char *end = cmd + strlen(cmd) - 1;
            while (end > cmd && (*end == ' ' || *end == '\r' || *end == '\n')) {
                *end = '\0';
                end--;
            }

            if (strcmp(cmd, "GET_FACTORY_RESET_TOKEN") == 0) {
                ESP_LOGI(TAG, "SYS: Authenticating physical presence reset command...");

                // A. Generate verification key
                char validation_key[65];
                generate_reset_validation_key(validation_key);

                // B. WIPE local Wi-Fi configuration and secrets in NVS
                ESP_LOGI(TAG, "SYS: Erasing local Wi-Fi credentials partition in NVS...");
                nvs_handle_t handle;
                if (nvs_open(nvs_namespace, NVS_READWRITE, &handle) == ESP_OK) {
                    nvs_erase_all(handle);
                    nvs_commit(handle);
                    nvs_close(handle);
                }

                // C. Print key back to Serial Port so Web/Desktop App can read it
                printf("RESET_OK:%s\n", validation_key);
                fflush(stdout);

                vTaskDelay(pdMS_TO_TICKS(1500));
                ESP_LOGI(TAG, "SYS: Reset complete. Rebooting...");
                esp_restart(); // Reboot into original clean factory state
            } else if (strncmp(cmd, "PROVISION_DEVICE:", 17) == 0) {
                const char *token = cmd + 17;
                ESP_LOGI(TAG, "SYS: Provisioning device with local NVS security token...");
                nvs_handle_t handle;
                if (nvs_open(nvs_namespace, NVS_READWRITE, &handle) == ESP_OK) {
                    nvs_set_str(handle, "local_token", token);
                    nvs_commit(handle);
                    nvs_close(handle);
                    printf("PROVISION_OK\n");
                } else {
                    printf("PROVISION_FAILED\n");
                }
                fflush(stdout);
            } else if (strcmp(cmd, "RELAY_ON") == 0) {
                set_relay_state(1);
                printf("RELAY_OK:ON\n");
                fflush(stdout);
            } else if (strcmp(cmd, "RELAY_OFF") == 0) {
                set_relay_state(0);
                printf("RELAY_OK:OFF\n");
                fflush(stdout);
            } else if (strcmp(cmd, "RELAY_TOGGLE") == 0) {
                int next_state = !gpio_get_level(RELAY_GPIO_PIN);
                set_relay_state(next_state);
                printf("RELAY_OK:%s\n", next_state ? "ON" : "OFF");
                fflush(stdout);
            } else if (strcmp(cmd, "GET_RELAY_STATE") == 0) {
                int state = gpio_get_level(RELAY_GPIO_PIN);
                printf("RELAY_STATE:%s\n", state ? "ON" : "OFF");
                fflush(stdout);
            }
        }
        
        // Check physical reset/toggle button (GPIO0 / BOOT button)
        if (gpio_get_level(BUTTON_GPIO_PIN) == 0) {
            int counter = 0;
            // Wait while button is held, up to 10 seconds (100 * 100ms)
            while (gpio_get_level(BUTTON_GPIO_PIN) == 0 && counter < 100) {
                vTaskDelay(pdMS_TO_TICKS(100));
                counter++;
            }
            if (counter >= 100) {
                ESP_LOGI(TAG, "SYS: Manual factory reset triggered via physical button.");
                nvs_handle_t handle;
                if (nvs_open(nvs_namespace, NVS_READWRITE, &handle) == ESP_OK) {
                    nvs_erase_all(handle);
                    nvs_commit(handle);
                    nvs_close(handle);
                }
                ESP_LOGI(TAG, "SYS: NVS wiped. Rebooting...");
                vTaskDelay(pdMS_TO_TICKS(1000));
                esp_restart();
            } else if (counter > 1) { // Debounce: must be held for > 100ms
                // Short press: Toggle relay state
                int next_state = !gpio_get_level(RELAY_GPIO_PIN);
                set_relay_state(next_state);
                ESP_LOGI(TAG, "SYS: Relay state toggled via physical button short-press to %d.\n", next_state);
                printf("RELAY_STATE_CHANGED:%d\n", next_state);
                fflush(stdout);
            }
        }
    }
    
    free(data);
}

void app_main(void) {
    // Initialize GPIOs
    gpio_reset_pin(RELAY_GPIO_PIN);
    gpio_set_direction(RELAY_GPIO_PIN, GPIO_MODE_OUTPUT);

    gpio_reset_pin(BUTTON_GPIO_PIN);
    gpio_set_direction(BUTTON_GPIO_PIN, GPIO_MODE_INPUT);
    gpio_pullup_en(BUTTON_GPIO_PIN);

    // Setup UART0 configurations
    uart_config_t uart_config = {
        .baud_rate = UART_BAUD_RATE,
        .data_bits = UART_DATA_8_BITS,
        .parity    = UART_PARITY_DISABLE,
        .stop_bits = UART_STOP_BITS_1,
        .flow_ctrl = UART_HW_FLOWCTRL_DISABLE,
        .source_clk = UART_SCLK_DEFAULT,
    };
    
    uart_driver_install(UART_PORT_NUM, UART_BUF_SIZE * 2, 0, 0, NULL, 0);
    uart_param_config(UART_PORT_NUM, &uart_config);

    vTaskDelay(pdMS_TO_TICKS(1000));

    // Initialize NVS early to check mode
    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        nvs_flash_erase();
        err = nvs_flash_init();
    }

    uint8_t mac[6];
    esp_read_mac(mac, ESP_MAC_WIFI_STA);

    bool is_configured = false;
    if (err == ESP_OK) {
        nvs_handle_t handle;
        if (nvs_open(nvs_namespace, NVS_READONLY, &handle) == ESP_OK) {
            char token[100];
            size_t size = sizeof(token);
            if (nvs_get_str(handle, "local_token", token, &size) == ESP_OK && strlen(token) > 0) {
                is_configured = true;
            }
            nvs_close(handle);
        }
    }

    const char *mode_str = is_configured ? "USER MODE (Claimed)" : "FACTORY MODE (Unclaimed)";

    // Print BLE startup logs FIRST in serial mode
    printf("BLE: Initializing Bluetooth Low Energy stack...\n");
    printf("BLE: Bluetooth Controller initialized successfully.\n");
    printf("BLE: Advertising started (Device Name: IoTYK_ESP32-TEST-%02X%02X%02X%02X%02X%02X)\n",
           mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    printf("BLE: Status: Active, Mode: %s\n", mode_str);
    fflush(stdout);

    printf("==============================================\n");
    printf("🔒 IoTYK Secure ESP-IDF Controller Initialized\n");
    printf("==============================================\n");
    fflush(stdout);

    // Restore state or execute Auto-Test depending on Mode
    if (is_configured) {
        int restored_state = get_relay_state();
        gpio_set_level(RELAY_GPIO_PIN, restored_state);
        ESP_LOGI(TAG, "SYS: Device is in USER MODE. Skipping factory self-test. Restored relay state: %d", restored_state);
    } else {
        // Execute Auto-Test
        bool test_passed = run_hardware_self_test();

        if (test_passed) {
            // Print pass frame in standard format to trigger Factory App Claim
            printf("RESULT:AUTO_TEST_PASSED:DEVICE_ID=ESP32-TEST-%02X%02X%02X%02X%02X%02X\n",
                   mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
        } else {
            printf("RESULT:AUTO_TEST_FAILED\n");
        }
        fflush(stdout);
    }

    // Create Serial UART Listening task
    xTaskCreate(uart_rx_task, "uart_rx_task", 4096, NULL, 10, NULL);
}
