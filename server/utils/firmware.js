const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { generateSelfSignedCert, pemToHexArray } = require('./certificates');

/**
 * Generate complete ESP32 firmware project (NO HTTP - WSS ONLY)
 * Returns: path to ZIP file
 */
async function generateESP32Firmware(deviceId, namespace, config) {
  try {
    const tempDir = path.join(__dirname, '..', '.temp-firmware', deviceId);
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
    fs.mkdirSync(tempDir, { recursive: true });

    const { cert, key } = generateSelfSignedCert(deviceId + '.local');
    const certHex = pemToHexArray(cert, 'server_cert');
    const keyHex = pemToHexArray(key, 'server_key');

    fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'include'), { recursive: true });

    createConfigHeader(tempDir, config);
    createCertificatesHeader(tempDir, certHex, keyHex);
    createMainSketch(tempDir, deviceId, namespace);
    createBLEProvisioning(tempDir);
    createMQTTManager(tempDir);
    createLocalServerWSS(tempDir);
    createPlatformIOIni(tempDir);
    createArduinoJSON(tempDir);

    const zipPath = await createZipFile(tempDir, deviceId);
    fs.rmSync(tempDir, { recursive: true });

    return zipPath;
  } catch (err) {
    console.error('Firmware generation error:', err);
    throw err;
  }
}

function createConfigHeader(tempDir, config) {
  const content = `#ifndef IOTYK_CONFIG_H
#define IOTYK_CONFIG_H

// ===== DEVICE IDENTIFIERS =====
#define LED_PIN 2
#define RELAY_COUNT ${config.relay_count || 1}
#define RELAY_ACTIVE_LOW true

// Relay GPIO pins (starting from pin 26)
static const uint8_t RELAY_PINS[RELAY_COUNT] = {${generateRelayPins(config.relay_count || 1)}};

// ===== BLE PROVISIONING =====
#define BLE_SERVICE_UUID "12345678-1234-1234-1234-123456789abc"
#define BLE_WIFI_CHAR_UUID "abcd1234-5678-1234-5678-abcdef123456"
#define BLE_TOKEN_CHAR_UUID "abcd1234-5678-1234-5678-abcdef123457"

// ===== MQTT BROKER =====
#define MQTT_BROKER "${config.mqtt_broker}"
#define MQTT_PORT 8883
#define MQTT_KEEP_ALIVE 60

// ===== FACTORY CREDENTIALS =====
#define FACTORY_DEVICE_ID "${config.device_id}"
#define FACTORY_DEVICE_NS "${config.namespace}"
#define FACTORY_PERM_MQTT_USER "${config.perm_mqtt_user}"
#define FACTORY_PERM_MQTT_PASS "${config.perm_mqtt_pass}"

// ===== LOCAL NETWORK (WebSocket Secure only - NO HTTP) =====
#define LOCAL_WSS_PORT 82
#define LOCAL_WSS_ENABLED true

// ===== FIRMWARE =====
#define FIRMWARE_VERSION "1.1.0"

// ===== NVS STORAGE KEYS =====
#define NVS_NAMESPACE "iotyk"
#define KEY_WIFI_SSID "w_ssid"
#define KEY_WIFI_PASS "w_pass"
#define KEY_DEVICE_ID "d_id"
#define KEY_DEVICE_NS "d_ns"
#define KEY_PERM_USER "m_p_usr"
#define KEY_PERM_PASS "m_p_pwd"
#define KEY_TEMP_USER "m_t_usr"
#define KEY_TEMP_PASS "m_t_pwd"
#define KEY_LOCAL_TOKEN "l_tok"

#endif
`;
  fs.writeFileSync(path.join(tempDir, 'include', 'config.h'), content);
}

function generateRelayPins(count) {
  const pins = [];
  for (let i = 0; i < count; i++) {
    pins.push(26 + i);
  }
  return pins.join(', ');
}

function createCertificatesHeader(tempDir, certHex, keyHex) {
  const content = `#ifndef IOTYK_CERTIFICATES_H
#define IOTYK_CERTIFICATES_H

// ===== WSS CERTIFICATES (Auto-generated) =====
// Self-signed certificate for WebSocket Secure (port 82)

${certHex}

${keyHex}

#endif
`;
  fs.writeFileSync(path.join(tempDir, 'include', 'certificates.h'), content);
}

