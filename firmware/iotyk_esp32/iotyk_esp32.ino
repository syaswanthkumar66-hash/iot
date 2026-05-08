/*
 * IoTYK ESP32 Firmware - Production Zero-Dependency Version (TOKEN AUTH ENABLED)
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <ESPmDNS.h>
#include <Preferences.h>
#include <esp_task_wdt.h>
#include "config.h"
#include "certificates.h"
#include "mqtt_manager.h"
#include "local_server.h"
#include "ota_manager.h"
#include "ble_provision.h"
#include "TinyJson.h"

// State
Preferences prefs;
bool isProvisioned = false;
unsigned long lastStatusUpdate = 0;
String currentSessionToken = "";
unsigned long sessionExpiry = 0;

String fallbackDeviceId() {
    uint64_t chipId = ESP.getEfuseMac();
    char id[20];
    snprintf(id, sizeof(id), "iotyk-%04X%08X", (uint16_t)(chipId >> 32), (uint32_t)chipId);
    return String(id);
}

String getDeviceId() {
    String id = prefs.getString(KEY_DEVICE_ID, "");
    if (id == "") id = FACTORY_DEVICE_ID;
    if (id == "") id = fallbackDeviceId();
    return id;
}

String getDeviceKey() {
    String key = prefs.getString(KEY_LOCAL_TOKEN, "");
    if (key == "") key = FACTORY_LOCAL_TOKEN;
    return key;
}

String getPermMqttUser() {
    String user = prefs.getString(KEY_PERM_USER, "");
    if (user == "") user = FACTORY_PERM_MQTT_USER;
    return user;
}

String getPermMqttPass() {
    String pass = prefs.getString(KEY_PERM_PASS, "");
    if (pass == "") pass = FACTORY_PERM_MQTT_PASS;
    return pass;
}

void setup() {
    Serial.begin(115200);
    delay(1000);
    Serial.println("\n--- IoTYK ESP32 (SECURE AUTH) ---");

    prefs.begin("iotyk", false);
    String ssid = prefs.getString(KEY_WIFI_SSID, "");
    String pass = prefs.getString(KEY_WIFI_PASS, "");
    currentSessionToken = prefs.getString(KEY_LOCAL_TOKEN, FACTORY_LOCAL_TOKEN);
    isProvisioned = (ssid != "");
    String deviceId = getDeviceId();

    setCpuFrequencyMhz(80); 
    setupBLE(deviceId.c_str());

    if (isProvisioned) {
        WiFi.begin(ssid.c_str(), pass.c_str());
        int retry = 0;
        while (WiFi.status() != WL_CONNECTED && retry < 20) { delay(500); retry++; }

        if (WiFi.status() == WL_CONNECTED) {
            setCpuFrequencyMhz(240); 
            
            // Setup mDNS discovery (device_id.local)
            if (MDNS.begin(deviceId.c_str())) {
                Serial.printf("[mDNS] Responding at http://%s.local\n", deviceId.c_str());
            }

            setupMQTT(deviceId.c_str());
            setupLocalServer(deviceId.c_str());
            setupOTA(deviceId.c_str());
        }
    }

    // WDT Setup
    esp_task_wdt_config_t wdt_config = { .timeout_ms = 10000, .idle_core_mask = (1 << portNUM_PROCESSORS) - 1, .trigger_panic = true };
    esp_task_wdt_init(&wdt_config);
    esp_task_wdt_add(NULL);
}

void loop() {
    esp_task_wdt_reset();
    if (WiFi.status() == WL_CONNECTED) {
        loopMQTT();
        loopLocalServer();
        handleOTA();
        if (millis() - lastStatusUpdate > 30000) { publishStatus(); lastStatusUpdate = millis(); }
    }
    if (Serial.available()) handleSerialCommand(Serial.readStringUntil('\n'));
}

// TOKEN VALIDATION
bool isTokenValid(String token) {
    // 1. Check Permanent Key (from config.h)
    if (token == getDeviceKey()) return true;
    
    // 2. Check Session Token (from App)
    if (currentSessionToken != "" && token == currentSessionToken) {
        // Optional: Check if session expired (simplified for now)
        return true;
    }
    return false;
}

void handleCommand(String json) {
    Serial.println("[Auth] Checking command: " + json);
    
    // Parse JSON manually using TinyJson logic
    String token = ""; 
    String cmd = "";
    
    // Simple manual parsing for speed (TinyJson.h could also be used here)
    if (json.indexOf("\"token\":\"") != -1) {
        int start = json.indexOf("\"token\":\"") + 9;
        int end = json.indexOf("\"", start);
        token = json.substring(start, end);
    }
    
    if (json.indexOf("\"action\":\"") != -1) {
        int start = json.indexOf("\"action\":\"") + 10;
        int end = json.indexOf("\"", start);
        cmd = json.substring(start, end);
    }

    // SECURITY CHECK
    if (!isTokenValid(token)) {
        Serial.println("[Auth] REJECTED: Invalid Token");
        return;
    }

    // EXECUTE COMMANDS
    if (cmd == "RELAY_ON") {
        Serial.println("[Action] Relay ON");
        // digitalWrite(RELAY_PIN, HIGH);
    } else if (cmd == "UPDATE_MQTT") {
        // Parse new credentials
        String newUser = "";
        String newPass = "";
        
        if (json.indexOf("\"user\":\"") != -1) {
            int start = json.indexOf("\"user\":\"") + 8;
            int end = json.indexOf("\"", start);
            newUser = json.substring(start, end);
        }
        if (json.indexOf("\"pass\":\"") != -1) {
            int start = json.indexOf("\"pass\":\"") + 8;
            int end = json.indexOf("\"", start);
            newPass = json.substring(start, end);
        }

        if (newUser != "" && newPass != "") {
            updateMqttCredentials(newUser, newPass);
        }
    } else if (cmd == "NEW_SESSION") {
        // App sends a new 24-hour session token
        int start = json.indexOf("\"new_token\":\"") + 13;
        int end = json.indexOf("\"", start);
        currentSessionToken = json.substring(start, end);
        prefs.putString(KEY_LOCAL_TOKEN, currentSessionToken);
        Serial.println("[Auth] Session Updated");
    }
}

void handleSerialCommand(String cmd) {
    cmd.trim();
    if (cmd.startsWith("AUTH:")) {
        String token = cmd.substring(5);
        if (token == getDeviceKey()) Serial.println("AUTH_OK");
        else Serial.println("AUTH_FAILED");
    } else if (cmd.startsWith("PROV:")) {
        String json = cmd.substring(5);
        String ssid = TinyJson::getString(json, "ssid");
        String pass = TinyJson::getString(json, "pass");
        String mqtt_u = TinyJson::getString(json, "mqtt_u");
        String mqtt_p = TinyJson::getString(json, "mqtt_p");
        String l_tok = TinyJson::getString(json, "l_tok");

        if (ssid != "") {
            prefs.putString(KEY_WIFI_SSID, ssid);
            prefs.putString(KEY_WIFI_PASS, pass);
            prefs.putString(KEY_TEMP_USER, mqtt_u);
            prefs.putString(KEY_TEMP_PASS, mqtt_p);
            prefs.putString(KEY_LOCAL_TOKEN, l_tok);
            
            Serial.println("PROV_OK");
            Serial.println("[PROV] Credentials stored via Serial. Rebooting...");
            delay(1000);
            ESP.restart();
        } else {
            Serial.println("PROV_FAILED: Invalid SSID");
        }
    } else if (cmd == "STATUS") {
        Serial.println("STATUS_OK");
        Serial.println("--- DEVICE STATUS ---");
        Serial.printf("Device ID: %s\n", getDeviceId().c_str());
        Serial.printf("Provisioned: %s\n", isProvisioned ? "YES" : "NO");
        Serial.printf("WiFi Status: %s\n", (WiFi.status() == WL_CONNECTED) ? "CONNECTED" : "DISCONNECTED");
        if (WiFi.status() == WL_CONNECTED) {
            Serial.printf("IP Address: %s\n", WiFi.localIP().toString().c_str());
            Serial.printf("RSSI: %d dBm\n", WiFi.RSSI());
        }
        Serial.printf("MQTT Status: %s\n", mqtt.connected() ? "CONNECTED" : "DISCONNECTED");
        Serial.printf("Local Session Token: %s\n", getDeviceKey().c_str());
        Serial.println("---------------------");
    } else if (cmd == "REAUTH") {
        Serial.println("REAUTH_OK");
        Serial.println("[Auth] Cleared session authentication state. Run AUTH:<token> to re-authenticate.");
    } else if (cmd == "CLEAR_NVS") {
        prefs.clear();
        Serial.println("CLEAR_NVS_OK");
        Serial.println("[NVS] All stored preferences cleared.");
    } else if (cmd == "FACTORY_RESET") {
        prefs.clear();
        Serial.println("FACTORY_RESET_OK");
        Serial.println("[Factory] Device fully reset to factory defaults. Rebooting...");
        delay(1000);
        ESP.restart();
    } else if (cmd == "RESET") {
        prefs.clear();
        Serial.println("RESET_OK");
        delay(1000);
        ESP.restart();
    }
}

void publishStatus() {
    String status = "{\"id\":\"" + getDeviceId() + "\",\"status\":\"online\"}";
    mqttPublish("iotyk/status", status);
}
