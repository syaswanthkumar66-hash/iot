#ifndef TINY_WSS_H
#define TINY_WSS_H

#include <WiFiClientSecure.h>
#include <mbedtls/sha1.h>
#include <mbedtls/base64.h>

class TinyWss {
private:
    WiFiServerSecure _server;
    
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
    TinyWss(int port) : _server(port) {}

    void begin(const char* cert, const char* key) {
        _server.setCertificate(cert);
        _server.setPrivateKey(key);
        _server.begin();
    }

    void handle(void (*onMessage)(String)) {
        WiFiClientSecure client = _server.available();
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

            if (handshake.indexOf("Upgrade: websocket") != -1) {
                int keyStart = handshake.indexOf("Sec-WebSocket-Key: ") + 19;
                int keyEnd = handshake.indexOf("\r", keyStart);
                if (keyStart > 18 && keyEnd > keyStart) {
                    String clientKey = handshake.substring(keyStart, keyEnd);
                    clientKey.trim();
                    String acceptKey = calculateAcceptKey(clientKey);

                    client.println("HTTP/1.1 101 Switching Protocols");
                    client.println("Upgrade: websocket");
                    client.println("Connection: Upgrade");
                    client.println("Sec-WebSocket-Accept: " + acceptKey);
                    client.println();

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

#endif
