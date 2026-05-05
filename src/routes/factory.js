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

// ─────────────────────────────────────────────────────────────────────────────
// GET /firmware-source
// Download ALL raw firmware source files as a ZIP (generic, no device config)
// Use this to get the full source code for manual editing
// ─────────────────────────────────────────────────────────────────────────────
router.get('/firmware-source', requireFactoryAuth, async (req, res) => {
  try {
    const firmwareDir = path.resolve(__dirname, '../../firmware/iotyk_esp32');
    if (!fs.existsSync(firmwareDir)) {
      return res.status(404).json({ error: 'Firmware source directory not found on server' });
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="iotyk_esp32_source.zip"');

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(res);

    // Add only FILES (skip subdirectories like __pycache__)
    const files = fs.readdirSync(firmwareDir);
    for (const file of files) {
      const filePath = path.join(firmwareDir, file);
      if (fs.statSync(filePath).isFile()) {
        archive.file(filePath, { name: `iotyk_esp32/${file}` });
      }
    }

    // Add a README with flashing instructions
    archive.append(generateFlashingReadme(), { name: 'iotyk_esp32/FLASH_INSTRUCTIONS.md' });

    await archive.finalize();
  } catch (error) {
    console.error('Firmware source download error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to create firmware source ZIP' });
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /device/:deviceId/firmware-package
// Download ALL firmware files as a ZIP with device-specific config.h and
// certificates.h pre-filled. Open in Arduino IDE and flash directly.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/device/:deviceId/firmware-package', requireFactoryAuth, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const emqxCaCert = req.query?.emqx_ca || '';

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
      return res.status(404).json({ error: 'Device not found' });
    }

    const device = deviceRes.rows[0];
    const broker = process.env.EMQX_MQTT_HOST || 'xxxx.ala.us-east-1.emqxsl.com';
    const password = decrypt(device.mqtt_password_enc);
    const localToken = crypto.randomBytes(8).toString('hex');

    // Build device-specific files
    const configContent = buildFirmwareConfig({
      deviceId: device.device_id,
      namespace: device.namespace,
      broker,
      username: device.mqtt_username,
      password,
      localToken,
      relayCount: sanitizeRelayCount(device.relay_count),
    });

    const certs = generateCertificates(device.device_id);
    const certsHeader = formatCertificatesHeader(certs, emqxCaCert);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${device.device_id}_flash_package.zip"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(res);

    const folderName = 'iotyk_esp32'; // MUST match .ino filename for Arduino IDE

    // 1. Add generated device-specific headers
    archive.append(configContent, { name: `${folderName}/config.h` });
    archive.append(certsHeader, { name: `${folderName}/certificates.h` });

    // 2. Add all other firmware files from the source directory
    const firmwareDir = path.resolve(__dirname, '../../firmware/iotyk_esp32');
    if (fs.existsSync(firmwareDir)) {
      const files = fs.readdirSync(firmwareDir);
      for (const file of files) {
        // Skip files we've already generated dynamically or that aren't source code
        if (file === 'config.h' || file === 'certificates.h' || file.startsWith('.') || file.endsWith('.zip') || file.endsWith('.exe')) continue;
        
        const filePath = path.join(firmwareDir, file);
        if (fs.statSync(filePath).isFile()) {
          archive.file(filePath, { name: `${folderName}/${file}` });
        }
      }
    }

    // 3. Add flashing instructions
    archive.append(generateFlashingReadme(device.device_id), { name: `${folderName}/FLASH_INSTRUCTIONS.md` });

    // 4. Log the flash event (non-blocking — don't fail the download if log fails)
    archive.on('end', async () => {
      try {
        await query(`
          UPDATE devices
          SET flash_count = COALESCE(flash_count, 0) + 1,
              last_flashed_at = NOW()
          WHERE device_id = $1
        `, [device.device_id]);
        await query(`
          INSERT INTO hardware_flash_log (device_id, event_type, notes)
          SELECT id, 'credential_send', 'Firmware package downloaded'
          FROM devices WHERE device_id = $1
        `, [device.device_id]);
      } catch (logErr) {
        console.warn('[Flash Log] Failed to log flash event:', logErr.message);
      }
    });

    await archive.finalize();
  } catch (error) {
    console.error('Firmware package download error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to generate firmware package' });
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /device/:deviceId/replace-hardware
// Mark device as hardware-replaced. Returns same credentials for re-flashing.
// Use when original ESP32 board is damaged and needs to be replaced.
// The device identity (ID, namespace, MQTT creds) stays the same — only the
// physical board changes. User pairing is preserved.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/device/:deviceId/replace-hardware', requireFactoryAuth, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const notes = req.body?.notes || 'Hardware replaced';

    await ensureRelayCountColumn();
    const deviceRes = await query(`
      SELECT d.id, d.device_id, d.namespace, COALESCE(d.relay_count, 1) AS relay_count,
             d.hardware_replace_count, d.flash_count, d.owner_id,
             c.mqtt_username, c.mqtt_password_enc
      FROM devices d
      JOIN mqtt_credentials c ON c.device_id = d.id
      WHERE d.device_id = $1 AND c.cred_type = 'device_permanent' AND c.is_active = true
      ORDER BY c.created_at DESC
      LIMIT 1
    `, [deviceId]);

    if (deviceRes.rows.length === 0) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const device = deviceRes.rows[0];
    const broker = process.env.EMQX_MQTT_HOST || 'xxxx.ala.us-east-1.emqxsl.com';
    const password = decrypt(device.mqtt_password_enc);

    // Mark hardware as replaced, increment counter
    await query(`
      UPDATE devices
      SET hardware_replaced = true,
          hardware_replace_count = COALESCE(hardware_replace_count, 0) + 1,
          last_flashed_at = NOW()
      WHERE device_id = $1
    `, [deviceId]);

    // Log the replacement event
    await query(`
      INSERT INTO hardware_flash_log (device_id, event_type, notes)
      VALUES ($1, 'hardware_replace', $2)
    `, [device.id, notes]);

    // Return the same credentials — ready to flash new board
    res.json({
      message: 'Hardware replacement recorded. Use the same credentials to flash the new board.',
      hardware_replace_count: (device.hardware_replace_count || 0) + 1,
      firmware_config: {
        device_id: device.device_id,
        namespace: device.namespace,
        mqtt_broker: broker,
        relay_count: sanitizeRelayCount(device.relay_count),
        relay_pins: DEFAULT_RELAY_PINS.slice(0, sanitizeRelayCount(device.relay_count)),
        permanent_mqtt: {
          username: device.mqtt_username,
          password,
        },
        download_url: `/api/v1/factory/device/${encodeURIComponent(deviceId)}/firmware-package`,
      },
      instructions: [
        '1. Download firmware package from download_url',
        '2. Flash to the new ESP32 board using Arduino IDE',
        '3. Connect new board via USB to factory dashboard',
        '4. Authenticate with session token',
        '5. Click Send Credentials — credentials are identical to original board',
        '6. User pairing (app connection) is preserved — no re-pairing needed',
      ]
    });

  } catch (error) {
    console.error('Hardware replace error:', error);
    res.status(500).json({ error: 'Failed to process hardware replacement' });
  }
});

