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

    void sendBuffer(const uint8_t* buf, size_t len) {
        if (_client && _client->connected()) _client->write(buf, len);
    }

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

        uint8_t pkt[512]; // Larger buffer for safety
        int ptr = 0;
        pkt[ptr++] = 0x10; // Connect
        
        // Protocol
        uint8_t proto[] = {0x00, 0x04, 'M', 'Q', 'T', 'T', 0x04};
        uint8_t flags = 0x02;
        if (_user.length()) flags |= 0x80;
        if (_pass.length()) flags |= 0x40;

        uint16_t payloadLen = 10 + (2 + _clientId.length());
        if (_user.length()) payloadLen += (2 + _user.length());
        if (_pass.length()) payloadLen += (2 + _pass.length());

        // Simple single-byte length for CONNECT (usually < 127)
        pkt[ptr++] = (uint8_t)payloadLen;
        memcpy(&pkt[ptr], proto, 7); ptr += 7;
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

        sendBuffer(pkt, ptr);
        _lastPing = millis();
        return true;
    }

    bool connected() { return _client && _client->connected(); }

    void publish(String topic, String payload) {
        if (!connected()) return;
        uint8_t pkt[1024]; 
        int ptr = 0;
        pkt[ptr++] = 0x30; // Publish
        
        uint16_t remain = 2 + topic.length() + payload.length();
        pkt[ptr++] = (uint8_t)remain; // Works for packets < 128 bytes
        
        pkt[ptr++] = (uint8_t)(topic.length() >> 8); pkt[ptr++] = (uint8_t)(topic.length() & 0xFF);
        memcpy(&pkt[ptr], topic.c_str(), topic.length()); ptr += topic.length();
        memcpy(&pkt[ptr], payload.c_str(), payload.length()); ptr += payload.length();
        
        sendBuffer(pkt, ptr);
    }

    void subscribe(String topic) {
        if (!connected()) return;
        uint8_t pkt[256];
        int ptr = 0;
        pkt[ptr++] = 0x82;
        pkt[ptr++] = (uint8_t)(2 + 2 + topic.length() + 1);
        pkt[ptr++] = 0x00; pkt[ptr++] = 0x01; // ID
        pkt[ptr++] = (uint8_t)(topic.length() >> 8); pkt[ptr++] = (uint8_t)(topic.length() & 0xFF);
        memcpy(&pkt[ptr], topic.c_str(), topic.length()); ptr += topic.length();
        pkt[ptr++] = 0x00; // QoS
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
            if ((type & 0xF0) == 0x30) {
                uint16_t tLen = (_client->read() << 8) | _client->read();
                String topic = "";
                for(int i=0; i<tLen; i++) topic += (char)_client->read();
                uint32_t pLen = len - 2 - tLen;
                String payload = "";
                for(uint32_t i=0; i<pLen; i++) payload += (char)_client->read();
                if (_onMsg) _onMsg(topic, payload);
            } else {
                for(uint32_t i=0; i<len; i++) _client->read();
            }
        }
    }
};

#endif
