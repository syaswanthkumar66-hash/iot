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
  let token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    token = req.query?.key || req.query?.token;
  }
  
  let expected = (process.env.FACTORY_API_KEY || 'dev-factory-key').replace(/^['"]|['"]$/g, '').trim();
  const cleanToken = token?.replace(/^['"]|['"]$/g, '').trim();

  if (cleanToken !== expected) {
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

router.all('/device/:deviceId/generate-firmware', requireFactoryAuth, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const emqxCaCert = req.body?.emqx_ca_cert || req.query?.emqx_ca_cert || '';
    
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

    // Append firmware directory (excluding config.h/certificates.h to avoid duplicates)
    const firmwareDir = path.resolve(__dirname, '../../firmware/iotyk_esp32');
    if (fs.existsSync(firmwareDir)) {
      const files = fs.readdirSync(firmwareDir);
      for (const file of files) {
        if (file === 'config.h' || file === 'certificates.h' || file.startsWith('.') || file.endsWith('.zip') || file.endsWith('.exe')) continue;
        
        const filePath = path.join(firmwareDir, file);
        if (file === 'main') {
          archive.directory(filePath, 'main');
        } else if (fs.statSync(filePath).isFile()) {
          archive.file(filePath, { name: file });
        }
      }
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

    // Add files and main component directory (skip subdirectories like __pycache__ or build)
    const files = fs.readdirSync(firmwareDir);
    for (const file of files) {
      const filePath = path.join(firmwareDir, file);
      if (file === 'main') {
        archive.directory(filePath, 'iotyk_esp32/main');
      } else if (fs.statSync(filePath).isFile()) {
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

    const buildDir = path.resolve(__dirname, '../../firmware/iotyk_esp32/build');

    // 1. Resolve compiled binary paths
    const bootloaderPath = path.join(buildDir, 'bootloader/bootloader.bin');
    const partitionsPath = path.join(buildDir, 'partition_table/partition-table.bin');
    const otaDataPath = path.join(buildDir, 'ota_data_initial.bin');
    const appPath = path.join(buildDir, 'iotyk_esp32.bin');

    const binariesExist = fs.existsSync(bootloaderPath) && 
                          fs.existsSync(partitionsPath) && 
                          fs.existsSync(otaDataPath) && 
                          fs.existsSync(appPath);

    if (!binariesExist) {
      return res.status(404).json({
        error: 'Precompiled binaries not found',
        details: 'Native ESP-IDF build binaries were not found inside the firmware build folder. Please compile the project first in firmware/iotyk_esp32 using "idf.py build".'
      });
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${device.device_id}_native_flash_package.zip"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(res);

    // Append precompiled binary files
    archive.file(bootloaderPath, { name: 'bin/bootloader.bin' });
    archive.file(partitionsPath, { name: 'bin/partition-table.bin' });
    archive.file(otaDataPath, { name: 'bin/ota_data_initial.bin' });
    archive.file(appPath, { name: 'bin/iotyk_esp32.bin' });

      // 2. Generate flash.bat (Windows Utility)
      const batContent = `@echo off
echo ====================================================================
echo   IoTYK ESP32 - Native Production Flasher (${device.device_id})
echo ====================================================================
echo.
echo Please connect your ESP32 board via USB.
echo.
set /p COM_PORT="Enter COM Port (e.g., COM5): "

echo.
echo Installing/upgrading esptool via pip...
python -m pip install esptool --quiet

echo.
echo Flashing precompiled native ESP-IDF binaries to %COM_PORT%...
python -m esptool --chip esp32 -p %COM_PORT% -b 460800 --before=default-reset --after=hard-reset write-flash --flash-mode dio --flash-freq 40m --flash-size 4MB 0x1000 bin/bootloader.bin 0x8000 bin/partition-table.bin 0xf000 bin/ota_data_initial.bin 0x20000 bin/iotyk_esp32.bin

echo.
echo ====================================================================
echo   Flashing complete! 
echo ====================================================================
echo.
echo Step 2: Open the factory dashboard in your browser.
echo Step 3: Connect to USB Serial, then click "Perform Factory Setup".
echo.
pause
`;
      archive.append(batContent, { name: 'flash.bat' });

      // 3. Generate flash.sh (macOS / Linux Utility)
      const shContent = `#!/bin/bash
echo "===================================================================="
echo "  IoTYK ESP32 - Native Production Flasher (${device.device_id})"
echo "===================================================================="
echo ""
echo "Please connect your ESP32 board via USB."
echo ""
read -p "Enter Serial Port (e.g., /dev/ttyUSB0 or /dev/cu.usbserial-110): " SERIAL_PORT

echo ""
echo "Installing/upgrading esptool via pip..."
pip install esptool --quiet

echo ""
echo "Flashing precompiled native ESP-IDF binaries to $SERIAL_PORT..."
esptool.py --chip esp32 -p "$SERIAL_PORT" -b 460800 --before=default-reset --after=hard-reset write-flash --flash-mode dio --flash-freq 40m --flash-size 4MB 0x1000 bin/bootloader.bin 0x8000 bin/partition-table.bin 0xf000 bin/ota_data_initial.bin 0x20000 bin/iotyk_esp32.bin

echo ""
echo "===================================================================="
echo "  Flashing complete!"
echo "===================================================================="
echo ""
echo "Step 2: Open the factory dashboard in your browser."
echo "Step 3: Connect to USB Serial, then click \\"Perform Factory Setup\\"."
echo ""
`;
      archive.append(shContent, { name: 'flash.sh' });

      // 4. Generate README.md
      const readmeContent = `# IoTYK Direct Flasher — Device ${device.device_id}

This package contains precompiled production binaries for device **${device.device_id}**.
No source code setup or compilation is required!

## 🚀 Step 1: Flash Device

### Windows OS
1. Connect your ESP32 via USB.
2. Double-click \`flash.bat\`.
3. Input your COM port (e.g., \`COM5\`) and press Enter.

### macOS / Linux OS
1. Connect your ESP32 via USB.
2. Run \`bash flash.sh\` in your terminal.
3. Input your serial port (e.g., \`/dev/ttyUSB0\` or \`/dev/cu.usbserial-110\`) and press Enter.

## 🔑 Step 2: Personalize & Provision
1. Open the Factory Web Dashboard (\`http://localhost:3000\`).
2. Select your device **${device.device_id}** from the Registry table.
3. Click **Connect USB** to connect Web Serial in the browser.
4. Click **Perform Factory Setup** to automatically write your MQTT credentials and local access tokens over Web Serial to the board's permanent NVS!
`;
    archive.append(readmeContent, { name: 'README.md' });

    // 5. Log the flash event (non-blocking)
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
          SELECT id, 'credential_send', 'Precompiled native flash package downloaded'
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
    fs.mkdirSync(path.join(tempDir, 'main'), { recursive: true });

    // Copy firmware files recursively (skip build directories)
    const firmwareSrcDir = path.resolve(__dirname, '../../firmware/iotyk_esp32');
    const files = fs.readdirSync(firmwareSrcDir);
    for (const file of files) {
      const srcPath = path.join(firmwareSrcDir, file);
      if (file === 'main') {
        const mainFiles = fs.readdirSync(srcPath);
        for (const mFile of mainFiles) {
          if (mFile === 'config.h' || mFile === 'certificates.h') continue;
          fs.copyFileSync(path.join(srcPath, mFile), path.join(tempDir, 'main', mFile));
        }
      } else if (fs.statSync(srcPath).isFile()) {
        fs.copyFileSync(srcPath, path.join(tempDir, file));
      }
    }

    // Generate config.h inside main/
    const configContent = buildFirmwareConfig({
      deviceId: device.device_id,
      namespace: device.namespace,
      broker,
      username: device.mqtt_username,
      password,
      localToken,
      relayCount: sanitizeRelayCount(device.relay_count)
    });
    fs.writeFileSync(path.join(tempDir, 'main', 'config.h'), configContent);

    // Generate certificates.h inside main/
    const certs = generateCertificates(device.device_id);
    const certsHeader = formatCertificatesHeader(certs, emqxCaCert);
    fs.writeFileSync(path.join(tempDir, 'main', 'certificates.h'), certsHeader);

    // 3. Compile using ESP-IDF
    const compileCmd = `idf.py build`;

    console.log(`Starting native ESP-IDF compilation for ${deviceId}...`);
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    try {
      await execAsync(compileCmd, { cwd: tempDir, timeout: 300000 }); // 5 min timeout
    } catch (compileError) {
      console.error('Native compilation failed:', compileError.message);
      return res.status(500).json({ 
        error: 'Native firmware compilation failed', 
        details: 'Native ESP-IDF build requires the idf.py compiler toolchain installed on the server host. Please download the pre-aligned zip package instead and compile locally using "idf.py build".' 
      });
    }

    // 4. Find and return the compiled binary file
    const binFile = path.join(tempDir, 'build', 'iotyk_esp32.bin');
    if (!fs.existsSync(binFile)) {
      return res.status(500).json({ error: 'Compilation finished but binary file not found' });
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

/**
 * @api {post} /api/v1/factory/device/:deviceId/provision-tokens
 * Generates 24h temporary MQTT credentials and a local session token.
 */
router.post('/device/:deviceId/provision-tokens', requireFactoryAuth, async (req, res) => {
  const { deviceId } = req.params;
  try {
    // 1. Get current device
    const deviceRes = await query('SELECT * FROM devices WHERE device_id = $1', [deviceId]);
    if (deviceRes.rows.length === 0) return res.status(404).json({ error: 'Device not found' });
    const device = deviceRes.rows[0];

    // 2. Generate 1h MQTT Credentials (3600 seconds)
    const mqttUser = `tmp_${crypto.randomBytes(4).toString('hex')}`;
    const mqttPass = crypto.randomBytes(12).toString('base64');
    const expiresAt = new Date(Date.now() + 1 * 60 * 60 * 1000); // 1 Hour

    // Save to mqtt_credentials table
    await query(`
      INSERT INTO mqtt_credentials (device_id, cred_type, mqtt_username, mqtt_password_enc, expires_at)
      VALUES ($1, 'temporary', $2, $3, $4)
    `, [device.id, mqttUser, encrypt(mqttPass), expiresAt]);

    // 3. Generate Local Session Token (64-bit Hex)
    const sessionToken = crypto.randomBytes(8).toString('hex').toUpperCase();

    // 4. Return secure bundle to Dashboard
    res.json({
      mqtt_user: mqttUser,
      mqtt_pass: mqttPass,
      session_token: sessionToken,
      device_key: device.device_key_hash || 'DEFAULT_KEY',
      expires_at: expiresAt.toISOString()
    });

  } catch (err) {
    console.error('[Factory] Token generation error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/v1/factory/sign-nonce
 * Sign the boot challenge nonce using the factory private key (HMAC-SHA256)
 */
router.post('/sign-nonce', (req, res) => {
  try {
    const { nonce } = req.body;
    if (!nonce) {
      return res.status(400).json({ error: 'Challenge nonce required' });
    }

    const factoryKey = process.env.FACTORY_LOCAL_TOKEN || 'iotyk-factory-initial-key-2026';

    const signature = crypto
      .createHmac('sha256', factoryKey)
      .update(nonce)
      .digest('hex');

    res.json({ signature });
  } catch (err) {
    console.error('Signing error:', err);
    res.status(500).json({ error: 'Signature generation failed' });
  }
});

export default router;

function buildFirmwareConfig({ deviceId, namespace, broker, username, password, localToken, relayCount = 1 }) {
  const count = sanitizeRelayCount(relayCount);
  const pins = DEFAULT_RELAY_PINS.slice(0, count);
  const token = localToken || crypto.randomBytes(8).toString('hex');

  return `#ifndef MAIN_CONFIG_H
#define MAIN_CONFIG_H

#include <stdint.h>

// --- Hardware Layout ---
#define LED_PIN 2
#define RELAY_COUNT ${count}
#define RELAY_ACTIVE_LOW true

// GPIO assignments
static const uint8_t RELAY_PINS[RELAY_COUNT] = {${pins.join(', ')}};

// --- BLE NimBLE UUIDs ---
#define BLE_SERVICE_UUID     "12345678-1234-1234-1234-123456789abc"
#define BLE_WIFI_CHAR_UUID   "abcd1234-5678-1234-5678-abcdef123456"
#define BLE_TOKEN_CHAR_UUID  "abcd1234-5678-1234-5678-abcdef123457"

// --- EMQX MQTTS Configuration ---
#define DEFAULT_MQTT_BROKER "${escapeCString(broker)}"
#define MQTT_PORT           8883
#define MQTT_KEEP_ALIVE     60

// --- Factory Fallbacks ---
#define FACTORY_DEVICE_ID      "${escapeCString(deviceId)}"
#define FACTORY_DEVICE_NS      "${escapeCString(namespace)}"
#define FACTORY_PERM_MQTT_USER "${escapeCString(username)}"
#define FACTORY_PERM_MQTT_PASS "${escapeCString(password)}"
#define FACTORY_LOCAL_TOKEN    "${escapeCString(token)}"

// --- Firmware Version ---
#define FIRMWARE_VERSION "1.2.0"

// --- Port assignments ---
#define LOCAL_HTTP_PORT  80
#define LOCAL_WSS_PORT   82

// --- NVS Storage Keys (Namespace "iotyk") ---
#define NVS_NAMESPACE   "iotyk"
#define KEY_WIFI_SSID   "w_ssid"
#define KEY_WIFI_PASS   "w_pass"
#define KEY_DEVICE_ID   "d_id"
#define KEY_DEVICE_NS   "d_ns"
#define KEY_PERM_USER   "m_p_usr"
#define KEY_PERM_PASS   "m_p_pwd"
#define KEY_TEMP_USER   "m_t_usr"
#define KEY_TEMP_PASS   "m_t_pwd"
#define KEY_LOCAL_TOKEN "l_tok"

#endif // MAIN_CONFIG_H
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
    ? `**Device ID:** '${deviceId}'`
    : '**Device ID:** *(generic source — fill in config.h manually)*';

  return `# IoTYK ESP32 — Native ESP-IDF Flash Instructions
${deviceLine}

This firmware package has been compiled natively with **100% native ESP-IDF (C/C++)** for maximum performance, minimal memory usage, and advanced security.

---

## 📋 Files in this ZIP

| File | Description |
|------|-------------|
| 'CMakeLists.txt' | ESP-IDF Root project build descriptor |
| 'sdkconfig.defaults' | Pre-selected Bluetooth NimBLE settings |
| 'FLASH_INSTRUCTIONS.md' | Step-by-step native compile guidelines |
| 'main/CMakeLists.txt' | Component registry for compile modules |
| 'main/main.cpp' | Central FreeRTOS loop & system task orchestrator |
| 'main/config.h' | Pre-filled credentials specific to this device |
| 'main/certificates.h' | SSL certificates for WSS + EMQX cloud broker |
| 'main/nvs_manager.cpp' | Key-Value NVS storage controller |
| 'main/relay_controller.cpp'| Hardware GPIO toggles |
| 'main/wifi_manager.cpp' | WiFi event handler & network interfaces |
| 'main/ble_provision.cpp' | NimBLE Bluetooth discoverability & pairing callbacks |
| 'main/local_server.cpp' | Local HTTPS and secure WebSocket server |
| 'main/mqtt_manager.cpp' | Secure cloud MQTTS client loops |

---

## 🚀 How to Compile and Flash Natively

### 1. Prerequisite
Ensure you have the **Espressif ESP-IDF Toolchain** (v5.0 or later) installed on your system.

### 2. Configure Environment
Open your ESP-IDF Command Prompt (or Terminal) and navigate to the package folder:
\`\`\`bash
cd iotyk_esp32
\`\`\`

### 3. Build the Firmware
Compile the project natively. This will automatically compile all C/C++ files, download the lightweight **NimBLE** stack, and link WSS:
\`\`\`bash
idf.py build
\`\`\`

### 4. Flash and Monitor
Connect your ESP32 device via USB and flash the program (replace 'COM3' with your specific serial port):
\`\`\`bash
idf.py -p COM3 flash monitor
\`\`\`

---

## 🖥️ Web Factory Dashboard Integration

Open the **Web Factory Dashboard**, connect the board's USB serial port, and unlock commands with the Local Session Token pre-filled in your 'config.h'. Use the dashboard to burn permanent credentials, monitor WiFi reconnect states, or test relay actions instantly!
`;
}
