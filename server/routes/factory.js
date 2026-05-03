const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const db = require('../db');
const auth = require('../auth');
const { generateESP32Firmware } = require('../utils/firmware');

/**
 * POST /factory/register
 * Register a new device and generate config.h for ESP32
 */
router.post('/register', (req, res) => {
  try {
    const { email, password, relay_count = 1 } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    // Step 1: Create user
    const userId = 'user_' + Date.now();
    const passwordHash = auth.hashPassword(password);

    db.prepare(`
      INSERT INTO users (id, email, password_hash, created_at)
      VALUES (?, ?, ?, ?)
    `).run(userId, email, passwordHash, Date.now());

    // Step 2: Generate device identifiers
    const deviceId = auth.generateId('ESP32-', 6);
    const namespace = auth.generateNs();
    const permUser = auth.generateMqttUser(namespace);
    const permPass = auth.generateMqttPass();
    const tempUser = auth.generateTempUser(namespace);
    const tempPass = auth.generateTempPass();
    const localToken = auth.generateLocalToken();

    // Step 3: Store device in DB
    const relayStates = Array(parseInt(relay_count) || 1).fill('off');
    db.prepare(`
      INSERT INTO devices (
        id, user_id, namespace, perm_mqtt_user, perm_mqtt_pass,
        temp_mqtt_user, temp_mqtt_pass, local_token, relay_states, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      deviceId,
      userId,
      namespace,
      permUser,
      permPass,
      tempUser,
      tempPass,
      localToken,
      JSON.stringify(relayStates),
      Date.now()
    );

    // Step 4: Generate config.h content
    const configH = generateConfigH(
      deviceId,
      namespace,
      permUser,
      permPass,
      relay_count
    );

    // Step 5: Return registration response with firmware download link
    res.json({
      device_id: deviceId,
      namespace,
      config_h: configH,
      local_token: localToken,
      mqtt: {
        temp_user: tempUser,
        temp_pass: tempPass,
      },
      user: { id: userId, email },
      firmware_download: `/api/factory/generate-firmware/${deviceId}`,
      instructions: {
        step1: "Copy config.h content above to your ESP32 project",
        step2: "Or click firmware_download link to get complete package (includes WSS certificates)",
        step3: "Flash to ESP32 using Arduino IDE or PlatformIO"
      }
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

/**
 * Generate config.h content for ESP32 firmware
 */
function generateConfigH(deviceId, namespace, permUser, permPass, relayCount) {
  const relayPins = generateRelayPins(relayCount);

  return `#ifndef IOTYK_CONFIG_H
#define IOTYK_CONFIG_H

#define LED_PIN 2
#define RELAY_COUNT ${relayCount}
#define RELAY_ACTIVE_LOW true
static const uint8_t RELAY_PINS[RELAY_COUNT] = {${relayPins}};

#define BLE_SERVICE_UUID "12345678-1234-1234-1234-123456789abc"
#define BLE_WIFI_CHAR_UUID "abcd1234-5678-1234-5678-abcdef123456"
#define BLE_TOKEN_CHAR_UUID "abcd1234-5678-1234-5678-abcdef123457"

#define MQTT_BROKER "${process.env.EMQX_BROKER || 'mqtt.example.com'}"
#define MQTT_PORT 8883
#define MQTT_KEEP_ALIVE 60

#define FACTORY_DEVICE_ID "${deviceId}"
#define FACTORY_DEVICE_NS "${namespace}"
#define FACTORY_PERM_MQTT_USER "${permUser}"
#define FACTORY_PERM_MQTT_PASS "${permPass}"

#define LOCAL_HTTP_PORT 80
#define LOCAL_WS_PORT 81
#define LOCAL_WSS_PORT 82
#define LOCAL_WSS_ENABLED false

#define FIRMWARE_VERSION "1.1.0"

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
}

/**
 * Generate relay pin assignments (starting from pin 26)
 */
function generateRelayPins(count) {
  const pins = [];
  for (let i = 0; i < count; i++) {
    pins.push(26 + i);
  }
  return pins.join(', ');
}

/**
 * GET /factory/generate-firmware/:deviceId
 * Generate complete ESP32 firmware package with certificates
 * Returns ZIP file with all source files, config, and libraries
 */
router.get('/generate-firmware/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;

    // Get device from database
    const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId);
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    console.log(`📦 Generating firmware package for ${deviceId}...`);

    // Config for ESP32
    const config = {
      device_id: device.id,
      namespace: device.namespace,
      perm_mqtt_user: device.perm_mqtt_user,
      perm_mqtt_pass: device.perm_mqtt_pass,
      relay_count: JSON.parse(device.relay_states || '["off"]').length,
      mqtt_broker: process.env.EMQX_BROKER || 'mqtt.example.com',
    };

    // Generate firmware package
    const zipPath = await generateESP32Firmware(deviceId, device.namespace, config);

    if (!fs.existsSync(zipPath)) {
      return res.status(500).json({ error: 'Failed to generate firmware' });
    }

    // Send ZIP file
    console.log(`✅ Firmware package ready: ${zipPath}`);
    res.download(zipPath, `${deviceId}_firmware.zip`, (err) => {
      if (err) {
        console.error('Download error:', err);
      }
      // Cleanup after download
      setTimeout(() => {
        if (fs.existsSync(zipPath)) {
          fs.unlinkSync(zipPath);
          console.log(`🗑️  Cleaned up: ${zipPath}`);
        }
      }, 5000);
    });
  } catch (err) {
    console.error('Firmware generation error:', err);
    res.status(500).json({ error: 'Failed to generate firmware: ' + err.message });
  }
});

module.exports = router;
