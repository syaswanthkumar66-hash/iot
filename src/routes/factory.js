import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { query, withTransaction } from '../db/connection.js';
import { hashPassword, encrypt, decrypt, generateMqttPassword } from '../utils/crypto.js';
import { emqxAdmin } from '../services/emqxAdmin.js';
import archiver from 'archiver';
import path from 'path';
import fs from 'fs';
import { generateCertificates, formatCertificatesHeader } from '../utils/certificates.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();
const DEFAULT_RELAY_PINS = [26, 27, 14, 25, 33, 32, 23, 22];
const MAX_RELAY_COUNT = DEFAULT_RELAY_PINS.length;

// Simple auth for factory tool - in production use a strong FACTORY_API_KEY
const requireFactoryAuth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (token !== (process.env.FACTORY_API_KEY || 'dev-factory-key')) {
    return res.status(401).json({ error: 'Unauthorized factory access' });
  }
  next();
};

router.post('/device', requireFactoryAuth, async (req, res) => {
  try {
    await ensureRelayCountColumn();
    const relayCount = sanitizeRelayCount(req.body?.relay_count ?? req.body?.switch_count ?? 1);

    // Generate device identity
    const shortId = Math.random().toString(36).substring(2, 8).toUpperCase();
    const deviceId = `ESP32-${shortId}`;
    const namespace = `ns_${uuidv4().replace(/-/g, '').substring(0, 16)}`;
    
    // Generate pairing key (what user types in/scans)
    const pairingKey = Math.random().toString(36).substring(2, 10);
    const keyHash = await hashPassword(pairingKey);

    // Generate permanent MQTT credentials
    const permMqttUser = `perm_${namespace}`;
    const permMqttPass = generateMqttPassword(24);

    let deviceRecId;

    await withTransaction(async (client) => {
      // 1. Create device record
      const deviceRes = await client.query(`
        INSERT INTO devices (device_id, device_key_hash, namespace, name, relay_count)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `, [deviceId, keyHash, namespace, `Smart Device ${shortId}`, relayCount]);
      
      deviceRecId = deviceRes.rows[0].id;

      // 2. Save Permanent Credentials
      await client.query(`
        INSERT INTO mqtt_credentials (device_id, cred_type, mqtt_username, mqtt_password_enc, expires_at)
        VALUES ($1, 'device_permanent', $2, $3, NULL)
      `, [deviceRecId, permMqttUser, encrypt(permMqttPass)]);

      // 3. Create user in EMQX Broker
      await emqxAdmin.createUser(permMqttUser, permMqttPass);
    });

    // Return everything needed to flash the device and print the QR code
    res.status(201).json({
      message: 'Device provisioned successfully',
      qr_data: {
        device_id: deviceId,
        device_key: pairingKey
      },
      firmware_config: {
        device_id: deviceId,
        mqtt_broker: process.env.EMQX_MQTT_HOST || 'xxxx.ala.us-east-1.emqxsl.com',
        relay_count: relayCount,
        relay_pins: DEFAULT_RELAY_PINS.slice(0, relayCount),
        namespace,
        permanent_mqtt: {
          username: permMqttUser,
          password: permMqttPass
        },
        download_url: `/api/v1/factory/device/${encodeURIComponent(deviceId)}/config.h`
      },
      firmware_download_url: `/api/v1/factory/device/${encodeURIComponent(deviceId)}/config.h`
    });

  } catch (error) {
    console.error('Factory provision error:', error);
    res.status(500).json({ error: 'Failed to provision device' });
  }
});

