#ifndef IOTYK_BLE_PROVISION_H
#define IOTYK_BLE_PROVISION_H

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <Preferences.h>
#include "config.h"
#include "TinyJson.h"

extern Preferences prefs;
extern void startWiFi();
extern String getBleName();

enum LedState : uint8_t { LED_OFF, LED_FAST_BLINK, LED_SLOW_BLINK };
extern volatile LedState ledState;

BLEServer* pServer = NULL;
BLECharacteristic* pWifiChar = NULL;
BLECharacteristic* pTokenChar = NULL;
bool deviceConnected = false;

class MyServerCallbacks: public BLEServerCallbacks {
    void onConnect(BLEServer* pServer) { deviceConnected = true; ledState = LED_FAST_BLINK; }
    void onDisconnect(BLEServer* pServer) { deviceConnected = false; BLEDevice::startAdvertising(); }
};

class WifiCallbacks: public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic *pCharacteristic) {
        String value = pCharacteristic->getValue().c_str();
        if (value.length() > 0) {
            // Simple comma split: ssid,pass
            int comma = value.indexOf(',');
            if (comma != -1) {
                String ssid = value.substring(0, comma);
                String pass = value.substring(comma + 1);
                prefs.putString(KEY_WIFI_SSID, ssid);
                prefs.putString(KEY_WIFI_PASS, pass);
                Serial.println("[BLE] WiFi credentials received.");
                startWiFi();
            }
        }
    }
};

void startBLE(String deviceId) {
  BLEDevice::init(getBleName().c_str());
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());

  BLEService *pService = pServer->createService(BLE_SERVICE_UUID);

  pWifiChar = pService->createCharacteristic(
                 BLE_WIFI_CHAR_UUID,
                 BLECharacteristic::PROPERTY_WRITE
               );
  pWifiChar->setCallbacks(new WifiCallbacks());

  pTokenChar = pService->createCharacteristic(
                  BLE_TOKEN_CHAR_UUID,
                  BLECharacteristic::PROPERTY_READ
                );
  pTokenChar->setValue(prefs.getString(KEY_LOCAL_TOKEN, "").c_str());

  pService->start();
  BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(BLE_SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  BLEDevice::startAdvertising();
}

void stopBLE() {
    BLEDevice::deinit(true);
}

#endif