function createMainSketch(tempDir, deviceId, namespace) {
  const content = `#include <Arduino.h>
#include <WiFi.h>
#include <WebSocketsServer.h>
#include <ArduinoJson.h>
#include <MQTT.h>
#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEServer.h>
#include <ESPmDNS.h>
#include <Preferences.h>

#include "config.h"
#include "certificates.h"
#include "ble_provision.h"
#include "mqtt_manager.h"
#include "local_server_wss.h"

// Global instances
Preferences nvs;
WiFiClient wifiClient;
MQTTClient mqttPerm(256);
MQTTClient mqttTemp(256);
WebSocketsServer webSocket(LOCAL_WSS_PORT);

// ===== SETUP =====
void setup() {
  Serial.begin(115200);
  delay(100);
  
  Serial.println("\\n\\n=== IoTYK ESP32 Firmware v" FIRMWARE_VERSION " ===");
  Serial.printf("Device ID: %s\\n", FACTORY_DEVICE_ID);
  Serial.printf("Namespace: %s\\n", FACTORY_DEVICE_NS);
  Serial.println("🔒 WebSocket Secure (WSS) only - NO HTTP");
  
  nvs.begin(NVS_NAMESPACE);
  setupRelays();
  
  Serial.println("Starting BLE provisioning...");
  setupBLE();
  
  Serial.println("Connecting to WiFi...");
  connectWiFi();
  
  if (WiFi.status() == WL_CONNECTED) {
    if (!MDNS.begin(FACTORY_DEVICE_ID)) {
      Serial.println("mDNS failed to start");
    } else {
      Serial.printf("mDNS started: %s.local\\n", FACTORY_DEVICE_ID);
    }
    
    Serial.println("Setting up MQTT...");
    setupMQTTPermanent();
    setupMQTTTemporary();
    
    Serial.println("Setting up WebSocket Secure server...");
    setupWebSocketSecure();
    
    publishStatus();
  }
}

// ===== MAIN LOOP =====
void loop() {
  if (WiFi.status() == WL_CONNECTED) {
    if (!mqttPerm.connected()) {
      Serial.println("Reconnecting MQTT Permanent...");
      mqttPerm.connect(FACTORY_DEVICE_ID, 
                       FACTORY_PERM_MQTT_USER, 
                       FACTORY_PERM_MQTT_PASS);
    }
    
    if (!mqttTemp.connected()) {
      String tempUser = nvs.getString(KEY_TEMP_USER);
      String tempPass = nvs.getString(KEY_TEMP_PASS);
      
      if (tempUser.length() > 0 && tempPass.length() > 0) {
        Serial.println("Reconnecting MQTT Temporary...");
        mqttTemp.connect(FACTORY_DEVICE_ID, tempUser.c_str(), tempPass.c_str());
      }
    }
  }
  
  mqttPerm.loop();
  mqttTemp.loop();
  webSocket.loop();
  
  delay(10);
}

// ===== HELPER FUNCTIONS =====
void setupRelays() {
  for (int i = 0; i < RELAY_COUNT; i++) {
    pinMode(RELAY_PINS[i], OUTPUT);
    digitalWrite(RELAY_PINS[i], RELAY_ACTIVE_LOW ? HIGH : LOW);
  }
  Serial.printf("✅ Relay pins configured: %d relays\\n", RELAY_COUNT);
}

void connectWiFi() {
  String ssid = nvs.getString(KEY_WIFI_SSID);
  String pass = nvs.getString(KEY_WIFI_PASS);
  
  if (ssid.length() == 0) {
    Serial.println("No WiFi credentials stored. Waiting for BLE provisioning...");
    return;
  }
  
  Serial.printf("Connecting to WiFi: %s\\n", ssid.c_str());
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid.c_str(), pass.c_str());
  
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\\n✅ WiFi Connected! IP: %s\\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("\\n❌ WiFi connection failed");
  }
}

void publishStatus() {
  char topic[100];
  char payload[256];
  
  sprintf(topic, "device/%s/status", FACTORY_DEVICE_NS);
  sprintf(payload, "{\\"online\\":true,\\"ts\\":%lld,\\"fw\\":\\"%s\\"}",
    millis(), FIRMWARE_VERSION);
  
  if (mqttPerm.publish(topic, payload)) {
    Serial.printf("📤 Status published\\n");
  }
}

void publishState() {
  char topic[100];
  char payload[256];
  
  sprintf(topic, "device/%s/state", FACTORY_DEVICE_NS);
  
  String relayStates = "[";
  for (int i = 0; i < RELAY_COUNT; i++) {
    int state = digitalRead(RELAY_PINS[i]);
    bool isOn = RELAY_ACTIVE_LOW ? (state == LOW) : (state == HIGH);
    relayStates += isOn ? "\\"on\\"" : "\\"off\\"";
    if (i < RELAY_COUNT - 1) relayStates += ",";
  }
  relayStates += "]";
  
  sprintf(payload, "{\\"relays\\":%s,\\"wifi\\":%s,\\"rssi\\":%d,\\"fw\\":\\"%s\\"}",
    relayStates.c_str(),
    WiFi.status() == WL_CONNECTED ? "true" : "false",
    WiFi.RSSI(),
    FIRMWARE_VERSION);
  
  if (mqttTemp.publish(topic, payload)) {
    Serial.printf("📤 State published\\n");
  }
}

void setRelay(int relayId, bool state) {
  if (relayId < 1 || relayId > RELAY_COUNT) {
    Serial.printf("Invalid relay ID: %d\\n", relayId);
    return;
  }
  
  int pin = RELAY_PINS[relayId - 1];
  int gpioState = RELAY_ACTIVE_LOW ? (state ? LOW : HIGH) : (state ? HIGH : LOW);
  
  digitalWrite(pin, gpioState);
  Serial.printf("Relay %d: %s\\n", relayId, state ? "ON" : "OFF");
  
  publishState();
}

void setAllRelays(bool state) {
  for (int i = 1; i <= RELAY_COUNT; i++) {
    setRelay(i, state);
  }
}
`;
  fs.writeFileSync(path.join(tempDir, 'src', 'main.cpp'), content);
}