router.get('/device/:deviceId/config.h', requireFactoryAuth, async (req, res) => {
  try {
    await ensureRelayCountColumn();
    const deviceRes = await query(`
      SELECT d.device_id, d.namespace, COALESCE(d.relay_count, 1) AS relay_count, c.mqtt_username, c.mqtt_password_enc
      FROM devices d
      JOIN mqtt_credentials c ON c.device_id = d.id
      WHERE d.device_id = $1 AND c.cred_type = 'device_permanent' AND c.is_active = true
      ORDER BY c.created_at DESC
      LIMIT 1
    `, [req.params.deviceId]);

    if (deviceRes.rows.length === 0) {
      return res.status(404).json({ error: 'Device firmware config not found' });
    }

    const device = deviceRes.rows[0];
    const broker = process.env.EMQX_MQTT_HOST || 'xxxx.ala.us-east-1.emqxsl.com';
    const password = decrypt(device.mqtt_password_enc);
    const config = buildFirmwareConfig({
      deviceId: device.device_id,
      namespace: device.namespace,
      broker,
      username: device.mqtt_username,
      password,
      relayCount: sanitizeRelayCount(device.relay_count)
    });

    res.setHeader('Content-Type', 'text/x-c-header; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${device.device_id}_config.h"`);
    res.send(config);
  } catch (error) {
    console.error('Firmware config download error:', error);
    res.status(500).json({ error: 'Failed to generate firmware config' });
  }
});

router.post('/device/:deviceId/generate-firmware', requireFactoryAuth, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const emqxCaCert = req.body?.emqx_ca_cert || '';
    
    await ensureRelayCountColumn();
    const deviceRes = await query(`
      SELECT d.device_id, d.namespace, COALESCE(d.relay_count, 1) AS relay_count, c.mqtt_username, c.mqtt_password_enc
      FROM devices d
      JOIN mqtt_credentials c ON c.device_id = d.id
      WHERE d.device_id = $1 AND c.cred_type = 'device_permanent' AND c.is_active = true
      ORDER BY c.created_at DESC
      LIMIT 1
    `, [deviceId]);

    if (deviceRes.rows.length === 0) {
      return res.status(404).json({ error: 'Device firmware config not found' });
    }

    const device = deviceRes.rows[0];
    const broker = process.env.EMQX_MQTT_HOST || 'xxxx.ala.us-east-1.emqxsl.com';
    const password = decrypt(device.mqtt_password_enc);
    
    // Generate config.h
    const configContent = buildFirmwareConfig({
      deviceId: device.device_id,
      namespace: device.namespace,
      broker,
      username: device.mqtt_username,
      password,
      relayCount: sanitizeRelayCount(device.relay_count)
    });

    // Generate certificates
    const certs = generateCertificates(device.device_id);
    const certsHeader = formatCertificatesHeader(certs, emqxCaCert);

    // Create zip
    const archive = archiver('zip', {
      zlib: { level: 9 } // Sets the compression level.
    });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${device.device_id}_firmware.zip"`);

    archive.pipe(res);

    // Append generated headers
    archive.append(configContent, { name: 'config.h' });
    archive.append(certsHeader, { name: 'certificates.h' });

    // Append firmware directory
    const firmwareDir = path.resolve(__dirname, '../../firmware/iotyk_esp32');
    if (fs.existsSync(firmwareDir)) {
      archive.directory(firmwareDir, false);
    }

    await archive.finalize();

  } catch (error) {
    console.error('Firmware zip generation error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to generate firmware zip' });
    }
  }
});

// List all provisioned devices (for admin dashboard)
router.get('/devices', requireFactoryAuth, async (req, res) => {
  try {
    await ensureRelayCountColumn();
    const devicesRes = await query(`
      SELECT d.id, d.device_id, d.namespace, d.name, d.is_online, d.created_at, COALESCE(d.relay_count, 1) AS relay_count, u.email as owner_email
      FROM devices d
      LEFT JOIN users u ON u.id = d.owner_id
      ORDER BY d.created_at DESC
    `);
    
    res.json({ devices: devicesRes.rows });
  } catch (error) {
    console.error('List factory devices error:', error);
    res.status(500).json({ error: 'Failed to list devices' });
  }
});

