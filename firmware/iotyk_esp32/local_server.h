#ifndef LOCAL_SERVER_H
#define LOCAL_SERVER_H

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <Update.h>

// Smart Header Detection
#if __has_include(<WiFiServerSecure.h>)
  #include <WiFiServerSecure.h>
  typedef WiFiServerSecure WssServerType;
#elif __has_include(<NetworkServer.h>)
  #include <NetworkServer.h>
  typedef WiFiServer WssServerType;
#else
  typedef WiFiServer WssServerType;
#endif

#include <mbedtls/sha1.h>
#include <mbedtls/base64.h>
#include "certificates.h"
#include "TinyJson.h"

extern Preferences prefs;

class TinyWssEngine {
private:
    WssServerType _server;
    
    String calculateAcceptKey(String clientKey) {
        String combined = clientKey + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
        uint8_t shaResult[20];
        mbedtls_sha1_context ctx;
        mbedtls_sha1_init(&ctx);
        mbedtls_sha1_starts(&ctx);
        mbedtls_sha1_update(&ctx, (const unsigned char*)combined.c_str(), combined.length());
        mbedtls_sha1_finish(&ctx, shaResult);
        mbedtls_sha1_free(&ctx);
        size_t outLen;
        unsigned char base64Result[32];
        mbedtls_base64_encode(base64Result, 32, &outLen, shaResult, 20);
        return String((char*)base64Result);
    }

public:
    TinyWssEngine(int port) : _server(port) {}
    void begin(const char* cert, const char* key) {
        #if __has_include(<WiFiServerSecure.h>)
          _server.setCertificate(cert);
          _server.setPrivateKey(key);
        #endif
        _server.begin();
    }
    
    void handle(void (*onMessage)(String)) {
        auto client = _server.available();
        if (client) {
            String handshake = "";
            unsigned long timeout = millis();
            while (client.connected() && millis() - timeout < 2000) {
                if (client.available()) {
                    String line = client.readStringUntil('\n');
                    if (line == "\r") break;
                    handshake += line + "\n";
                }
            }

            // 1. Handle WiFi Setup Page (AP Mode)
            if (handshake.indexOf("GET / ") != -1 && WiFi.getMode() == WIFI_AP) {
                client.println("HTTP/1.1 200 OK\nContent-Type: text/html\n\n"
                               "<html><body style='font-family:sans-serif;padding:20px;'>"
                               "<h2>IoTYK WiFi Setup</h2>"
                               "<form method='POST' action='/save'>"
                               "SSID:<br><input name='s'><br>Password:<br><input name='p' type='password'><br><br>"
                               "<input type='submit' value='Save & Connect'>"
                               "</form></body></html>");
                client.stop(); return;
            }

            // 2. Handle Save WiFi
            if (handshake.indexOf("POST /save") != -1) {
                // Simple parsing for s=SSID&p=PASS
                // Note: In production, use more robust parsing.
                client.println("HTTP/1.1 200 OK\n\nSettings Saved. Rebooting...");
                client.stop();
                delay(2000);
                ESP.restart();
                return;
            }

            // 3. Handle Web OTA Page
            if (handshake.indexOf("GET /update") != -1) {
                client.println("HTTP/1.1 200 OK\nContent-Type: text/html\n\n"
                               "<html><body><h2>IoTYK Web Update</h2>"
                               "<form method='POST' action='/update' enctype='multipart/form-data'>"
                               "<input type='file' name='update'><input type='submit' value='Flash Firmware'>"
                               "</form></body></html>");
                client.stop(); return;
            }

            // 4. Handle WebSocket
            if (handshake.indexOf("Upgrade: websocket") != -1) {
                int keyStart = handshake.indexOf("Sec-WebSocket-Key: ") + 19;
                int keyEnd = handshake.indexOf("\r", keyStart);
                if (keyStart > 18 && keyEnd > keyStart) {
                    String clientKey = handshake.substring(keyStart, keyEnd);
                    clientKey.trim();
                    String acceptKey = calculateAcceptKey(clientKey);
                    client.println("HTTP/1.1 101 Switching Protocols\nUpgrade: websocket\nConnection: Upgrade\nSec-WebSocket-Accept: " + acceptKey + "\n");
                    while (client.connected()) {
                        if (client.available() >= 2) {
                            uint8_t header = client.read();
                            uint8_t lenByte = client.read();
                            bool masked = lenByte & 0x80;
                            uint64_t payloadLen = lenByte & 0x7F;
                            if (payloadLen == 126) payloadLen = (client.read() << 8) | client.read();
                            uint8_t mask[4];
                            if (masked) client.readBytes(mask, 4);
                            char* payload = (char*)malloc(payloadLen + 1);
                            if (payload) {
                                client.readBytes((uint8_t*)payload, payloadLen);
                                if (masked) for (uint64_t i = 0; i < payloadLen; i++) payload[i] ^= mask[i % 4];
                                payload[payloadLen] = '\0';
                                onMessage(String(payload));
                                free(payload);
                            }
                        }
                        delay(1);
                    }
                }
            }
            client.stop();
        }
    }
};

extern void handleCommand(String json);
TinyWssEngine localWss(82);

void onWssMessage(String msg) { handleCommand(msg); }
void setupLocalServer(String id) { localWss.begin(LOCAL_WSS_SERVER_CERT, LOCAL_WSS_PRIVATE_KEY); }
void loopLocalServer() { localWss.handle(onWssMessage); }

#endif
