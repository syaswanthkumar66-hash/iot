#ifndef BLE_PROVISION_H
#define BLE_PROVISION_H

#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEServer.h>
#include <Preferences.h>
#include "config.h"

#define SERVICE_UUID        BLE_SERVICE_UUID
#define CHARACTERISTIC_UUID BLE_WIFI_CHAR_UUID

extern Preferences prefs;
extern String currentSessionToken;
extern String getDeviceKey();

class MyServerCallbacks: public BLEServerCallbacks {
    void onConnect(BLEServer* pServer) { Serial.println("[BLE] App Connected"); }
    void onDisconnect(BLEServer* pServer) {
        Serial.println("[BLE] App Disconnected. Re-advertising...");
        BLEDevice::startAdvertising();
    }
};

class MyCallbacks: public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic *pCharacteristic) {
        String value = pCharacteristic->getValue().c_str();
        if (value.length() > 0) {
            Serial.println("[BLE] Data Received. Parsing...");
            
            // Expected format: WIFI_SSID|WIFI_PASS|MQTT_USER|MQTT_PASS|SESSION_TOKEN|AUTH_KEY
            // We use | as a separator for high speed and small code size
            int pos = 0;
            String parts[6];
            for (int i = 0; i < 6; i++) {
                int next = value.indexOf('|', pos);
                if (next == -1 && i < 5) break;
                parts[i] = (next == -1) ? value.substring(pos) : value.substring(pos, next);
                pos = next + 1;
            }

            // SECURITY: Validate the AUTH_KEY against the permanent DEVICE_KEY
            if (parts[5] != getDeviceKey()) {
                Serial.println("[BLE] REJECTED: Invalid Device Key");
                return;
            }

            // Save all credentials
            prefs.putString(KEY_WIFI_SSID, parts[0]);
            prefs.putString(KEY_WIFI_PASS, parts[1]);
            prefs.putString(KEY_TEMP_USER, parts[2]);
            prefs.putString(KEY_TEMP_PASS, parts[3]);
            prefs.putString(KEY_LOCAL_TOKEN, parts[4]);

            Serial.println("[BLE] Provisioning Successful! Rebooting...");
            delay(1000);
            ESP.restart();
        }
    }
};

void setupBLE(const char* deviceId) {
    BLEDevice::init(deviceId);
    BLEServer *pServer = BLEDevice::createServer();
    pServer->setCallbacks(new MyServerCallbacks());
    BLEService *pService = pServer->createService(SERVICE_UUID);
    BLECharacteristic *pChar = pService->createCharacteristic(CHARACTERISTIC_UUID, BLECharacteristic::PROPERTY_WRITE);
    pChar->setCallbacks(new MyCallbacks());
    pService->start();
    BLEAdvertising *pAdv = BLEDevice::getAdvertising();
    pAdv->addServiceUUID(SERVICE_UUID);
    pAdv->setScanResponse(true);
    BLEDevice::startAdvertising();
}

#endif
