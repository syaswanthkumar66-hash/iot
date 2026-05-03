#include <WiFi.h>
#include <Preferences.h>
#include <BLEDevice.h>
#include "config.h"
#include "ble_provision.h"
#include "mqtt_manager.h"
#include "certificates.h"
#include "local_server.h"

// --- LED State Machine ---
enum LedState : uint8_t { LED_OFF, LED_FAST_BLINK, LED_SLOW_BLINK };
volatile LedState ledState = LED_OFF;

// --- Global Variables ---
Preferences prefs;
bool wifiConnected = false;
unsigned long lastWifiCheck = 0;

// --- Function Declarations ---
void startWiFi();
void applyLED();
void onMqttFullyConnected();
void onMqttDisconnected();
String getBleName();

// --- LED Control ---
void applyLED() {
  static unsigned long lastToggle = 0;
  static bool ledLevel = false;
  unsigned long interval = 0;

  switch (ledState) {
    case LED_FAST_BLINK:
      interval = 200;
      break;
    case LED_SLOW_BLINK:
      interval = 1000;
      break;
    case LED_OFF:
    default:
      digitalWrite(LED_PIN, LOW);
      return;
  }

  if (millis() - lastToggle >= interval) {
    ledLevel = !ledLevel;
    digitalWrite(LED_PIN, ledLevel ? HIGH : LOW);
    lastToggle = millis();
  }
}

// --- MQTT Callbacks ---
void onMqttFullyConnected() {
  ledState = LED_SLOW_BLINK;
  Serial.println("Both MQTT connected - SLOW BLINK");
}

void onMqttDisconnected() {
  ledState = LED_FAST_BLINK;
  Serial.println("MQTT disconnected - FAST BLINK");
}

// --- WiFi ---
void startWiFi() {
  ledState = LED_FAST_BLINK;
  String ssid = prefs.getString(KEY_WIFI_SSID, "");
  String pass = prefs.getString(KEY_WIFI_PASS, "");

  if (ssid == "") {
    Serial.println("No WiFi credentials. Starting BLE provisioning...");
    startBLEProvisioning(prefs.getString(KEY_DEVICE_ID, ""));
    return;
  }

  Serial.print("Connecting to WiFi: ");
  Serial.println(ssid);
  WiFi.begin(ssid.c_str(), pass.c_str());

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 40) {
    applyLED(); // Update LED during blocking wait
    delay(250);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    wifiConnected = true;
    Serial.println("\nWiFi connected! IP: " + WiFi.localIP().toString());
    stopBLE();
    setupMqtt();
    setupLocalServer(prefs.getString(KEY_DEVICE_ID, ""));
  } else {
    Serial.println("\nWiFi connection failed. Starting BLE...");
    wifiConnected = false;
    startBLEProvisioning(prefs.getString(KEY_DEVICE_ID, ""));
  }
}

// --- BLE Name Helper ---
String getBleName() {
  return "IoTYK-" + prefs.getString(KEY_DEVICE_ID, "UNKNOWN");
}

// --- Setup ---
void setup() {
  Serial.begin(115200);
  delay(100);

  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);
  ledState = LED_OFF;

  // Initialize NVS
  prefs.begin(NVS_NAMESPACE, false);

  // Seed NVS with factory values if first boot
  if (prefs.getString(KEY_DEVICE_ID, "") == "") {
    Serial.println("First boot - seeding NVS with factory values...");
    prefs.putString(KEY_DEVICE_ID, FACTORY_DEVICE_ID);
    if (prefs.getString(KEY_PERM_PASS, "") == "" && String(FACTORY_PERM_MQTT_PASS) != "") {
      prefs.putString(KEY_PERM_USER, FACTORY_PERM_MQTT_USER);
      prefs.putString(KEY_PERM_PASS, FACTORY_PERM_MQTT_PASS);
    }
    if (prefs.getString(KEY_LOCAL_TOKEN, "") == "" && String(FACTORY_LOCAL_TOKEN) != "") {
      prefs.putString(KEY_LOCAL_TOKEN, FACTORY_LOCAL_TOKEN);
    }
    Serial.println("NVS seeded successfully.");
  }

  Serial.println("Device ID: " + prefs.getString(KEY_DEVICE_ID, ""));
  Serial.println("Namespace: " + prefs.getString(KEY_DEVICE_NS, ""));

  // Check if WiFi credentials exist
  if (prefs.getString(KEY_WIFI_SSID, "") != "") {
    startWiFi();
  } else {
    ledState = LED_OFF;
    startBLEProvisioning(prefs.getString(KEY_DEVICE_ID, ""));
  }
}

// --- Main Loop ---
void loop() {
  // Apply LED state FIRST
  applyLED();

  // Handle WiFi reconnection
  if (WiFi.status() != WL_CONNECTED) {
    if (wifiConnected) {
      wifiConnected = false;
      Serial.println("WiFi disconnected!");
      ledState = LED_FAST_BLINK;
    }
    // If no WiFi and not provisioned, mirror BLE connection state
    if (!wifiConnected && prefs.getString(KEY_WIFI_SSID, "") == "") {
      if (deviceConnected) {
        ledState = LED_FAST_BLINK;
      } else {
        ledState = LED_OFF;
      }
    }
  } else {
    if (!wifiConnected) {
      wifiConnected = true;
      Serial.println("WiFi reconnected!");
    }
    // Run MQTT loop
    loopMqtt();
    // Run Local Server loop
    loopLocalServer();
  }

  // Handle commands, state updates, etc.
  delay(10);
}

// --- Command Handler (called from mqtt_manager) ---
void handleCommand(String cmdJson) {
  Serial.println("Command received: " + cmdJson);
  // Parse and handle relay commands, etc.
  // After state change:
  // publishState(getCurrentStateJson());
}

// --- State JSON (called from mqtt_manager) ---
String getCurrentStateJson() {
  StaticJsonDocument<200> doc;
  doc["online"] = true;
  doc["wifi"] = wifiConnected;
  doc["mqtt_perm"] = mqttPerm.connected();
  doc["mqtt_temp"] = mqttTemp.connected();
  String output;
  serializeJson(doc, output);
  return output;
}