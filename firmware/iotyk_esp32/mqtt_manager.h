#ifndef MQTT_MANAGER_H
#define MQTT_MANAGER_H

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include "TinyMqtt.h"
#include "TinyJson.h"
#include "config.h"
#include "certificates.h"

extern Preferences prefs;
extern String getDeviceId();
extern String getPermMqttUser();
extern String getPermMqttPass();
WiFiClientSecure net;
TinyMqtt mqtt(net);

void setupMQTT(const char* deviceId) {
    net.setCACert(EMQX_MQTT_CA_CERT);
    mqtt.setServer(MQTT_BROKER, MQTT_PORT);

    // DUAL-AUTH LOGIC
    String user = prefs.getString(KEY_TEMP_USER, "");
    String pass = prefs.getString(KEY_TEMP_PASS, "");

    if (user != "") {
        Serial.println("[MQTT] Attempting connection with TEMPORARY credentials...");
        mqtt.setCredentials(String(deviceId), user, pass);
        if (mqtt.connect()) {
            Serial.println("[MQTT] Connected via TEMPORARY Auth");
            mqtt.subscribe("iotyk/cmd/" + String(deviceId));
            return;
        }
        Serial.println("[MQTT] Temporary Auth failed/expired. Falling back...");
    }

    // FALLBACK TO PERMANENT
    Serial.println("[MQTT] Attempting connection with PERMANENT credentials...");
    mqtt.setCredentials(String(deviceId), getPermMqttUser(), getPermMqttPass());
    if (mqtt.connect()) {
        Serial.println("[MQTT] Connected via PERMANENT Auth");
        mqtt.subscribe("iotyk/cmd/" + String(deviceId));
    } else {
        Serial.println("[MQTT] Critical Failure: Both auth methods failed.");
    }
}

void loopMQTT() {
    mqtt.loop();
    if (!mqtt.connected()) {
        static unsigned long lastReconnect = 0;
        if (millis() - lastReconnect > 5000) {
            String deviceId = getDeviceId();
            setupMQTT(deviceId.c_str());
            lastReconnect = millis();
        }
    }
}

void mqttPublish(String topic, String payload) {
    mqtt.publish(topic, payload);
}

void updateMqttCredentials(String newUser, String newPass) {
    prefs.putString(KEY_TEMP_USER, newUser);
    prefs.putString(KEY_TEMP_PASS, newPass);
    Serial.println("[MQTT] New credentials saved. Rebooting...");
    delay(1000);
    ESP.restart();
}

#endif
