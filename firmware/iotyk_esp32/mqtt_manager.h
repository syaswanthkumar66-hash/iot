#ifndef IOTYK_MQTT_H
#define IOTYK_MQTT_H

#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include "config.h"
#include "certificates.h"

extern Preferences prefs;
extern void handleCommand(String cmdJson);
extern String getCurrentStateJson();
extern void onMqttFullyConnected();
extern void onMqttDisconnected();

WiFiClientSecure netPerm;
WiFiClientSecure netTemp;
PubSubClient mqttPerm(netPerm);
PubSubClient mqttTemp(netTemp);

String deviceNamespace = "";
unsigned long lastHeartbeat = 0;

// LED transition tracking
static bool wasBothConnected = false;

// Check and handle LED state transitions based on MQTT connection status
void checkLedTransition() {
  bool bothNow = mqttPerm.connected() && mqttTemp.connected();
  
  if (bothNow && !wasBothConnected) {
    wasBothConnected = true;
    onMqttFullyConnected();
  }
  
  if (!bothNow && wasBothConnected) {
    wasBothConnected = false;
    onMqttDisconnected();
  }
}

// Connect to permanent connection
void connectPermanentMqtt() {
  if (mqttPerm.connected() || deviceNamespace == "") return;

  static unsigned long lastPermRetry = 0;
  if (millis() - lastPermRetry < 5000) return;  // 5 second retry delay
  lastPermRetry = millis();

  String permUser = prefs.getString(KEY_PERM_USER, "");
  String permPass = prefs.getString(KEY_PERM_PASS, "");
  
  if (permUser == "" || permPass == "") return;

  String clientId = "esp32_p_" + String(random(0xffff), HEX);
  
  Serial.print("Connecting Permanent MQTT...");
  if (mqttPerm.connect(clientId.c_str(), permUser.c_str(), permPass.c_str())) {
    Serial.println(" Connected!");
    // Subscribe to system commands (rotate credentials, factory reset)
    String sysTopic = "device/" + deviceNamespace + "/sys/#";
    mqttPerm.subscribe(sysTopic.c_str(), 1);
    checkLedTransition();  // Check transition after successful connect
  } else {
    Serial.print(" Failed, rc=");
    Serial.println(mqttPerm.state());
  }
}

// Connect to temporary connection
void connectTemporaryMqtt() {
  if (mqttTemp.connected() || deviceNamespace == "") return;

  static unsigned long lastTempRetry = 0;
  if (millis() - lastTempRetry < 5000) return;  // 5 second retry delay
  lastTempRetry = millis();

  String tempUser = prefs.getString(KEY_TEMP_USER, "");
  String tempPass = prefs.getString(KEY_TEMP_PASS, "");
  
  if (tempUser == "" || tempPass == "") return;

  String clientId = "esp32_t_" + String(random(0xffff), HEX);
  
  Serial.print("Connecting Temporary MQTT...");
  if (mqttTemp.connect(clientId.c_str(), tempUser.c_str(), tempPass.c_str())) {
    Serial.println(" Connected!");
    // Subscribe to user commands
    String cmdTopic = "device/" + deviceNamespace + "/cmd";
    mqttTemp.subscribe(cmdTopic.c_str(), 1);
    
    // Publish initial state
    String stateTopic = "device/" + deviceNamespace + "/state";
    mqttTemp.publish(stateTopic.c_str(), getCurrentStateJson().c_str(), false);
    checkLedTransition();  // Check transition after successful connect
  } else {
    Serial.print(" Failed, rc=");
    Serial.println(mqttTemp.state());
    // If auth fails (rc=5 or rc=4), credentials expired. We wait for rotation on permanent connection.
  }
}

// Permanent connection callback (System commands)
void permCallback(char* topic, byte* payload, unsigned int length) {
  String t = String(topic);
  String msg = "";
  for (int i = 0; i < length; i++) {
    msg += (char)payload[i];
  }
  
  Serial.println("Sys Msg: " + t + " -> " + msg);

  if (t.endsWith("/sys/rotate")) {
    // Parse new temporary credentials
    StaticJsonDocument<256> doc;
    DeserializationError error = deserializeJson(doc, msg);
    if (!error) {
      String newUsr = doc["username"];
      String newPwd = doc["password"];
      
      if (newUsr != "" && newPwd != "") {
        prefs.putString(KEY_TEMP_USER, newUsr);
        prefs.putString(KEY_TEMP_PASS, newPwd);
        
        Serial.println("Credentials rotated. Reconnecting temporary MQTT...");
        mqttTemp.disconnect();
        connectTemporaryMqtt();
      }
    }
  } else if (t.endsWith("/sys/reset")) {
    Serial.println("Factory Reset command received via MQTT. Erasing all data...");
    prefs.clear();
    ESP.restart();
  }
}

// Temporary connection callback (User commands)
void tempCallback(char* topic, byte* payload, unsigned int length) {
  String msg = "";
  for (int i = 0; i < length; i++) {
    msg += (char)payload[i];
  }
  Serial.println("Cmd Msg: " + msg);
  
  // Pass to main logic
  handleCommand(msg);
}

void setupMqtt() {
  deviceNamespace = prefs.getString(KEY_DEVICE_NS, "");
  
  if (hasUsableCa(EMQX_MQTT_CA_CERT)) {
    netPerm.setCACert(EMQX_MQTT_CA_CERT);
    netTemp.setCACert(EMQX_MQTT_CA_CERT);
    Serial.println("MQTT TLS CA certificate loaded.");
  } else {
    Serial.println("WARNING: EMQX_MQTT_CA_CERT is empty. MQTT TLS validation is disabled until you paste the EMQX CA.");
    netPerm.setInsecure();
    netTemp.setInsecure();
  }

  mqttPerm.setServer(MQTT_BROKER, MQTT_PORT);
  mqttPerm.setCallback(permCallback);
  
  mqttTemp.setServer(MQTT_BROKER, MQTT_PORT);
  mqttTemp.setCallback(tempCallback);
}

void loopMqtt() {
  if (WiFi.status() != WL_CONNECTED) return;

  if (!mqttPerm.connected()) {
    connectPermanentMqtt();
  }
  mqttPerm.loop();

  if (!mqttTemp.connected()) {
    connectTemporaryMqtt();
  }
  mqttTemp.loop();

  // Check LED transitions every loop iteration
  checkLedTransition();

  // Publish heartbeat on permanent connection every 30s
  if (millis() - lastHeartbeat > 30000) {
    if (mqttPerm.connected() && deviceNamespace != "") {
      String statusTopic = "device/" + deviceNamespace + "/status";
      String payload = "{\"online\":true,\"ts\":" + String(millis()) + "}";
      mqttPerm.publish(statusTopic.c_str(), payload.c_str());
    }
    lastHeartbeat = millis();
  }
}

// Called by main logic when state changes
void publishState(String stateJson) {
  if (mqttTemp.connected() && deviceNamespace != "") {
    String stateTopic = "device/" + deviceNamespace + "/state";
    mqttTemp.publish(stateTopic.c_str(), stateJson.c_str(), false);
  }
}

#endif