function createBLEProvisioning(tempDir) {
  const content = `#ifndef IOTYK_BLE_PROVISION_H
#define IOTYK_BLE_PROVISION_H

#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEServer.h>
#include "config.h"

extern Preferences nvs;

class WiFiCharacteristicCallback : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *pCharacteristic) {
    String value = pCharacteristic->getValue().c_str();
    Serial.printf("📡 WiFi data received\\n");
    
    int commaIdx = value.indexOf(',');
    if (commaIdx == -1) {
      Serial.println("Invalid WiFi format");
      return;
    }
    
    String ssid = value.substring(0, commaIdx);
    String pass = value.substring(commaIdx + 1);
    
    Serial.printf("SSID: %s\\n", ssid.c_str());
    nvs.putString(KEY_WIFI_SSID, ssid);
    nvs.putString(KEY_WIFI_PASS, pass);
    
    Serial.println("✅ WiFi credentials saved. Restarting...");
    delay(1000);
    ESP.restart();
  }
};

class TokenCharacteristicCallback : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *pCharacteristic) {
    String value = pCharacteristic->getValue().c_str();
    Serial.printf("📡 Token data received\\n");
    
    DynamicJsonDocument doc(512);
    if (deserializeJson(doc, value) != DeserializationError::Ok) {
      Serial.println("Invalid JSON");
      return;
    }
    
    String localToken = doc["token"];
    String tempUser = doc["mqtt"]["u"];
    String tempPass = doc["mqtt"]["p"];
    
    nvs.putString(KEY_LOCAL_TOKEN, localToken);
    nvs.putString(KEY_TEMP_USER, tempUser);
    nvs.putString(KEY_TEMP_PASS, tempPass);
    
    Serial.println("✅ Token and MQTT credentials saved");
  }
};

void setupBLE() {
  BLEDevice::init(FACTORY_DEVICE_ID);
  BLEServer *pServer = BLEDevice::createServer();
  BLEService *pService = pServer->createService(BLE_SERVICE_UUID);
  
  BLECharacteristic *pWifiChar = pService->createCharacteristic(
    BLE_WIFI_CHAR_UUID,
    BLECharacteristic::PROPERTY_WRITE
  );
  pWifiChar->setCallbacks(new WiFiCharacteristicCallback());
  
  BLECharacteristic *pTokenChar = pService->createCharacteristic(
    BLE_TOKEN_CHAR_UUID,
    BLECharacteristic::PROPERTY_WRITE
  );
  pTokenChar->setCallbacks(new TokenCharacteristicCallback());
  
  pService->start();
  
  BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(BLE_SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  pAdvertising->setMinPreferred(0x06);
  pAdvertising->setMaxPreferred(0x12);
  BLEDevice::startAdvertising();
  
  Serial.println("✅ BLE Provisioning started");
}

#endif
`;
  fs.writeFileSync(path.join(tempDir, 'include', 'ble_provision.h'), content);
}

