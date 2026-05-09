#ifndef MAIN_CONFIG_H
#define MAIN_CONFIG_H

#include <stdint.h>

// --- Hardware Layout ---
#define LED_PIN 2
#define RELAY_COUNT 1
#define RELAY_ACTIVE_LOW true

// GPIO assignments
static const uint8_t RELAY_PINS[RELAY_COUNT] = {26};

// --- BLE NimBLE UUIDs ---
#define BLE_SERVICE_UUID     "12345678-1234-1234-1234-123456789abc"
#define BLE_WIFI_CHAR_UUID   "abcd1234-5678-1234-5678-abcdef123456"
#define BLE_TOKEN_CHAR_UUID  "abcd1234-5678-1234-5678-abcdef123457"

// --- EMQX MQTTS Configuration ---
#define DEFAULT_MQTT_BROKER "xxxx.ala.us-east-1.emqxsl.com" // Update as needed
#define MQTT_PORT           8883 // Secure SSL/TLS port
#define MQTT_KEEP_ALIVE     60

// --- Factory Fallbacks ---
#define FACTORY_DEVICE_ID      ""
#define FACTORY_DEVICE_NS      ""
#define FACTORY_PERM_MQTT_USER ""
#define FACTORY_PERM_MQTT_PASS ""
#define FACTORY_LOCAL_TOKEN    ""

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

#endif // MAIN_CONFIG_H
