#ifndef IOTYK_LOCAL_SERVER_H
#define IOTYK_LOCAL_SERVER_H

#include <WebSocketsServer.h>
#include <ESPmDNS.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include "config.h"
#include "certificates.h"

extern Preferences prefs;
extern void handleCommand(String cmdJson);
extern String getCurrentStateJson();
extern String getDeviceMac();

// Only the Secure WebSocket Server (WSS)
WebSocketsServer localWss(LOCAL_WSS_PORT);
String localDeviceId = "";

void handleWssEvent(uint8_t num, WStype_t type, uint8_t * payload, size_t length) {
  if (type == WStype_CONNECTED) {
    IPAddress ip = localWss.remoteIP(num);
    Serial.println("App connected via WSS: " + ip.toString());
    // Send initial state immediately upon connection
    localWss.sendTXT(num, getCurrentStateJson());
    return;
  }

  if (type != WStype_TEXT) return;

  String body = "";
  for (size_t i = 0; i < length; i++) {
    body += (char)payload[i];
  }

  StaticJsonDocument<512> doc;
  DeserializationError error = deserializeJson(doc, body);
  if (error) {
    localWss.sendTXT(num, "{\"error\":\"Invalid JSON\"}");
    return;
  }

  // Auth Check (using pairing token)
  String token = doc["token"] | "";
  String validToken = prefs.getString(KEY_LOCAL_TOKEN, "");
  if (validToken == "" || token != validToken) {
    localWss.sendTXT(num, "{\"error\":\"Unauthorized\"}");
    return;
  }

  // Handle Command
  String cmdJson;
  if (doc["cmd"].isNull()) {
    serializeJson(doc, cmdJson);
  } else {
    serializeJson(doc["cmd"], cmdJson);
  }

  Serial.println("WSS Cmd: " + cmdJson);
  handleCommand(cmdJson);
  
  // Respond with new state
  localWss.sendTXT(num, getCurrentStateJson());
}

void setupLocalServer(String deviceId) {
  localDeviceId = deviceId;
  
  // 1. Setup mDNS discovery for WSS only
  if (MDNS.begin(deviceId.c_str())) {
    Serial.println("mDNS started: " + deviceId + ".local");
    MDNS.addService("iotyk-wss", "tcp", LOCAL_WSS_PORT);
    MDNS.addServiceTxt("iotyk-wss", "tcp", "id", deviceId);
    MDNS.addServiceTxt("iotyk-wss", "tcp", "mac", getDeviceMac());
    MDNS.addServiceTxt("iotyk-wss", "tcp", "fw", FIRMWARE_VERSION);
  }

  // 2. Start WSS Server if certificates are present
  if (hasUsableCa(LOCAL_WSS_SERVER_CERT)) {
    localWss.beginSSL(LOCAL_WSS_SERVER_CERT, LOCAL_WSS_PRIVATE_KEY);
    localWss.onEvent(handleWssEvent);
    Serial.println("Secure WSS Server started on port " + String(LOCAL_WSS_PORT));
  } else {
    Serial.println("CRITICAL ERROR: Cannot start WSS Server - Missing SSL Certificates!");
  }
}

void loopLocalServer() {
  localWss.loop();
}

void broadcastLocalState() {
  localWss.broadcastTXT(getCurrentStateJson());
}

#endif