function createMQTTManager(tempDir) {
  const content = `#ifndef IOTYK_MQTT_MANAGER_H
#define IOTYK_MQTT_MANAGER_H

#include <MQTT.h>
#include "config.h"

extern MQTTClient mqttPerm;
extern MQTTClient mqttTemp;
extern Preferences nvs;

void setRelay(int relayId, bool state);
void setAllRelays(bool state);
void publishState();

void onMessagePerm(String &topic, String &payload) {
  Serial.printf("📥 MQTT Perm: %s\\n", topic.c_str());
  
  if (topic.endsWith("/sys/rotate")) {
    DynamicJsonDocument doc(512);
    if (deserializeJson(doc, payload) == DeserializationError::Ok) {
      String newUser = doc["username"];
      String newPass = doc["password"];
      
      nvs.putString(KEY_TEMP_USER, newUser);
      nvs.putString(KEY_TEMP_PASS, newPass);
      
      Serial.println("✅ Credentials rotated");
    }
  }
  else if (topic.endsWith("/sys/reset")) {
    Serial.println("🔄 Factory reset command received");
    nvs.clear();
    delay(1000);
    ESP.restart();
  }
}

void onMessageTemp(String &topic, String &payload) {
  Serial.printf("📥 MQTT Temp: %s\\n", topic.c_str());
  
  DynamicJsonDocument doc(512);
  if (deserializeJson(doc, payload) != DeserializationError::Ok) {
    return;
  }
  
  if (doc.containsKey("power")) {
    bool state = (doc["power"] == "on");
    setAllRelays(state);
  }
  else if (doc.containsKey("relay")) {
    int relayId = doc["relay"];
    bool state = (doc["power"] == "on");
    setRelay(relayId, state);
  }
  else if (doc.containsKey("relays")) {
    JsonArray relays = doc["relays"];
    for (JsonObject relay : relays) {
      int relayId = relay["id"];
      bool state = (relay["power"] == "on");
      setRelay(relayId, state);
    }
  }
  else if (doc.containsKey("wifi")) {
    String newSSID = doc["wifi"]["ssid"];
    String newPass = doc["wifi"]["password"];
    
    nvs.putString(KEY_WIFI_SSID, newSSID);
    nvs.putString(KEY_WIFI_PASS, newPass);
    
    Serial.println("WiFi updated. Restarting...");
    delay(1000);
    ESP.restart();
  }
  
  publishState();
}

void setupMQTTPermanent() {
  mqttPerm.onMessage(onMessagePerm);
  mqttPerm.setServer(MQTT_BROKER, MQTT_PORT);
  
  if (mqttPerm.connect(FACTORY_DEVICE_ID, FACTORY_PERM_MQTT_USER, FACTORY_PERM_MQTT_PASS)) {
    Serial.println("✅ MQTT Permanent connected");
    
    char topic[100];
    sprintf(topic, "device/%s/sys/+", FACTORY_DEVICE_NS);
    mqttPerm.subscribe(topic);
  } else {
    Serial.println("❌ MQTT Permanent failed");
  }
}

void setupMQTTTemporary() {
  String tempUser = nvs.getString(KEY_TEMP_USER);
  String tempPass = nvs.getString(KEY_TEMP_PASS);
  
  if (tempUser.length() == 0 || tempPass.length() == 0) {
    Serial.println("No temp credentials. Waiting for BLE...");
    return;
  }
  
  mqttTemp.onMessage(onMessageTemp);
  mqttTemp.setServer(MQTT_BROKER, MQTT_PORT);
  
  if (mqttTemp.connect(FACTORY_DEVICE_ID, tempUser.c_str(), tempPass.c_str())) {
    Serial.println("✅ MQTT Temporary connected");
    
    char topic[100];
    sprintf(topic, "device/%s/cmd", FACTORY_DEVICE_NS);
    mqttTemp.subscribe(topic);
  } else {
    Serial.println("❌ MQTT Temporary failed");
  }
}

#endif
`;
  fs.writeFileSync(path.join(tempDir, 'include', 'mqtt_manager.h'), content);
}

