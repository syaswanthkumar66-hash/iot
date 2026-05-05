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

// State
Preferences prefs;
bool isProvisioned = false;
unsigned long lastStatusUpdate = 0;
String currentSessionToken = "";
unsigned long sessionExpiry = 0;

void setup() {
    Serial.begin(115200);
    delay(1000);
    Serial.println("\n--- IoTYK ESP32 (SECURE AUTH) ---");

    prefs.begin("iotyk", false);
    String ssid = prefs.getString("wifi_ssid", "");
    String pass = prefs.getString("wifi_pass", "");
    currentSessionToken = prefs.getString("session_token", "");
    isProvisioned = (ssid != "");

    setCpuFrequencyMhz(80); 
    setupBLE(DEVICE_ID);

    if (isProvisioned) {
        WiFi.begin(ssid.c_str(), pass.c_str());
        int retry = 0;
        while (WiFi.status() != WL_CONNECTED && retry < 20) { delay(500); retry++; }

        if (WiFi.status() == WL_CONNECTED) {
            setCpuFrequencyMhz(240); 
            
            // Setup mDNS discovery (device_id.local)
            if (MDNS.begin(DEVICE_ID)) {
                Serial.printf("[mDNS] Responding at http://%s.local\n", DEVICE_ID);
            }

            setupMQTT(DEVICE_ID);
            setupLocalServer(DEVICE_ID);
            setupOTA(DEVICE_ID);
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
    if (token == DEVICE_KEY) return true;
    
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
        prefs.putString("session_token", currentSessionToken);
        Serial.println("[Auth] Session Updated");
    }
}

void handleSerialCommand(String cmd) {
    if (cmd.startsWith("AUTH:")) {
        String token = cmd.substring(5);
        if (token == DEVICE_KEY) Serial.println("AUTH_OK");
        else Serial.println("AUTH_FAILED");
    } else if (cmd == "RESET") {
        prefs.clear();
        Serial.println("RESET_OK");
        delay(1000);
        ESP.restart();
    }
}

void publishStatus() {
    String status = "{\"id\":\"" + String(DEVICE_ID) + "\",\"status\":\"online\"}";
    mqttPublish("iotyk/status", status);
}