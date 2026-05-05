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
    
    void sendPacket(uint8_t* buf, size_t len) {
        if (_client && _client->connected()) {
            _client->write(buf, len);
        }
    }

public:
    TinyMqtt(WiFiClientSecure& client) : _client(&client) {}

    void setServer(String host, uint16_t port) {
        _host = host;
        _port = port;
    }

    void setCredentials(String id, String user, String pass) {
        _clientId = id;
        _user = user;
        _pass = pass;
    }

    bool connect() {
        if (!_client->connect(_host.c_str(), _port)) return false;

        // Build MQTT Connect Packet (v3.1.1)
        uint8_t header[] = {0x10}; // Connect
        uint8_t protocol[] = {0x00, 0x04, 'M', 'Q', 'T', 'T', 0x04}; // v3.1.1
        uint8_t flags = 0x02; // Clean session
        if (_user.length()) flags |= 0x80;
        if (_pass.length()) flags |= 0x40;

        uint16_t payloadLen = 2 + _clientId.length();
        if (_user.length()) payloadLen += 2 + _user.length();
        if (_pass.length()) payloadLen += 2 + _pass.length();

        uint8_t remainLen = 10 + payloadLen;
        
        _client->write(header, 1);
        _client->write(&remainLen, 1);
        _client->write(protocol, 7);
        _client->write(&flags, 1);
        uint8_t ka[] = { (uint8_t)(_keepAlive >> 8), (uint8_t)(_keepAlive & 0xFF) };
        _client->write(ka, 2);

        // Payload
        auto writeString = [&](String s) {
            uint8_t len[] = { (uint8_t)(s.length() >> 8), (uint8_t)(s.length() & 0xFF) };
            _client->write(len, 2);
            _client->write(s.c_str(), s.length());
        };

        writeString(_clientId);
        if (_user.length()) writeString(_user);
        if (_pass.length()) writeString(_pass);

        _lastPing = millis();
        return true;
    }

    bool connected() {
        return _client && _client->connected();
    }

    void publish(String topic, String payload) {
        if (!connected()) return;
        
        uint8_t header = 0x30; // Publish QoS 0
        uint16_t remainLen = 2 + topic.length() + payload.length();
        
        _client->write(&header, 1);
        // Simplified remaining length (works for < 128 bytes)
        uint8_t rl = (uint8_t)remainLen;
        _client->write(&rl, 1);
        
        uint8_t tl[] = { (uint8_t)(topic.length() >> 8), (uint8_t)(topic.length() & 0xFF) };
        _client->write(tl, 2);
        _client->write(topic.c_str(), topic.length());
        _client->write(payload.c_str(), payload.length());
    }

    void subscribe(String topic) {
        if (!connected()) return;
        
        uint8_t header = 0x82; // Subscribe
        uint16_t packetId = 1;
        uint16_t remainLen = 2 + 2 + topic.length() + 1;
        
        _client->write(&header, 1);
        uint8_t rl = (uint8_t)remainLen;
        _client->write(&rl, 1);
        
        uint8_t pid[] = { (uint8_t)(packetId >> 8), (uint8_t)(packetId & 0xFF) };
        _client->write(pid, 2);
        
        uint8_t tl[] = { (uint8_t)(topic.length() >> 8), (uint8_t)(topic.length() & 0xFF) };
        _client->write(tl, 2);
        _client->write(topic.c_str(), topic.length());
        _client->write(0x00); // Requested QoS 0
    }

    void loop() {
        if (!connected()) return;
        
        if (millis() - _lastPing > (_keepAlive * 500)) {
            uint8_t ping[] = {0xC0, 0x00};
            _client->write(ping, 2);
            _lastPing = millis();
        }
        
        // Basic check for incoming data (simplistic for this demo)
        while (_client->available()) {
            uint8_t type = _client->read();
            // In a full implementation, we would parse PUBLISH packets here.
            // For now, we mainly rely on Local Server for commands.
        }
    }
};

#endif