function createLocalServerWSS(tempDir) {
  const content = `#ifndef IOTYK_LOCAL_SERVER_WSS_H
#define IOTYK_LOCAL_SERVER_WSS_H

#include <WebSocketsServer.h>
#include "config.h"
#include "certificates.h"

extern WebSocketsServer webSocket;
extern Preferences nvs;

String getStateJSON();
void setRelay(int relayId, bool state);
void setAllRelays(bool state);

// WebSocket Secure Server (port 82, TLS encrypted)
void setupWebSocketSecure() {
  webSocket.onEvent([](uint8_t num, WStype_t type, uint8_t * payload, size_t length) {
    if (type == WStype_CONNECTED) {
      Serial.printf("🔒 WSS client %u connected\\n", num);
    }
    else if (type == WStype_DISCONNECT) {
      Serial.printf("⚠️  WSS client %u disconnected\\n", num);
    }
    else if (type == WStype_TEXT) {
      String message = String((char*)payload).substring(0, length);
      Serial.printf("📥 WSS message\\n");
      
      DynamicJsonDocument doc(512);
      if (deserializeJson(doc, message) == DeserializationError::Ok) {
        String token = doc["token"];
        String storedToken = nvs.getString(KEY_LOCAL_TOKEN);
        
        if (token != storedToken) {
          webSocket.sendTXT(num, "{\\"error\\":\\"Invalid token\\"}");
          return;
        }
        
        if (doc.containsKey("cmd")) {
          JsonObject cmd = doc["cmd"];
          
          if (cmd.containsKey("power")) {
            bool state = (cmd["power"] == "on");
            setAllRelays(state);
          }
          else if (cmd.containsKey("relay")) {
            int relayId = cmd["relay"];
            bool state = (cmd["power"] == "on");
            setRelay(relayId, state);
          }
          else if (cmd.containsKey("relays")) {
            JsonArray relays = cmd["relays"];
            for (JsonObject relay : relays) {
              int relayId = relay["id"];
              bool state = (relay["power"] == "on");
              setRelay(relayId, state);
            }
          }
        }
        
        webSocket.sendTXT(num, getStateJSON());
      }
    }
  });
  
  webSocket.begin();
  Serial.printf("✅ WebSocket Secure (WSS) started on port %d\\n", LOCAL_WSS_PORT);
  Serial.printf("   Access via: wss://%s.local:%d\\n", FACTORY_DEVICE_ID, LOCAL_WSS_PORT);
}

String getStateJSON() {
  String relayStates = "[";
  for (int i = 0; i < RELAY_COUNT; i++) {
    int state = digitalRead(RELAY_PINS[i]);
    bool isOn = RELAY_ACTIVE_LOW ? (state == LOW) : (state == HIGH);
    relayStates += isOn ? "\\"on\\"" : "\\"off\\"";
    if (i < RELAY_COUNT - 1) relayStates += ",";
  }
  relayStates += "]";
  
  String response = "{\\"relays\\":" + relayStates + ",\\"wifi\\":";
  response += WiFi.status() == WL_CONNECTED ? "true" : "false";
  response += ",\\"rssi\\":" + String(WiFi.RSSI());
  response += ",\\"fw\\":\\"" FIRMWARE_VERSION "\\"}";
  
  return response;
}

#endif
`;
  fs.writeFileSync(path.join(tempDir, 'include', 'local_server_wss.h'), content);
}

function createPlatformIOIni(tempDir) {
  const content = `[platformio]
default_envs = esp32-wroom-32
src_dir = src

[env:esp32-wroom-32]
platform = espressif32@^6.0.0
board = esp32doit-devkit1
framework = arduino
monitor_speed = 115200

lib_deps =
    WiFi
    WebSocketsServer
    ArduinoJson
    PubSubClient
    BLE Arduino
    ESPmDNS
    
build_flags =
    -DCORE_DEBUG_LEVEL=3
    -DARDUINO_LOOP_STACK_SIZE=8192

upload_speed = 921600
`;
  fs.writeFileSync(path.join(tempDir, 'platformio.ini'), content);
}

function createArduinoJSON(tempDir) {
  const content = `{
  "name": "IoTYK ESP32 Firmware",
  "version": "1.1.0",
  "description": "ESP32 firmware for IoTYK - WSS only (no HTTP)",
  "keywords": ["esp32", "iot", "mqtt", "ble", "relay", "wss"],
  "license": "MIT"
}
`;
  fs.writeFileSync(path.join(tempDir, 'library.json'), content);
}

function createZipFile(sourceDir, deviceId) {
  return new Promise((resolve, reject) => {
    const outputPath = path.join(__dirname, '..', 'downloads');
    if (!fs.existsSync(outputPath)) {
      fs.mkdirSync(outputPath, { recursive: true });
    }

    const zipFileName = `${deviceId}_firmware.zip`;
    const zipPath = path.join(outputPath, zipFileName);

    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      resolve(zipPath);
    });

    archive.on('error', (err) => {
      reject(err);
    });

    archive.pipe(output);
    archive.directory(sourceDir + '/', false);
    archive.finalize();
  });
}

module.exports = {
  generateESP32Firmware,
};
