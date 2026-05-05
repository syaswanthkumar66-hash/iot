#include <WiFi.h>
#include <Preferences.h>
#include <nvs_flash.h>
#include "config.h"
#include "mqtt_manager.h"
#include "ble_provision.h"
#include "local_server.h"

Preferences prefs;
volatile LedState ledState = LED_OFF;

// ─── Session Token Auth ───────────────────────────────────────────────────
// A fresh random token is generated every boot.
// The factory dashboard must send AUTH:<token> before any CMD: is accepted.
// This prevents unauthorised serial clients from sending destructive commands.

String sessionToken   = "";
bool   serialAuthed   = false;

void generateSessionToken() {
  // 12 hex chars from random bytes
  uint8_t buf[6];
  esp_fill_random(buf, sizeof(buf));
  sessionToken = "";
  for (int i = 0; i < 6; i++) {
    if (buf[i] < 0x10) sessionToken += "0";
    sessionToken += String(buf[i], HEX);
  }
  sessionToken.toUpperCase();
}

// Forward declarations
void startWiFi();
void stopAll();
String getBleName();
String getDeviceMac();

// ─── Application Logic ────────────────────────────────────────────────────

void handleCommand(String cmdJson) {
  StaticJsonDocument<256> doc;
  DeserializationError error = deserializeJson(doc, cmdJson);
  if (error) return;

  if (doc.containsKey("relay")) {
    int relayIndex = doc["relay"];
    bool state = doc["state"];
    if (relayIndex >= 0 && relayIndex < RELAY_COUNT) {
      digitalWrite(RELAY_PINS[relayIndex], RELAY_ACTIVE_LOW ? !state : state);
      broadcastLocalState();
      publishState(getCurrentStateJson());
    }
  }
}

String getCurrentStateJson() {
  StaticJsonDocument<256> doc;
  doc["id"] = prefs.getString(KEY_DEVICE_ID, FACTORY_DEVICE_ID);
  JsonArray relays = doc.createNestedArray("relays");
  for (int i = 0; i < RELAY_COUNT; i++) {
    bool state = digitalRead(RELAY_PINS[i]);
    relays.add(RELAY_ACTIVE_LOW ? !state : state);
  }
  String out;
  serializeJson(doc, out);
  return out;
}

// ─── Status Callbacks ─────────────────────────────────────────────────────

void onMqttFullyConnected()  { ledState = LED_SLOW_BLINK; }
void onMqttDisconnected()    { if (WiFi.status() == WL_CONNECTED) ledState = LED_FAST_BLINK; }

// ─── Network Helpers ──────────────────────────────────────────────────────

String getBleName() {
  String mac = getDeviceMac();
  return "IoTYK-" + mac.substring(mac.length() - 4);
}
String getDeviceMac() { return WiFi.macAddress(); }

void startWiFi() {
  String ssid = prefs.getString(KEY_WIFI_SSID, "");
  String pass = prefs.getString(KEY_WIFI_PASS, "");
  if (ssid == "") { Serial.println("[WiFi] No credentials saved."); return; }
  Serial.println("[WiFi] Connecting to: " + ssid);
  WiFi.begin(ssid.c_str(), pass.c_str());
  ledState = LED_FAST_BLINK;
}

// ─── Stop All ─────────────────────────────────────────────────────────────
void stopAll() {
  Serial.println("[CMD] Stopping all connections...");
  mqttPerm.disconnect();
  mqttTemp.disconnect();
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
  stopBLE();
  ledState = LED_OFF;
  digitalWrite(LED_PIN, LOW);
  Serial.println("[CMD] All connections stopped. Device is offline.");
}

// ─────────────────────────────────────────────────────────────────────────
// SERIAL PROTOCOL
// ─────────────────────────────────────────────────────────────────────────
//
//  STEP 1 — On boot ESP32 prints:
//    [READY] IoTYK ESP32 ready for factory serial session
//    [AUTH]  Session token: XXXXXXXXXXXX
//
//  STEP 2 — Dashboard sends:
//    AUTH:XXXXXXXXXXXX
//
//  STEP 3 — ESP32 replies:
//    AUTH:OK   (all CMD: commands now accepted)
//    AUTH:FAIL (token wrong, session still locked)
//
//  COMMANDS (only accepted after AUTH:OK):
//
//    CMD:PROVISION|<device_id>|<namespace>|<mqtt_user>|<mqtt_pass>|<local_token>
//      → Saves credentials to NVS then restarts.
//
//    CMD:FACTORY_RESET
//      → Clears ALL NVS data and restarts.
//
//    CMD:CLEAR_NVS
//      → Clears IoTYK NVS namespace only, then restarts.
//
//    CMD:STOP_ALL
//      → Disconnects WiFi, MQTT, and BLE completely.
//
//    CMD:STATUS
//      → Prints device info and connection status.
//
//    CMD:REAUTH
//      → Revokes current session, generates new token, requires re-auth.
//
// ─────────────────────────────────────────────────────────────────────────

