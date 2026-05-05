#ifndef IOTYK_MQTT_H
#define IOTYK_MQTT_H

#include <WiFiClientSecure.h>
#include <Preferences.h>
#include "config.h"
#include "certificates.h"
#include "TinyMqtt.h"
#include "TinyJson.h"

extern Preferences prefs;
extern void handleCommand(String cmdJson);
extern String getCurrentStateJson();
extern void onMqttFullyConnected();
extern void onMqttDisconnected();

WiFiClientSecure netPerm;
TinyMqtt mqttPerm(netPerm);

unsigned long lastMqttRetry = 0;
bool mqttWasConnected = false;

void onMqttMessage(String topic, String payload) {
    handleCommand(payload);
}

void setupMqtt() {
    // Fixed: Use the correct CA certificate variable name
    netPerm.setCACert(EMQX_MQTT_CA_CERT);
    mqttPerm.setCallback(onMqttMessage);
    
    String broker = MQTT_BROKER;
    mqttPerm.setServer(broker, MQTT_PORT);
}

void loopMqtt() {
    if (!mqttPerm.connected()) {
        if (mqttWasConnected) {
            onMqttDisconnected();
            mqttWasConnected = false;
        }
        
        if (millis() - lastMqttRetry > 10000) {
            String user = prefs.getString(KEY_PERM_USER, "");
            String pass = prefs.getString(KEY_PERM_PASS, "");
            String devId = prefs.getString(KEY_DEVICE_ID, "ESP32-Unknown");
            
            if (user != "" && WiFi.status() == WL_CONNECTED) {
                mqttPerm.setCredentials(devId, user, pass);
                if (mqttPerm.connect()) {
                    String ns = prefs.getString(KEY_DEVICE_NS, "default");
                    mqttPerm.subscribe("iotyk/" + ns + "/cmd");
                    onMqttFullyConnected();
                    mqttWasConnected = true;
                }
            }
            lastMqttRetry = millis();
        }
    } else {
        mqttPerm.loop();
    }
}

void publishState(String json) {
    if (mqttPerm.connected()) {
        String ns = prefs.getString(KEY_DEVICE_NS, "default");
        mqttPerm.publish("iotyk/" + ns + "/state", json);
    }
}

#endif