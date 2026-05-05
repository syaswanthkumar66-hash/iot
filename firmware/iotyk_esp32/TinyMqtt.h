#ifndef TINY_MQTT_H
#define TINY_MQTT_H

#include <WiFiClientSecure.h>

class TinyMqtt {
private:
    WiFiClientSecure* _client;
    String _host;
    uint16_t _port;
    String _clientId;
    String _user;
    String _pass;
    uint16_t _keepAlive = 60;
    uint32_t _lastPing = 0;
    void (*_onMsg)(String, String) = NULL;

    void sendBuffer(uint8_t* buf, size_t len) {
        if (_client && _client->connected()) _client->write(buf, len);
    }

    // Helper to read variable length int from MQTT stream
    uint32_t readRemainingLength() {
        uint32_t multiplier = 1;
        uint32_t value = 0;
        uint8_t encodedByte;
        do {
            encodedByte = _client->read();
            value += (encodedByte & 127) * multiplier;
            multiplier *= 128;
            if (multiplier > 128 * 128 * 128) return 0;
        } while ((encodedByte & 128) != 0);
        return value;
    }

public:
    TinyMqtt(WiFiClientSecure& client) : _client(&client) {}

    void setServer(String host, uint16_t port) { _host = host; _port = port; }
    void setCredentials(String id, String user, String pass) { _clientId = id; _user = user; _pass = pass; }
    void setCallback(void (*cb)(String, String)) { _onMsg = cb; }

    bool connect() {
        if (!_client->connect(_host.c_str(), _port)) return false;

        uint8_t pkt[128];
        int ptr = 0;
        pkt[ptr++] = 0x10; // Connect
        int lenPos = ptr++; // Placeholder for length
        
        // Protocol Name
        pkt[ptr++] = 0x00; pkt[ptr++] = 0x04; pkt[ptr++] = 'M'; pkt[ptr++] = 'Q'; pkt[ptr++] = 'T'; pkt[ptr++] = 'T';
        pkt[ptr++] = 0x04; // v3.1.1
        
        uint8_t flags = 0x02; // Clean session
        if (_user.length()) flags |= 0x80;
        if (_pass.length()) flags |= 0x40;
        pkt[ptr++] = flags;

        pkt[ptr++] = (uint8_t)(_keepAlive >> 8); pkt[ptr++] = (uint8_t)(_keepAlive & 0xFF);

        auto addString = [&](String s) {
            pkt[ptr++] = (uint8_t)(s.length() >> 8); pkt[ptr++] = (uint8_t)(s.length() & 0xFF);
            memcpy(&pkt[ptr], s.c_str(), s.length());
            ptr += s.length();
        };

        addString(_clientId);
        if (_user.length()) addString(_user);
        if (_pass.length()) addString(_pass);

        pkt[lenPos] = (uint8_t)(ptr - 2);
        sendBuffer(pkt, ptr);
        _lastPing = millis();
        return true;
    }

    bool connected() { return _client && _client->connected(); }

    void publish(String topic, String payload) {
        if (!connected()) return;
        uint8_t pkt[512]; // Large enough for state JSON
        int ptr = 0;
        pkt[ptr++] = 0x30; // Publish
        
        int totalLen = 2 + topic.length() + payload.length();
        pkt[ptr++] = (uint8_t)totalLen; // Simplified for < 127
        
        pkt[ptr++] = (uint8_t)(topic.length() >> 8); pkt[ptr++] = (uint8_t)(topic.length() & 0xFF);
        memcpy(&pkt[ptr], topic.c_str(), topic.length()); ptr += topic.length();
        memcpy(&pkt[ptr], payload.c_str(), payload.length()); ptr += payload.length();
        
        sendBuffer(pkt, ptr);
    }

    void subscribe(String topic) {
        if (!connected()) return;
        uint8_t pkt[64];
        int ptr = 0;
        pkt[ptr++] = 0x82; // Subscribe
        pkt[ptr++] = (uint8_t)(2 + 2 + topic.length() + 1);
        pkt[ptr++] = 0x00; pkt[ptr++] = 0x01; // Packet ID
        pkt[ptr++] = (uint8_t)(topic.length() >> 8); pkt[ptr++] = (uint8_t)(topic.length() & 0xFF);
        memcpy(&pkt[ptr], topic.c_str(), topic.length()); ptr += topic.length();
        pkt[ptr++] = 0x00; // QoS 0
        sendBuffer(pkt, ptr);
    }

    void loop() {
        if (!connected()) return;
        if (millis() - _lastPing > (_keepAlive * 500)) {
            uint8_t ping[] = {0xC0, 0x00};
            sendBuffer(ping, 2);
            _lastPing = millis();
        }

        if (_client->available()) {
            uint8_t type = _client->read();
            uint32_t len = readRemainingLength();
            
            if ((type & 0xF0) == 0x30) { // Incoming Publish
                uint16_t topicLen = (_client->read() << 8) | _client->read();
                String topic = "";
                for(int i=0; i<topicLen; i++) topic += (char)_client->read();
                
                uint32_t payloadLen = len - 2 - topicLen;
                String payload = "";
                for(uint32_t i=0; i<payloadLen; i++) payload += (char)_client->read();
                
                if (_onMsg) _onMsg(topic, payload);
            } else {
                // Consume other packets (CONNACK, SUBACK, etc.)
                for(uint32_t i=0; i<len; i++) _client->read();
            }
        }
    }
};

#endif
