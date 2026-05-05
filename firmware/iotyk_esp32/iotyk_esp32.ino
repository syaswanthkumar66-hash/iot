#include <WiFi.h>
#include <Preferences.h>
#include <nvs_flash.h>
#include <esp_task_wdt.h>
#include "config.h"
#include "mqtt_manager.h"
#include "ble_provision.h"
#include "local_server.h"
#include "TinyJson.h"

#define WDT_TIMEOUT_SECONDS 8
#define FREQ_IDLE 80
#define FREQ_BOOST 240
#define BOOST_DURATION_MS 5000

Preferences prefs;
volatile LedState ledState = LED_OFF;

String sessionToken   = "";
bool   serialAuthed   = false;
unsigned long lastActivityTime = 0;
bool isBoosted = false;

void boostCPU() {
    if (!isBoosted) {
        setCpuFrequencyMhz(FREQ_BOOST);
        isBoosted = true;
    }
    lastActivityTime = millis();
}

void checkPowerScaling() {
    if (isBoosted && (millis() - lastActivityTime > BOOST_DURATION_MS)) {
        setCpuFrequencyMhz(FREQ_IDLE);
        isBoosted = false;
    }
}

void generateSessionToken() {
  uint8_t buf[6];
  esp_fill_random(buf, sizeof(buf));
  sessionToken = "";
  for (int i = 0; i < 6; i++) {
    if (buf[i] < 0x10) sessionToken += "0";
    sessionToken += String(buf[i], HEX);
  }
  sessionToken.toUpperCase();
}

void startWiFi();
void stopAll();
String getBleName();
String getDeviceMac();

void handleCommand(String cmdJson) {
  boostCPU();
  int relayIndex = TinyJson::getInt(cmdJson, "relay");
  bool state = TinyJson::getBool(cmdJson, "state");

  if (relayIndex >= 0 && relayIndex < RELAY_COUNT) {
    digitalWrite(RELAY_PINS[relayIndex], RELAY_ACTIVE_LOW ? !state : state);
    publishState(getCurrentStateJson());
  }
}

String getCurrentStateJson() {
  bool states[RELAY_COUNT];
  for (int i = 0; i < RELAY_COUNT; i++) {
    bool raw = digitalRead(RELAY_PINS[i]);
    states[i] = RELAY_ACTIVE_LOW ? !raw : raw;
  }
  return TinyJson::createState(prefs.getString(KEY_DEVICE_ID, FACTORY_DEVICE_ID), RELAY_COUNT, states);
}

void onMqttFullyConnected()  { ledState = LED_SLOW_BLINK; }
void onMqttDisconnected()    { if (WiFi.status() == WL_CONNECTED) ledState = LED_FAST_BLINK; }

String getBleName() {
  String mac = getDeviceMac();
  return "IoTYK-" + mac.substring(mac.length() - 4);
}
String getDeviceMac() { return WiFi.macAddress(); }

void startWiFi() {
  String ssid = prefs.getString(KEY_WIFI_SSID, "");
  String pass = prefs.getString(KEY_WIFI_PASS, "");
  if (ssid == "") return;
  
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.begin(ssid.c_str(), pass.c_str());
  ledState = LED_FAST_BLINK;
}

String serialBuffer = "";