String serialBuffer = "";

void handleSerialCommand(String line) {
  line.trim();

  // ── AUTH handshake (always available — no auth guard) ──────────────────
  if (line.startsWith("AUTH:")) {
    String provided = line.substring(5);
    provided.trim();
    provided.toUpperCase();

    if (provided == sessionToken) {
      serialAuthed = true;
      Serial.println("AUTH:OK");
      Serial.println("[AUTH] Session authenticated. Commands unlocked.");
    } else {
      serialAuthed = false;
      Serial.println("AUTH:FAIL");
      Serial.println("[AUTH] Invalid token. Session remains locked.");
    }
    return;
  }

  // ── All CMD: require auth ──────────────────────────────────────────────
  if (line.startsWith("CMD:")) {
    if (!serialAuthed) {
      Serial.println("AUTH:REQUIRED");
      Serial.println("[AUTH] Not authenticated. Send AUTH:<token> first.");
      return;
    }

    // ── CMD:PROVISION ────────────────────────────────────────────────────
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
      if (partIdx < 5) {
        Serial.println("[ERROR] PROVISION: Expected 5 fields.");
        return;
      }
      Serial.println("[PROVISION] Saving credentials to NVS...");
      Serial.println("  Device ID:   " + parts[0]);
      Serial.println("  Namespace:   " + parts[1]);
      Serial.println("  MQTT User:   " + parts[2]);
      Serial.println("  Local Token: " + parts[4]);

      prefs.putString(KEY_DEVICE_ID,   parts[0]);
      prefs.putString(KEY_DEVICE_NS,   parts[1]);
      prefs.putString(KEY_PERM_USER,   parts[2]);
      prefs.putString(KEY_PERM_PASS,   parts[3]);
      prefs.putString(KEY_LOCAL_TOKEN, parts[4]);

      Serial.println("[OK] Credentials saved. Restarting...");
      delay(500);
      ESP.restart();
      return;
    }

    // ── CMD:FACTORY_RESET ─────────────────────────────────────────────────
    if (line == "CMD:FACTORY_RESET") {
      Serial.println("[CMD] FACTORY RESET — Erasing all NVS...");
      nvs_flash_erase();
      nvs_flash_init();
      delay(500);
      ESP.restart();
      return;
    }

    // ── CMD:CLEAR_NVS ─────────────────────────────────────────────────────
    if (line == "CMD:CLEAR_NVS") {
      Serial.println("[CMD] Clearing IoTYK NVS namespace...");
      prefs.clear();
      Serial.println("[OK] NVS cleared. Restarting...");
      delay(500);
      ESP.restart();
      return;
    }

    // ── CMD:STOP_ALL ──────────────────────────────────────────────────────
    if (line == "CMD:STOP_ALL") {
      stopAll();
      return;
    }

    // ── CMD:STATUS ────────────────────────────────────────────────────────
    if (line == "CMD:STATUS") {
      Serial.println("[STATUS] ---- Device Info ----");
      Serial.println("  Device ID : " + prefs.getString(KEY_DEVICE_ID, "(not set)"));
      Serial.println("  Namespace : " + prefs.getString(KEY_DEVICE_NS,  "(not set)"));
      Serial.println("  MQTT User : " + prefs.getString(KEY_PERM_USER,  "(not set)"));
      Serial.println("  WiFi SSID : " + prefs.getString(KEY_WIFI_SSID,  "(not set)"));
      Serial.println("  WiFi      : " + String(WiFi.status() == WL_CONNECTED
                       ? "Connected (" + WiFi.localIP().toString() + ")"
                       : "Disconnected"));
      Serial.println("  MQTT Perm : " + String(mqttPerm.connected() ? "Connected" : "Disconnected"));
      Serial.println("  MQTT Temp : " + String(mqttTemp.connected() ? "Connected" : "Disconnected"));
      Serial.println("  Session   : Authenticated");
      Serial.println("[STATUS] --------------------");
      return;
    }

    // ── CMD:REAUTH ────────────────────────────────────────────────────────
    if (line == "CMD:REAUTH") {
      serialAuthed = false;
      generateSessionToken();
      Serial.println("[AUTH] Session revoked. New session started.");
      Serial.println("[AUTH] Session token: " + sessionToken);
      return;
    }

    Serial.println("[Serial] Unknown command: " + line);
    return;
  }

  // Anything else — just echo it back (useful for ping/debug)
  if (line.length() > 0) {
    Serial.println("[Serial] Unknown: " + line + " (send AUTH:<token> first if locked)");
  }
}