// GET /device/:deviceId/flash-history  — full flash log for a device
router.get('/device/:deviceId/flash-history', requireFactoryAuth, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const result = await query(`
      SELECT l.event_type, l.notes, l.created_at
      FROM hardware_flash_log l
      JOIN devices d ON d.id = l.device_id
      WHERE d.device_id = $1
      ORDER BY l.created_at DESC
    `, [deviceId]);
    res.json({ device_id: deviceId, history: result.rows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch flash history' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// List all provisioned devices (for admin dashboard)
router.get('/devices', requireFactoryAuth, async (req, res) => {
  try {
    await ensureRelayCountColumn();
    const devicesRes = await query(`
      SELECT d.id, d.device_id, d.namespace, d.name, d.is_online, d.created_at,
             COALESCE(d.relay_count, 1) AS relay_count,
             COALESCE(d.flash_count, 0) AS flash_count,
             d.last_flashed_at,
             COALESCE(d.hardware_replaced, false) AS hardware_replaced,
             COALESCE(d.hardware_replace_count, 0) AS hardware_replace_count,
             u.email as owner_email
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
    // FQBN for ESP32 Dev Module with Huge App partition (needed for BLE + SSL)
    const fqbn = 'esp32:esp32:esp32:PartitionScheme=huge_app'; 
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

function generateFlashingReadme(deviceId = null) {
  const deviceLine = deviceId
    ? `**Device ID:** \`${deviceId}\``
    : '**Device ID:** *(generic source — fill in config.h manually)*';

  return `# IoTYK ESP32 — Flash Instructions
${deviceLine}

---

## 📋 Files in this ZIP

| File | Description |
|------|-------------|
| \`iotyk_esp32.ino\` | **Main sketch** — open this in Arduino IDE |
| \`config.h\` | **Device credentials** — pre-filled with your device data |
| \`certificates.h\` | **TLS certificates** — WSS certs + EMQX CA placeholder |
| \`TinyMqtt.h\` | **Custom MQTT Engine** — zero-dependency cloud comms |
| \`TinyJson.h\` | **Custom JSON Engine** — lightweight data parsing |
| \`TinyWss.h\` | **Custom WSS Engine** — secure local control |
| \`ble_provision.h\` | BLE WiFi provisioning logic |
| \`local_server.h\` | Local WebSocket Secure (WSS) server |

---

## ⚙️ Step 1 — Install Arduino IDE

Download from: https://www.arduino.cc/en/software  
Use **Arduino IDE 2.x** or **3.x**.

---

## 🔌 Step 2 — Add ESP32 Board Support

1. Open Arduino IDE → **File → Preferences**
2. In **Additional Boards Manager URLs**, add:
   ```
   https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
   ```
3. Go to **Tools → Board → Boards Manager**
4. Search for \`esp32\` → Install **esp32 by Espressif Systems** (version 3.x recommended)

---

## 📦 Step 3 — Libraries (IMPORTANT)

**ZERO LIBRARIES REQUIRED!**  
This firmware is custom-built to have no external dependencies. Do **NOT** install ArduinoJson, PubSubClient, or WebSockets. Everything you need is already in this ZIP folder.

---

## 🔑 Step 4 — Paste EMQX CA Certificate (Important!)

Open \`certificates.h\` and find this section:

\`\`\`
static const char EMQX_MQTT_CA_CERT[] PROGMEM = R"EOF(
-----BEGIN CERTIFICATE-----
PASTE_EMQX_CA_CERTIFICATE_HERE
-----END CERTIFICATE-----
)EOF";
\`\`\`

Replace \`PASTE_EMQX_CA_CERTIFICATE_HERE\` with your actual EMQX CA certificate:
1. Log into EMQX Cloud console
2. Go to: **Deployment → Overview → Connection guide**
3. Download \`emqxsl-ca.crt\`
4. Open it in Notepad, copy ALL content between (and including) the \`-----BEGIN\` and \`-----END\` lines
5. Paste it in place of the placeholder

---

## 🖥️ Step 5 — Select Board & Port

1. Connect ESP32 via USB
2. **Tools → Board → esp32 → ESP32 Dev Module**
3. **Tools → Port** → Select the COM port (e.g., COM3, COM4, /dev/ttyUSB0)

---

## 🚀 Step 6 — Upload

1. Open \`iotyk_esp32.ino\` (all .h files auto-load since they're in the same folder)
2. Click **Upload** (→ button)
3. Wait for "Done uploading"

---

## 📡 Step 7 — Monitor & Pair

1. Open **Tools → Serial Monitor** (baud: **115200**)
2. You should see:
   \`\`\`
   --- IoTYK ESP32 Starting ---
   BLE Advertising started. Name: IoTYK-XXXX
   \`\`\`
3. Open the IoTYK mobile app → scan QR code or enter the pairing key → send WiFi credentials via BLE
4. Device connects to WiFi, then MQTT → LED slow blinks ✅

---

## 🏁 LED Status Guide

| LED Pattern | Meaning |
|---|---|
| OFF | Waiting for BLE pairing |
| Fast blink (200ms) | BLE connected / Connecting to WiFi or MQTT |
| Slow blink (1000ms) | Fully connected to MQTT ✅ |

---

## ❓ Troubleshooting

- **Port not visible**: Install CP2102 or CH340 USB driver for your ESP32 board
- **Compilation error "library not found"**: Re-check Step 3 library names
- **MQTT not connecting**: Verify \`certificates.h\` has real EMQX CA cert (not placeholder)
- **BLE not visible**: Ensure phone Bluetooth is ON and app has BLE permissions
`;
}
