const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../auth');
const mqtt = require('../mqtt');
const { verifyToken } = require('./auth');

/**
 * GET /devices
 * Get all devices for authenticated user
 */
router.get('/', verifyToken, (req, res) => {
  try {
    const devices = db.prepare(`
      SELECT id, namespace, online, last_seen, relay_states, rssi, firmware_version as fw
      FROM devices
      WHERE user_id = ?
    `).all(req.userId);

    // Parse relay_states JSON
    const formattedDevices = devices.map(d => ({
      id: d.id,
      namespace: d.namespace,
      online: !!d.online,
      last_seen: d.last_seen,
      relay_states: JSON.parse(d.relay_states || '[]'),
      rssi: d.rssi,
      fw: d.fw,
    }));

    res.json(formattedDevices);
  } catch (err) {
    console.error('Get devices error:', err);
    res.status(500).json({ error: 'Failed to get devices' });
  }
});

/**
 * GET /devices/:id
 * Get single device details
 */
router.get('/:id', verifyToken, (req, res) => {
  try {
    const device = db.prepare(`
      SELECT * FROM devices WHERE id = ? AND user_id = ?
    `).get(req.params.id, req.userId);

    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    res.json({
      id: device.id,
      namespace: device.namespace,
      online: !!device.online,
      last_seen: device.last_seen,
      relay_states: JSON.parse(device.relay_states || '[]'),
      rssi: device.rssi,
      firmware_version: device.firmware_version,
      created_at: device.created_at,
    });
  } catch (err) {
    console.error('Get device error:', err);
    res.status(500).json({ error: 'Failed to get device' });
  }
});

/**
 * GET /devices/:id/token
 * Get local token for HTTP/WS authentication on same LAN
 */
router.get('/:id/token', verifyToken, (req, res) => {
  try {
    const device = db.prepare(`
      SELECT local_token FROM devices WHERE id = ? AND user_id = ?
    `).get(req.params.id, req.userId);

    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    res.json({
      local_token: device.local_token,
    });
  } catch (err) {
    console.error('Get token error:', err);
    res.status(500).json({ error: 'Failed to get token' });
  }
});

/**
 * POST /devices/:id/rotate
 * Rotate temporary MQTT credentials
 */
router.post('/:id/rotate', verifyToken, (req, res) => {
  try {
    const device = db.prepare(`
      SELECT * FROM devices WHERE id = ? AND user_id = ?
    `).get(req.params.id, req.userId);

    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    // Generate new temp credentials
    const newTempUser = auth.generateTempUser(device.namespace);
    const newTempPass = auth.generateTempPass();

    // Update DB
    db.prepare(`
      UPDATE devices SET temp_mqtt_user = ?, temp_mqtt_pass = ?
      WHERE id = ?
    `).run(newTempUser, newTempPass, device.id);

    // Publish rotation command via MQTT
    mqtt.publishRotate(device.namespace, newTempUser, newTempPass);

    res.json({
      temp_user: newTempUser,
      temp_pass: newTempPass,
    });
  } catch (err) {
    console.error('Rotate credentials error:', err);
    res.status(500).json({ error: 'Failed to rotate credentials' });
  }
});

/**
 * DELETE /devices/:id
 * Soft delete device (mark inactive)
 */
router.delete('/:id', verifyToken, (req, res) => {
  try {
    const device = db.prepare(`
      SELECT * FROM devices WHERE id = ? AND user_id = ?
    `).get(req.params.id, req.userId);

    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    // Soft delete: set online to 0 and could add an inactive flag
    // For now, we'll just disconnect by marking offline
    db.prepare('UPDATE devices SET online = 0 WHERE id = ?').run(device.id);

    res.json({ message: 'Device deleted' });
  } catch (err) {
    console.error('Delete device error:', err);
    res.status(500).json({ error: 'Failed to delete device' });
  }
});

module.exports = router;