void processSerial() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (serialBuffer.length() > 0) {
        handleSerialCommand(serialBuffer);
        serialBuffer = "";
      }
    } else {
      if (serialBuffer.length() < 512) serialBuffer += c; // guard against overflow
    }
  }
}

// ─── Setup & Loop ─────────────────────────────────────────────────────────

void setup() {
  Serial.begin(115200);
  delay(200);

  // Generate a fresh random session token for this boot
  generateSessionToken();

  Serial.println("");
  Serial.println("╔══════════════════════════════════════╗");
  Serial.println("║   IoTYK ESP32 Factory Serial v1.3   ║");
  Serial.println("╚══════════════════════════════════════╝");
  Serial.println("[READY] IoTYK ESP32 ready for factory serial session");
  Serial.println("[AUTH]  Session token: " + sessionToken);
  Serial.println("[AUTH]  Send AUTH:<token> to unlock commands");
  Serial.println("");

  // Init Hardware
  pinMode(LED_PIN, OUTPUT);
  for (int i = 0; i < RELAY_COUNT; i++) {
    pinMode(RELAY_PINS[i], OUTPUT);
    digitalWrite(RELAY_PINS[i], RELAY_ACTIVE_LOW ? HIGH : LOW);
  }

  // Init NVS
  prefs.begin(NVS_NAMESPACE, false);

  // Load factory identity from config.h on first flash
  if (prefs.getString(KEY_DEVICE_ID, "") == "" && String(FACTORY_DEVICE_ID) != "") {
    Serial.println("[Init] Applying factory identity from config.h...");
    prefs.putString(KEY_DEVICE_ID,   FACTORY_DEVICE_ID);
    prefs.putString(KEY_DEVICE_NS,   FACTORY_DEVICE_NS);
    prefs.putString(KEY_PERM_USER,   FACTORY_PERM_MQTT_USER);
    prefs.putString(KEY_PERM_PASS,   FACTORY_PERM_MQTT_PASS);
    prefs.putString(KEY_LOCAL_TOKEN, FACTORY_LOCAL_TOKEN);
  }

  String deviceId = prefs.getString(KEY_DEVICE_ID, "Unknown");
  Serial.println("[Init] Device ID: " + deviceId);
  Serial.println("[Init] Namespace: " + prefs.getString(KEY_DEVICE_NS, "(none)"));

  startBLEProvisioning(deviceId);
  startWiFi();
  setupMqtt();
  setupLocalServer(deviceId);

  Serial.println("[Init] System ready.");
}

void loop() {
  processSerial();

  // LED blink
  static unsigned long lastBlink = 0;
  int interval = 0;
  if      (ledState == LED_FAST_BLINK) interval = 200;
  else if (ledState == LED_SLOW_BLINK) interval = 1000;

  if (interval > 0) {
    if (millis() - lastBlink > interval) {
      digitalWrite(LED_PIN, !digitalRead(LED_PIN));
      lastBlink = millis();
    }
  } else {
    digitalWrite(LED_PIN, LOW);
  }

  // WiFi watchdog
  static unsigned long lastWiFiCheck = 0;
  if (millis() - lastWiFiCheck > 10000) {
    if (WiFi.status() != WL_CONNECTED && ledState == LED_SLOW_BLINK) {
      ledState = LED_FAST_BLINK;
    }
    lastWiFiCheck = millis();
  }

  loopMqtt();
  loopLocalServer();
}