router.delete('/device/:deviceId', requireFactoryAuth, async (req, res) => {
  try {
    const { deviceId } = req.params;
    
    // First find the namespace to delete from EMQX
    const deviceRes = await query('SELECT id, namespace FROM devices WHERE device_id = $1', [deviceId]);
    if (deviceRes.rows.length === 0) {
      return res.status(404).json({ error: 'Device not found' });
    }
    
    const device = deviceRes.rows[0];
    const namespace = device.namespace;
    
    // Find MQTT users to delete from EMQX
    const credsRes = await query('SELECT mqtt_username FROM mqtt_credentials WHERE device_id = $1', [device.id]);
    
    // Delete users from EMQX
    for (const row of credsRes.rows) {
      try {
        await emqxAdmin.deleteUser(row.mqtt_username);
      } catch (e) {
        console.error(`Failed to delete EMQX user ${row.mqtt_username}:`, e);
      }
    }
    
    // Delete device from DB (cascade manual cleanup)
    await withTransaction(async (client) => {
      await client.query('DELETE FROM mqtt_credentials WHERE device_id = $1', [device.id]);
      await client.query('DELETE FROM pairing_tokens WHERE device_id = $1', [device.id]);
      await client.query('DELETE FROM device_shares WHERE device_id = $1', [device.id]);
      await client.query('DELETE FROM device_transfers WHERE device_id = $1', [device.id]);
      await client.query('DELETE FROM devices WHERE id = $1', [device.id]);
    });
    
    res.json({ message: 'Device deleted successfully' });
  } catch (error) {
    console.error('Delete device error:', error);
    res.status(500).json({ error: 'Failed to delete device' });
  }
});

router.post('/device/:deviceId/compile', requireFactoryAuth, async (req, res) => {
  const { deviceId } = req.params;
  const emqxCaCert = req.body?.emqx_ca_cert || '';
  const tempBaseDir = path.join(__dirname, '../../temp_build', `${deviceId}_${Date.now()}`);
  const tempDir = path.join(tempBaseDir, 'iotyk_esp32'); // Directory name MUST match .ino filename for Arduino CLI

  // Resolve arduino-cli binary — works on Linux (Render), macOS, and Windows
  const projectRoot = process.cwd();
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  const isWin   = process.platform === 'win32';
  const cliExe  = isWin ? 'arduino-cli.exe' : 'arduino-cli';
  
  // Try project root first (Render/Docker), then home dir (Local setup), then system PATH
  const projectCliPath = path.join(projectRoot, 'arduino_cli', 'bin', cliExe);
  const homeCliPath    = path.join(homeDir, 'arduino_cli', 'bin', cliExe);
  
  let arduinoCli = cliExe; // Default to PATH
  if (fs.existsSync(projectCliPath)) {
    arduinoCli = projectCliPath;
  } else if (fs.existsSync(homeCliPath)) {
    arduinoCli = homeCliPath;
  }
  
  const arduinoConfig = path.join(projectRoot, 'arduino-cli.yaml');
  console.log(`[Factory] Resolved arduino-cli path: ${arduinoCli}`);

  try {
    // 1. Fetch device data
    const deviceRes = await query(`
      SELECT d.device_id, d.namespace, COALESCE(d.relay_count, 1) AS relay_count, c.mqtt_username, c.mqtt_password_enc
      FROM devices d
      JOIN mqtt_credentials c ON c.device_id = d.id
      WHERE d.device_id = $1 AND c.cred_type = 'device_permanent' AND c.is_active = true
      ORDER BY c.created_at DESC LIMIT 1
    `, [deviceId]);

    if (deviceRes.rows.length === 0) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const device = deviceRes.rows[0];
    const broker = process.env.EMQX_MQTT_HOST || 'xxxx.ala.us-east-1.emqxsl.com';
    const password = decrypt(device.mqtt_password_enc);
    
    // Generate or use existing local token (16 chars)
    const localToken = crypto.randomBytes(8).toString('hex');

    // 2. Prepare temporary build directory
    if (!fs.existsSync(tempBaseDir)) fs.mkdirSync(tempBaseDir, { recursive: true });
    fs.mkdirSync(tempDir, { recursive: true });

    // Copy firmware files (skip subdirectories like __pycache__)
    const firmwareSrcDir = path.resolve(__dirname, '../../firmware/iotyk_esp32');
    const files = fs.readdirSync(firmwareSrcDir);
    for (const file of files) {
      const srcPath = path.join(firmwareSrcDir, file);
      if (!fs.statSync(srcPath).isFile()) continue; // skip directories
      fs.copyFileSync(srcPath, path.join(tempDir, file));
    }

    // Generate config.h
    const configContent = buildFirmwareConfig({
      deviceId: device.device_id,
      namespace: device.namespace,
      broker,
      username: device.mqtt_username,
      password,
      localToken,
      relayCount: sanitizeRelayCount(device.relay_count)
    });
    fs.writeFileSync(path.join(tempDir, 'config.h'), configContent);

    // Generate certificates.h
    const certs = generateCertificates(device.device_id);
    const certsHeader = formatCertificatesHeader(certs, emqxCaCert);
    fs.writeFileSync(path.join(tempDir, 'certificates.h'), certsHeader);

    // 3. Compile using Arduino CLI
    // FQBN for ESP32 Dev Module
    const fqbn = 'esp32:esp32:esp32'; 
    // Use --jobs 1 to limit memory usage on Render free tier (512MB)
    const compileCmd = `${arduinoCli} --config-file "${arduinoConfig}" compile --fqbn ${fqbn} --jobs 1 --output-dir "${tempDir}" "${tempDir}"`;

    console.log(`Starting compilation for ${deviceId}...`);
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);


    try {
      await execAsync(compileCmd, { timeout: 300000 }); // 5 min timeout
    } catch (compileError) {
      const details = compileError.stdout || compileError.stderr || compileError.message;
      console.error('Compilation failed:', details);
      return res.status(500).json({ error: 'Firmware compilation failed', details });
    }

    // 4. Find and return the .bin file
    const binFile = path.join(tempDir, 'iotyk_esp32.ino.bin');
    if (!fs.existsSync(binFile)) {
      return res.status(500).json({ error: 'Compilation finished but .bin file not found' });
    }

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${deviceId}.bin"`);
    res.send(fs.readFileSync(binFile));

    // Cleanup temp directory after sending
    setTimeout(() => {
      fs.rmSync(tempBaseDir, { recursive: true, force: true });
    }, 5000);

  } catch (error) {
    console.error('Compilation route error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error during compilation', details: error.message });
    }
    if (fs.existsSync(tempBaseDir)) fs.rmSync(tempBaseDir, { recursive: true, force: true });
  }
});

