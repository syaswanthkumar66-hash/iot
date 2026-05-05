#ifndef IOTYK_LOCAL_SERVER_H
#define IOTYK_LOCAL_SERVER_H

#include <WiFi.h>
#include <ESPmDNS.h>
#include <Preferences.h>
#include "config.h"
#include "TinyJson.h"

extern Preferences prefs;
extern void handleCommand(String cmdJson);
extern String getCurrentStateJson();

WiFiServer server(80);

void setupLocalServer(String deviceId) {
    if (!MDNS.begin(deviceId.c_str())) {
        Serial.println("[mDNS] Error setting up mDNS");
    } else {
        MDNS.addService("http", "tcp", 80);
    }
    server.begin();
}

void loopLocalServer() {
    WiFiClient client = server.available();
    if (client) {
        String request = client.readStringUntil('\r');
        client.flush();

        // Very simple API: GET /api/state or POST /api/cmd
        if (request.indexOf("/api/state") != -1) {
            client.println("HTTP/1.1 200 OK");
            client.println("Content-Type: application/json");
            client.println("Access-Control-Allow-Origin: *");
            client.println();
            client.print(getCurrentStateJson());
        } 
        else if (request.indexOf("POST /api/cmd") != -1) {
            // Read body
            while(client.available() && client.read() != '\n'); // skip headers
            String body = client.readString();
            handleCommand(body);
            
            client.println("HTTP/1.1 200 OK");
            client.println("Access-Control-Allow-Origin: *");
            client.println();
            client.print("{\"status\":\"ok\"}");
        }
        else {
            client.println("HTTP/1.1 404 Not Found");
            client.println();
        }
        delay(1);
        client.stop();
    }
}

void broadcastLocalState() {
    // In this zero-dependency version, we don't push via WS. 
    // The mobile app will poll /api/state or we can implement UDP broadcast.
}

#endif
