#ifndef IOTYK_LOCAL_SERVER_H
#define IOTYK_LOCAL_SERVER_H

#include <WiFi.h>
#include <ESPmDNS.h>
#include <Preferences.h>
#include "config.h"
#include "certificates.h"
#include "TinyJson.h"
#include "TinyWss.h"

extern Preferences prefs;
extern void handleCommand(String cmdJson);
extern String getCurrentStateJson();

// WSS Server on port 82 (standard for IoTYK local secure comms)
TinyWss localWss(82);

void onWssMessage(String payload) {
    handleCommand(payload);
}

void setupLocalServer(String deviceId) {
    if (!MDNS.begin(deviceId.c_str())) {
        Serial.println("[mDNS] Error setting up mDNS");
    } else {
        MDNS.addService("wss", "tcp", 82);
    }
    
    // Start Secure WebSocket with own generated certs
    localWss.begin(LOCAL_WSS_SERVER_CERT, LOCAL_WSS_PRIVATE_KEY);
    Serial.println("[WSS] Local Secure WebSocket started on port 82");
}

void loopLocalServer() {
    localWss.handle(onWssMessage);
}

void broadcastLocalState() {
    // In this zero-dependency version, the server handles 1 client at a time.
    // The client (mobile app) will receive updates via the WSS connection.
}

#endif