export default router;

function buildFirmwareConfig({ deviceId, namespace, broker, username, password, localToken, relayCount = 1 }) {
  const count = sanitizeRelayCount(relayCount);
  const pins = DEFAULT_RELAY_PINS.slice(0, count);
  // Generate a random local token if not supplied (e.g., for ZIP / config.h download routes)
  const token = localToken || crypto.randomBytes(8).toString('hex');

  return `#ifndef IOTYK_CONFIG_H
#define IOTYK_CONFIG_H

// --- Hardware ---
#define LED_PIN 2
#define RELAY_COUNT ${count}
#define RELAY_ACTIVE_LOW true
static const uint8_t RELAY_PINS[RELAY_COUNT] = {${pins.join(', ')}};

// --- BLE UUIDs ---
#define BLE_SERVICE_UUID "12345678-1234-1234-1234-123456789abc"
#define BLE_WIFI_CHAR_UUID "abcd1234-5678-1234-5678-abcdef123456"
#define BLE_TOKEN_CHAR_UUID "abcd1234-5678-1234-5678-abcdef123457"

// --- EMQX MQTT Configuration ---
#define MQTT_BROKER "${escapeCString(broker)}"
#define MQTT_PORT 8883
#define MQTT_KEEP_ALIVE 60

// --- Factory values for downloadable firmware ---
#define FACTORY_DEVICE_ID "${escapeCString(deviceId)}"
#define FACTORY_DEVICE_NS "${escapeCString(namespace)}"
#define FACTORY_PERM_MQTT_USER "${escapeCString(username)}"
#define FACTORY_PERM_MQTT_PASS "${escapeCString(password)}"
#define FACTORY_LOCAL_TOKEN "${escapeCString(token)}"

// --- Local network services ---
#define LOCAL_HTTP_PORT 80
#define LOCAL_WS_PORT 81
#define LOCAL_WSS_PORT 82
#define LOCAL_WSS_ENABLED true
#define FIRMWARE_VERSION "1.1.0"

// --- NVS Storage Keys ---
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

function escapeCString(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function sanitizeRelayCount(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(Math.max(parsed, 1), MAX_RELAY_COUNT);
}

async function ensureRelayCountColumn() {
  await query(`
    ALTER TABLE devices
    ADD COLUMN IF NOT EXISTS relay_count INTEGER NOT NULL DEFAULT 1;
  `);
}
