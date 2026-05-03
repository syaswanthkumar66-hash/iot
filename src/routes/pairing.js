import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { query } from '../db/connection.js';
import { generateToken, generateMqttPassword, encrypt } from '../utils/crypto.js';
import { emqxAdmin } from '../services/emqxAdmin.js';

const router = Router();

// 1. Generate pairing token for BLE exchange
router.post('/token', requireAuth, async (req, res) => {
  const { device_id } = req.body;
  if (!device_id) return res.status(400).json({ error: 'device_id required' });

  try {
    const deviceRes = await query('SELECT id, namespace FROM devices WHERE device_id = $1', [device_id]);
    if (deviceRes.rows.length === 0) {
      return res.status(404).json({ error: 'Device not found in system' });
    }
    
    const deviceRecId = deviceRes.rows[0].id;
    const namespace = deviceRes.rows[0].namespace;

    const token = generateToken(16); // 32 hex chars
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Generate initial temporary MQTT credentials
    const tempMqttUser = `tmp_${namespace}_${Date.now().toString(36)}`;
    const tempMqttPass = generateMqttPassword(24);
    const tempExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Insert token
    await query(`
      INSERT INTO pairing_tokens (device_id, user_id, token, expires_at)
      VALUES ($1, $2, $3, $4)
    `, [deviceRecId, req.user.id, token, expiresAt]);

    // Insert temp MQTT credentials
    await query(`
      INSERT INTO mqtt_credentials (device_id, cred_type, mqtt_username, mqtt_password_enc, expires_at)
      VALUES ($1, 'device_temp', $2, $3, $4)
    `, [deviceRecId, tempMqttUser, encrypt(tempMqttPass), tempExpiresAt]);

    // Register user in EMQX
    await emqxAdmin.createUser(tempMqttUser, tempMqttPass);

    res.json({ 
      token, 
      expires_at: expiresAt,
      temp_mqtt: {
        username: tempMqttUser,
        password: tempMqttPass
      }
    });
  } catch (error) {
    console.error('Pairing token error:', error);
    res.status(500).json({ error: 'Failed to generate token' });
  }
});

// 2. Verify token (called by device over local WiFi after BLE, or over MQTT)
// This is typically called by the device, not the app. 
// For simplicity in this demo, we assume the app completes the pairing via /user/add-device
// after WiFi is sent.

export default router;
