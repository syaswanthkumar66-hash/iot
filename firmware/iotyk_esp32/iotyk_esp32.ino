#include <WiFi.h>
#include <Preferences.h>
#include "config.h"
#include "mqtt_manager.h"
#include "ble_provision.h"
#include "local_server.h"

Preferences prefs;
volatile LedState ledState = LED_OFF;

// Forward declarations
void startWiFi();
String getBleName();
String getDeviceMac();

// --- Application Logic ---

void handleCommand(String cmdJson) {
  StaticJsonDocument<256> doc;
  DeserializationError error = deserializeJson(doc, cmdJson);
  if (error) return;

  if (doc.containsKey("relay")) {
    int relayIndex = doc["relay"];
    bool state = doc["state"];
    if (relayIndex >= 0 && relayIndex < RELAY_COUNT) {
      digitalWrite(RELAY_PINS[relayIndex], RELAY_ACTIVE_LOW ? !state : state);
      // Broadcast state update
      broadcastLocalState();
      publishState(getCurrentStateJson());
    }
  }
}

String getCurrentStateJson() {
  StaticJsonDocument<256> doc;
  doc["id"] = FACTORY_DEVICE_ID;
  JsonArray relays = doc.createNestedArray("relays");
  for (int i = 0; i < RELAY_COUNT; i++) {
    bool state = digitalRead(RELAY_PINS[i]);
    relays.add(RELAY_ACTIVE_LOW ? !state : state);
  }
  String out;
  serializeJson(doc, out);
  return out;
}

// --- Status Callbacks ---

void onMqttFullyConnected() {
  ledState = LED_SLOW_BLINK;
}

void onMqttDisconnected() {
  if (WiFi.status() == WL_CONNECTED) {
    ledState = LED_FAST_BLINK;
  }
}

// --- Network Helpers ---

String getBleName() {
  String mac = getDeviceMac();
  return "IoTYK-" + mac.substring(mac.length() - 4);
}

String getDeviceMac() {
  return WiFi.macAddress();
}

void startWiFi() {
  String ssid = prefs.getString(KEY_WIFI_SSID, "");
  String pass = prefs.getString(KEY_WIFI_PASS, "");

  if (ssid == "") {
    Serial.println("No WiFi credentials. Staying in BLE mode.");
    return;
  }

  Serial.println("Connecting to WiFi: " + ssid);
  WiFi.begin(ssid.c_str(), pass.c_str());
  ledState = LED_FAST_BLINK;
}

// --- Setup & Loop ---

void setup() {
  Serial.begin(115200);
  Serial.println("\n--- IoTYK ESP32 Starting ---");

  // Init Hardware
  pinMode(LED_PIN, OUTPUT);
  for (int i = 0; i < RELAY_COUNT; i++) {
    pinMode(RELAY_PINS[i], OUTPUT);
    digitalWrite(RELAY_PINS[i], RELAY_ACTIVE_LOW ? HIGH : LOW); // Start OFF
  }

  // Init NVS
  prefs.begin(NVS_NAMESPACE, false);

  // Check if we need to load factory values (first boot or after factory reset)
  if (prefs.getString(KEY_DEVICE_ID, "") == "" && String(FACTORY_DEVICE_ID) != "") {
    Serial.println("Applying Factory Identity...");
    prefs.putString(KEY_DEVICE_ID, FACTORY_DEVICE_ID);
    prefs.putString(KEY_DEVICE_NS, FACTORY_DEVICE_NS);
    prefs.putString(KEY_PERM_USER, FACTORY_PERM_MQTT_USER);
    prefs.putString(KEY_PERM_PASS, FACTORY_PERM_MQTT_PASS);
    prefs.putString(KEY_LOCAL_TOKEN, FACTORY_LOCAL_TOKEN);
  }

  String deviceId = prefs.getString(KEY_DEVICE_ID, "Unknown");
  Serial.println("Device ID: " + deviceId);

  // Start BLE for provisioning
  startBLEProvisioning(deviceId);

  // Start WiFi
  startWiFi();

  // Setup MQTT
  setupMqtt();

  // Setup Local Server (WSS)
  setupLocalServer(deviceId);
}

void loop() {
  // LED Logic
  static unsigned long lastBlink = 0;
  int interval = 0;
  if (ledState == LED_FAST_BLINK) interval = 200;
  else if (ledState == LED_SLOW_BLINK) interval = 1000;

  if (interval > 0) {
    if (millis() - lastBlink > interval) {
      digitalWrite(LED_PIN, !digitalRead(LED_PIN));
      lastBlink = millis();
    }
  } else {
    digitalWrite(LED_PIN, LOW);
  }

  // WiFi Connection Watchdog
  static unsigned long lastWiFiCheck = 0;
  if (millis() - lastWiFiCheck > 10000) {
    if (WiFi.status() == WL_CONNECTED) {
      if (ledState == LED_OFF) ledState = LED_FAST_BLINK;
    } else {
      // If we were slow blinking (fully connected) but lost WiFi
      if (ledState == LED_SLOW_BLINK) ledState = LED_FAST_BLINK;
    }
    lastWiFiCheck = millis();
  }

  // Sub-systems
  loopMqtt();
  loopLocalServer();
}