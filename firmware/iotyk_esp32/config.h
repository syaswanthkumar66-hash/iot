#ifndef IOTYK_CONFIG_H
#define IOTYK_CONFIG_H

// --- Hardware ---
#define LED_PIN 2
#define RELAY_COUNT 1
#define RELAY_ACTIVE_LOW true
static const uint8_t RELAY_PINS[RELAY_COUNT] = {26};

// --- BLE UUIDs ---
// Match the React Native app
#define BLE_SERVICE_UUID "12345678-1234-1234-1234-123456789abc"
#define BLE_WIFI_CHAR_UUID "abcd1234-5678-1234-5678-abcdef123456"
#define BLE_TOKEN_CHAR_UUID "abcd1234-5678-1234-5678-abcdef123457" // New for token exchange

// --- EMQX MQTT Configuration ---
#define MQTT_BROKER "xxxx.ala.us-east-1.emqxsl.com" // Update this!
#define MQTT_PORT 8883 // TLS port
#define MQTT_KEEP_ALIVE 60

// --- Factory values for downloadable firmware ---
// The factory website replaces these values for each generated device.
#define FACTORY_DEVICE_ID ""
#define FACTORY_DEVICE_NS ""
#define FACTORY_PERM_MQTT_USER ""
#define FACTORY_PERM_MQTT_PASS ""
#define FACTORY_LOCAL_TOKEN ""

// --- Local network services ---
#define LOCAL_HTTP_PORT 80
#define LOCAL_WS_PORT 81
#define LOCAL_WSS_PORT 82
#define LOCAL_WSS_ENABLED false
#define FIRMWARE_VERSION "1.1.0"

// --- NVS Storage Keys ---
#define NVS_NAMESPACE "iotyk"
#define KEY_WIFI_SSID "w_ssid"
#define KEY_WIFI_PASS "w_pass"
#define KEY_DEVICE_ID "d_id"
#define KEY_DEVICE_NS "d_ns"
#define KEY_PERM_USER "m_p_usr"
#define KEY_PERM_PASS "m_p_pwd"
#define KEY_TEMP_USER "m_t_usr"
#define KEY_TEMP_PASS "m_t_pwd"
#define KEY_LOCAL_TOKEN "l_tok"

#endif
