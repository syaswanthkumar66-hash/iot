#ifndef IOTYK_LOCAL_SERVER_H
#define IOTYK_LOCAL_SERVER_H

#include <WebServer.h>
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
extern String getBleName();

WebServer server(LOCAL_HTTP_PORT);
WebSocketsServer localWs(LOCAL_WS_PORT);
#if LOCAL_WSS_ENABLED
WebSocketsServer localWss(LOCAL_WSS_PORT);
#endif
String localDeviceId = "";

// Basic Auth Check using the local pairing token
bool checkAuth() {
  if (!server.hasHeader("Authorization")) return false;
  String auth = server.header("Authorization");
  if (!auth.startsWith("Bearer ")) return false;
  
  String token = auth.substring(7);
  String validToken = prefs.getString(KEY_LOCAL_TOKEN, "");
  
  if (validToken == "" || token != validToken) return false;
  
  return true;
}

void handleLocalWsEvent(WebSocketsServer& wsServer, const char* label, uint8_t num, WStype_t type, uint8_t * payload, size_t length) {
  if (type == WStype_CONNECTED) {
    IPAddress ip = wsServer.remoteIP(num);
    Serial.println(String(label) + " connected: " + ip.toString());
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
    wsServer.sendTXT(num, "{\"error\":\"Invalid JSON\"}");
    return;
  }

  String token = doc["token"] | "";
  String validToken = prefs.getString(KEY_LOCAL_TOKEN, "");
  if (validToken == "" || token != validToken) {
    wsServer.sendTXT(num, "{\"error\":\"Unauthorized\"}");
    return;
  }

  String cmdJson;
  if (doc["cmd"].isNull()) {
    serializeJson(doc, cmdJson);
  } else {
    serializeJson(doc["cmd"], cmdJson);
  }

  Serial.println(String(label) + " Cmd: " + cmdJson);
  handleCommand(cmdJson);
  wsServer.sendTXT(num, getCurrentStateJson());
}

void setupLocalServer(String deviceId) {
  localDeviceId = deviceId;
  if (!MDNS.begin(deviceId.c_str())) {
    Serial.println("Error setting up MDNS responder!");
  } else {
    Serial.println("mDNS responder started: " + deviceId + ".local");
    // Add service to MDNS-SD
    MDNS.addService("iotyk", "tcp", LOCAL_HTTP_PORT);
    MDNS.addServiceTxt("iotyk", "tcp", "id", deviceId);
    MDNS.addServiceTxt("iotyk", "tcp", "mac", getDeviceMac());
    MDNS.addServiceTxt("iotyk", "tcp", "ble", getBleName());
    MDNS.addServiceTxt("iotyk", "tcp", "fw", FIRMWARE_VERSION);
    MDNS.addService("iotyk-ws", "tcp", LOCAL_WS_PORT);
    MDNS.addServiceTxt("iotyk-ws", "tcp", "id", deviceId);
    MDNS.addServiceTxt("iotyk-ws", "tcp", "mac", getDeviceMac());
#if LOCAL_WSS_ENABLED
    MDNS.addService("iotyk-wss", "tcp", LOCAL_WSS_PORT);
    MDNS.addServiceTxt("iotyk-wss", "tcp", "id", deviceId);
    MDNS.addServiceTxt("iotyk-wss", "tcp", "mac", getDeviceMac());
#endif
  }

  // Need to collect headers for auth
  const char * headerkeys[] = {"Authorization"} ;
  size_t headerkeyssize = sizeof(headerkeys)/sizeof(char*);
  server.collectHeaders(headerkeys, headerkeyssize);

  // --- Endpoints ---

  server.on("/info", HTTP_GET, []() {
    StaticJsonDocument<384> doc;
    doc["id"] = localDeviceId;
    doc["firmware"] = FIRMWARE_VERSION;
    doc["mac"] = getDeviceMac();
    doc["ble_name"] = getBleName();
    doc["host"] = localDeviceId + ".local";
    doc["http_port"] = LOCAL_HTTP_PORT;
    doc["ws_port"] = LOCAL_WS_PORT;
    doc["wss_port"] = LOCAL_WSS_PORT;
    doc["local_ws"] = "ws://" + localDeviceId + ".local:" + String(LOCAL_WS_PORT);
    doc["local_wss"] = "wss://" + localDeviceId + ".local:" + String(LOCAL_WSS_PORT);
    doc["local_wss_supported"] = LOCAL_WSS_ENABLED && hasUsableCertPair(LOCAL_WSS_SERVER_CERT, LOCAL_WSS_PRIVATE_KEY);
    doc["rssi"] = WiFi.RSSI();

    String json;
    serializeJson(doc, json);
    server.send(200, "application/json", json);
  });

  server.on("/state", HTTP_GET, []() {
    if (!checkAuth()) {
      server.send(401, "application/json", "{\"error\":\"Unauthorized\"}");
      return;
    }
    server.send(200, "application/json", getCurrentStateJson());
  });

  server.on("/cmd", HTTP_POST, []() {
    if (!checkAuth()) {
      server.send(401, "application/json", "{\"error\":\"Unauthorized\"}");
      return;
    }
    
    if (server.hasArg("plain") == false) {
      server.send(400, "application/json", "{\"error\":\"Body required\"}");
      return;
    }
    
    String body = server.arg("plain");
    Serial.println("Local HTTP Cmd: " + body);
    
    handleCommand(body);
    
    server.send(200, "application/json", getCurrentStateJson());
  });

  server.begin();
  Serial.println("HTTP server started");

  localWs.begin();
  localWs.onEvent([](uint8_t num, WStype_t type, uint8_t * payload, size_t length) {
    handleLocalWsEvent(localWs, "Local WS", num, type, payload, length);
  });
  Serial.println("WebSocket server started on port " + String(LOCAL_WS_PORT));

#if LOCAL_WSS_ENABLED
  if (hasUsableCertPair(LOCAL_WSS_SERVER_CERT, LOCAL_WSS_PRIVATE_KEY)) {
    localWss.beginSSL(LOCAL_WSS_SERVER_CERT, LOCAL_WSS_PRIVATE_KEY);
    localWss.onEvent([](uint8_t num, WStype_t type, uint8_t * payload, size_t length) {
      handleLocalWsEvent(localWss, "Local WSS", num, type, payload, length);
    });
    Serial.println("Secure WebSocket server started on port " + String(LOCAL_WSS_PORT));
  } else {
    Serial.println("LOCAL_WSS_ENABLED is true but certificate/private key placeholders are not filled.");
  }
#endif
}

void loopLocalServer() {
  server.handleClient();
  localWs.loop();
#if LOCAL_WSS_ENABLED
  localWss.loop();
#endif
}

void broadcastLocalState() {
  localWs.broadcastTXT(getCurrentStateJson());
#if LOCAL_WSS_ENABLED
  localWss.broadcastTXT(getCurrentStateJson());
#endif
}

#endif