void handleSerialCommand(String line) {
  boostCPU();
  line.trim();
  if (line.startsWith("AUTH:")) {
    String provided = line.substring(5);
    provided.trim(); provided.toUpperCase();
    if (provided == sessionToken) {
      serialAuthed = true;
      Serial.println("AUTH:OK");
    } else {
      serialAuthed = false;
      Serial.println("AUTH:FAIL");
    }
    return;
  }

  if (line.startsWith("CMD:")) {
    if (!serialAuthed) { Serial.println("AUTH:REQUIRED"); return; }

    if (line.startsWith("CMD:PROVISION|")) {
      String payload = line.substring(14);
      String parts[6];
      int partIdx = 0, idx = 0;
      for (int i = 0; i <= (int)payload.length() && partIdx < 6; i++) {
        if (i == (int)payload.length() || payload[i] == '|') {
          parts[partIdx++] = payload.substring(idx, i);
          idx = i + 1;
        }
      }
      if (partIdx < 5) return;
      
      prefs.putString(KEY_DEVICE_ID,   parts[0]);
      prefs.putString(KEY_DEVICE_NS,   parts[1]);
      prefs.putString(KEY_PERM_USER,   parts[2]);
      prefs.putString(KEY_PERM_PASS,   parts[3]);
      prefs.putString(KEY_LOCAL_TOKEN, parts[4]);

      Serial.println("[OK] Saved. Restarting...");
      delay(500); ESP.restart();
    }
    else if (line == "CMD:FACTORY_RESET") { nvs_flash_erase(); nvs_flash_init(); ESP.restart(); }
    else if (line == "CMD:CLEAR_NVS") { prefs.clear(); ESP.restart(); }
    else if (line == "CMD:STATUS") {
       Serial.println("--- STATUS ---");
       Serial.println("ID: " + prefs.getString(KEY_DEVICE_ID, "Unset"));
       Serial.println("Temp: " + String(temperatureRead(), 1) + " C");
       Serial.println("WiFi: " + String(WiFi.status() == WL_CONNECTED ? "OK" : "NO"));
    }
  }
}

void setup() {
  setCpuFrequencyMhz(FREQ_IDLE);
  Serial.begin(115200);
  delay(100);
  
  // FIXED: Compatibility for ESP32 Core v3.x.x
  #if ESP_ARDUINO_VERSION_MAJOR >= 3
    esp_task_wdt_config_t wdt_config = {
        .timeout_ms = WDT_TIMEOUT_SECONDS * 1000,
        .idle_core_mask = 0,
        .trigger_panic = true
    };
    esp_task_wdt_init(&wdt_config);
    esp_task_wdt_add(NULL);
  #else
    esp_task_wdt_init(WDT_TIMEOUT_SECONDS, true);
    esp_task_wdt_add(NULL);
  #endif

  generateSessionToken();
  Serial.println("\n[INIT] IoTYK Professional Firmware v1.8");

  for (int i = 0; i < RELAY_COUNT; i++) {
    pinMode(RELAY_PINS[i], OUTPUT);
    digitalWrite(RELAY_PINS[i], RELAY_ACTIVE_LOW ? HIGH : LOW);
  }
  pinMode(LED_PIN, OUTPUT);

  prefs.begin(NVS_NAMESPACE, false);
  
  if (prefs.getString(KEY_DEVICE_ID, "") == "" && String(FACTORY_DEVICE_ID) != "") {
      prefs.putString(KEY_DEVICE_ID, FACTORY_DEVICE_ID);
      prefs.putString(KEY_DEVICE_NS, FACTORY_DEVICE_NS);
      prefs.putString(KEY_PERM_USER, FACTORY_PERM_MQTT_USER);
      prefs.putString(KEY_PERM_PASS, FACTORY_PERM_MQTT_PASS);
      prefs.putString(KEY_LOCAL_TOKEN, FACTORY_LOCAL_TOKEN);
  }

  String devId = prefs.getString(KEY_DEVICE_ID, "Unknown");
  startBLE(devId);
  startWiFi();
  setupMqtt();
  setupLocalServer(devId);
}

void loop() {
  esp_task_wdt_reset();
  checkPowerScaling();

  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (serialBuffer.length() > 0) { handleSerialCommand(serialBuffer); serialBuffer = ""; }
    } else { serialBuffer += c; }
  }

  loopMqtt();
  loopLocalServer();

  static unsigned long lastBlink = 0;
  int interval = (ledState == LED_FAST_BLINK) ? 200 : (ledState == LED_SLOW_BLINK ? 1000 : 0);
  if (interval > 0 && millis() - lastBlink > interval) {
    digitalWrite(LED_PIN, !digitalRead(LED_PIN));
    lastBlink = millis();
  }
  delay(1); 
}