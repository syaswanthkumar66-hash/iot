#ifndef MQTT_MANAGER_H
#define MQTT_MANAGER_H

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include "TinyMqtt.h"
#include "TinyJson.h"
#include "config.h"
#include "certificates.h"

extern Preferences prefs;
WiFiClientSecure net;
TinyMqtt mqtt(net);

void setupMQTT(const char* deviceId) {
    net.setCACert(EMQX_MQTT_CA_CERT);
    mqtt.setServer(MQTT_HOST, MQTT_PORT);

    // DUAL-AUTH LOGIC
    String user = prefs.getString("mqtt_user", "");
    String pass = prefs.getString("mqtt_pass", "");

    if (user != "") {
        Serial.println("[MQTT] Attempting connection with TEMPORARY credentials...");
        mqtt.setCredentials(user.c_str(), pass.c_str());
        if (mqtt.connect(deviceId)) {
            Serial.println("[MQTT] Connected via TEMPORARY Auth ✅");
            mqtt.subscribe("iotyk/cmd/" + String(deviceId));
            return;
        }
        Serial.println("[MQTT] Temporary Auth failed/expired. Falling back...");
    }

    // FALLBACK TO PERMANENT
    Serial.println("[MQTT] Attempting connection with PERMANENT credentials...");
    mqtt.setCredentials(MQTT_USER, MQTT_PASS); // From config.h
    if (mqtt.connect(deviceId)) {
        Serial.println("[MQTT] Connected via PERMANENT Auth 🔒");
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
            setupMQTT(DEVICE_ID);
            lastReconnect = millis();
        }
    }
}

void mqttPublish(String topic, String payload) {
    mqtt.publish(topic, payload);
}

void updateMqttCredentials(String newUser, String newPass) {
    prefs.putString("mqtt_user", newUser);
    prefs.putString("mqtt_pass", newPass);
    Serial.println("[MQTT] New credentials saved. Rebooting...");
    delay(1000);
    ESP.restart();
}

#endif