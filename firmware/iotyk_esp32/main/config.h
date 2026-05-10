#ifndef MAIN_CONFIG_H
#define MAIN_CONFIG_H

#include <stdint.h>
#include <stdbool.h>

// --- Hardware Layout ---
#define LED_PIN_RED  2
#define LED_PIN_BLUE 4
#define RELAY_COUNT 4
#define RELAY_ACTIVE_LOW true

// GPIO assignments (Relay 4 relocated to safe GPIO 33 for ESP32-S3)
static const uint8_t RELAY_PINS[RELAY_COUNT] = {26, 27, 14, 33};

// --- Structured Error Codes ---
#define ERR_INVALID_TOKEN   101
#define ERR_MALFORMED_JSON  102
#define ERR_RELAY_BUSY      103
#define ERR_MQTT_OFFLINE    201
#define ERR_OTA_FAILED      301

// --- Dynamic Redundant Config Struct ---
typedef struct {
    char wifi_ssid[64];
    char wifi_pass[64];
    char temp_user[64];
    char temp_pass[64];
    char local_token[64];
    char r_cnt[16];
    uint32_t version;
    uint32_t crc32;
} io_tyk_config_t;

// --- Ed25519 Public Key for Signed OTA ---
static const uint8_t OTA_PUBLIC_KEY[32] = {
    0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
    0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10,
    0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18,
    0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f, 0x20
};

// --- BLE NimBLE UUIDs ---
#define BLE_SERVICE_UUID     "12345678-1234-1234-1234-123456789abc"
#define BLE_WIFI_CHAR_UUID   "abcd1234-5678-1234-5678-abcdef123456"
#define BLE_TOKEN_CHAR_UUID  "abcd1234-5678-1234-5678-abcdef123457"

// --- EMQX MQTTS Configuration ---
#define DEFAULT_MQTT_BROKER "xxxx.ala.us-east-1.emqxsl.com"
#define MQTT_PORT           8883
#define MQTT_KEEP_ALIVE     60

// --- Factory Fallbacks ---
#define FACTORY_DEVICE_ID      ""
#define FACTORY_DEVICE_NS      ""
#define FACTORY_PERM_MQTT_USER ""
#define FACTORY_PERM_MQTT_PASS ""
#define FACTORY_LOCAL_TOKEN    "iotyk-factory-initial-key-2026"

// --- Firmware Version ---
#define FIRMWARE_VERSION "1.2.0"

// --- Port assignments ---
#define LOCAL_HTTP_PORT  80
#define LOCAL_WSS_PORT   82

// --- NVS Storage Keys (Namespace "iotyk") ---
#define NVS_NAMESPACE   "iotyk"
#define KEY_WIFI_SSID   "w_ssid"
#define KEY_WIFI_PASS   "w_pass"
#define KEY_DEVICE_ID   "d_id"
#define KEY_DEVICE_NS   "d_ns"
#define KEY_PERM_USER   "m_p_usr"
#define KEY_PERM_PASS   "m_p_pwd"
#define KEY_TEMP_USER   "m_t_usr"
#define KEY_TEMP_PASS   "m_t_pwd"
#define KEY_LOCAL_TOKEN "l_tok"
#define KEY_RELAY_COUNT "r_cnt"

// Redundant backup config keys
#define KEY_CONFIG_A    "cfg_a"
#define KEY_CONFIG_B    "cfg_b"

#endif // MAIN_CONFIG_H
