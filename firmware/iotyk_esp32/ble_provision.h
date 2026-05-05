#ifndef BLE_PROVISION_H
#define BLE_PROVISION_H

#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEServer.h>
#include <Preferences.h>

#define SERVICE_UUID        "12345678-1234-1234-1234-123456789abc"
#define CHARACTERISTIC_UUID "abcdefab-1234-1234-1234-abcdefabcdef"

extern Preferences prefs;
bool bleConnected = false;

class MyServerCallbacks: public BLEServerCallbacks {
    void onConnect(BLEServer* pServer) {
      bleConnected = true;
      Serial.println("[BLE] Phone Connected");
    }
    void onDisconnect(BLEServer* pServer) {
      bleConnected = false;
      Serial.println("[BLE] Phone Disconnected. Restarting Advertising...");
      BLEDevice::startAdvertising();
    }
};

class MyCallbacks: public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic *pCharacteristic) {
      String value = pCharacteristic->getValue().c_str();
      if (value.length() > 0) {
        Serial.println("[BLE] Received WiFi Data");
        // Expecting: "SSID,PASSWORD"
        int comma = value.indexOf(',');
        if (comma != -1) {
            String s = value.substring(0, comma);
            String p = value.substring(comma + 1);
            prefs.putString("wifi_ssid", s);
            prefs.putString("wifi_pass", p);
            Serial.println("[BLE] Settings Saved. Restarting...");
            delay(1000);
            ESP.restart();
        }
      }
    }
};

void setupBLE(const char* deviceId) {
  BLEDevice::init(deviceId);
  BLEServer *pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());

  BLEService *pService = pServer->createService(SERVICE_UUID);
  BLECharacteristic *pCharacteristic = pService->createCharacteristic(
                                         CHARACTERISTIC_UUID,
                                         BLECharacteristic::PROPERTY_WRITE
                                       );

  pCharacteristic->setCallbacks(new MyCallbacks());
  pService->start();

  BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  pAdvertising->setMinPreferred(0x06);  
  pAdvertising->setMinPreferred(0x12);
  BLEDevice::startAdvertising();
  Serial.println("[BLE] Advertising as: " + String(deviceId));
}

#endif
