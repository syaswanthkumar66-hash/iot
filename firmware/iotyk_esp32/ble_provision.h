#ifndef IOTYK_BLE_PROVISION_H
#define IOTYK_BLE_PROVISION_H

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <Preferences.h>
#include "config.h"
#include "mbedtls/base64.h"
#include <ArduinoJson.h>

extern Preferences prefs;
extern void startWiFi();
extern String getBleName();

// LED state (defined in main ino)
enum LedState : uint8_t { LED_OFF, LED_FAST_BLINK, LED_SLOW_BLINK };
extern volatile LedState ledState;

BLEServer* pServer = NULL;
BLECharacteristic* pCharWiFi = NULL;
BLECharacteristic* pCharToken = NULL;
bool deviceConnected = false;
bool provisionComplete = false;

// Helpers to base64 decode
String decodeBase64(String input) {
  size_t olen = 0;
  mbedtls_base64_decode(NULL, 0, &olen, (const unsigned char*)input.c_str(), input.length());
  if (olen == 0) return "";
  
  unsigned char* buffer = (unsigned char*)malloc(olen + 1);
  mbedtls_base64_decode(buffer, olen, &olen, (const unsigned char*)input.c_str(), input.length());
  buffer[olen] = '\0';
  String result = String((char*)buffer);
  free(buffer);
  return result;
}

class ServerCallbacks: public BLEServerCallbacks {
    void onConnect(BLEServer* pServer) {
      deviceConnected = true;
      ledState = LED_FAST_BLINK;  // STATE 2: Fast blink on BLE connect
      Serial.println("BLE Client Connected - LED FAST BLINK");
    }
    void onDisconnect(BLEServer* pServer) {
      deviceConnected = false;
      Serial.println("BLE Client Disconnected");
      
      // STATE 1: LED OFF if provisioning not complete
      if (!provisionComplete) {
        ledState = LED_OFF;
        Serial.println("Provisioning incomplete - LED OFF");
      }
      
      // Restart advertising if we are not provisioned yet
      if (!provisionComplete) {
         pServer->startAdvertising(); 
      }
    }
};

class WiFiCallbacks: public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic *pCharacteristic) {
      String value = String(pCharacteristic->getValue().c_str());
      if (value.length() > 0) {
        String decoded = decodeBase64(value);
        int commaIndex = decoded.indexOf(',');
        if (commaIndex > 0) {
          String ssid = decoded.substring(0, commaIndex);
          String pass = decoded.substring(commaIndex + 1);
          
          Serial.println("Received WiFi Credentials via BLE");
          prefs.putString(KEY_WIFI_SSID, ssid);
          prefs.putString(KEY_WIFI_PASS, pass);
          
          provisionComplete = true;
          // Disconnect BLE and start WiFi
          pServer->disconnect(pServer->getConnId());
          delay(500);
          startWiFi();  // startWiFi() will set LED_FAST_BLINK
        }
      }
    }
};

class TokenCallbacks: public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic *pCharacteristic) {
      String value = String(pCharacteristic->getValue().c_str());
      if (value.length() > 0) {
        Serial.println("Received Secure Payload via BLE");
        String decoded = decodeBase64(value);
        if (decoded.length() > 0) {
          value = decoded;
        }
        
        StaticJsonDocument<512> doc;
        DeserializationError error = deserializeJson(doc, value);
        
        if (!error) {
          String token = doc["token"];
          String mqttUser = doc["mqtt"]["u"];
          String mqttPass = doc["mqtt"]["p"];
          
          if (token != "" && mqttUser != "" && mqttPass != "") {
            // Store everything in NVS
            prefs.putString(KEY_LOCAL_TOKEN, token);
            prefs.putString(KEY_TEMP_USER, mqttUser);
            prefs.putString(KEY_TEMP_PASS, mqttPass);
            
            Serial.println("Token and initial MQTT credentials saved.");
            
            // Acknowledge back to app
            pCharacteristic->setValue("ACK");
            pCharacteristic->notify();
            // Do NOT touch ledState - WiFiCallbacks handles it
          }
        } else {
          Serial.println("Failed to parse secure payload JSON");
        }
      }
    }
};

void startBLEProvisioning(String deviceId) {
  Serial.println("Starting BLE Provisioning...");
  String bleName = getBleName();
  
  BLEDevice::init(bleName.c_str());
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());

  BLEService *pService = pServer->createService(BLE_SERVICE_UUID);

  // WiFi Credential Characteristic
  pCharWiFi = pService->createCharacteristic(
                      BLE_WIFI_CHAR_UUID,
                      BLECharacteristic::PROPERTY_WRITE
                    );
  pCharWiFi->setCallbacks(new WiFiCallbacks());

  // Pairing Token Characteristic
  pCharToken = pService->createCharacteristic(
                      BLE_TOKEN_CHAR_UUID,
                      BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_NOTIFY
                    );
  pCharToken->addDescriptor(new BLE2902());
  pCharToken->setCallbacks(new TokenCallbacks());

  pService->start();

  BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(BLE_SERVICE_UUID);
  pAdvertising->setName(bleName.c_str());
  pAdvertising->setScanResponse(true);
  pAdvertising->setMinPreferred(0x06);  
  pAdvertising->setMinPreferred(0x12);
  
  BLEDevice::startAdvertising();
  Serial.println("BLE Advertising started. Name: " + bleName);
}

void stopBLE() {
  if (pServer) {
    pServer->getAdvertising()->stop();
    BLEDevice::deinit(true);
    pServer = NULL;
    Serial.println("BLE Stopped.");
  }
}

#endif