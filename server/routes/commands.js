const express = require('express');
const router = express.Router();
const db = require('../db');
const mqtt = require('../mqtt');
const { verifyToken } = require('./auth');

/**
 * POST /devices/:id/cmd
 * Send relay command to device
 */
router.post('/:id/cmd', verifyToken, (req, res) => {
  try {
    // Verify device belongs to user
    const device = db.prepare(`
      SELECT * FROM devices WHERE id = ? AND user_id = ?
    `).get(req.params.id, req.userId);

    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    // Step 1: Validate command shape
    const command = req.body;
    if (!command || typeof command !== 'object') {
      return res.status(400).json({ error: 'Invalid command' });
    }

    // Basic validation - command should have at least one recognized field
    const validFields = ['power', 'relay', 'relays', 'wifi'];
    const hasValidField = Object.keys(command).some(key => validFields.includes(key));
    if (!hasValidField) {
      return res.status(400).json({ error: 'Command must contain: power, relay, relays, or wifi' });
    }

    // Step 2: Publish command via MQTT
    mqtt.publishCommand(device.namespace, command);

    // Step 3: Log to commands_log
    db.prepare(`
      INSERT INTO commands_log (device_id, source, command, sent_at, acked)
      VALUES (?, ?, ?, ?, ?)
    `).run(device.id, 'mqtt', JSON.stringify(command), Date.now(), 0);

    res.json({
      sent: true,
      command,
    });
  } catch (err) {
    console.error('Send command error:', err);
    res.status(500).json({ error: 'Failed to send command' });
  }
});

/**
 * GET /devices/:id/commands
 * Get last 50 command logs for device
 */
router.get('/:id/commands', verifyToken, (req, res) => {
  try {
    // Verify device belongs to user
    const device = db.prepare(`
      SELECT id FROM devices WHERE id = ? AND user_id = ?
    `).get(req.params.id, req.userId);

    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const commands = db.prepare(`
      SELECT id, device_id, source, command, sent_at, acked
      FROM commands_log
      WHERE device_id = ?
      ORDER BY sent_at DESC
      LIMIT 50
    `).all(device.id);

    // Parse command JSON
    const formattedCommands = commands.map(cmd => ({
      id: cmd.id,
      device_id: cmd.device_id,
      source: cmd.source,
      command: JSON.parse(cmd.command),
      sent_at: cmd.sent_at,
      acked: !!cmd.acked,
    }));

    res.json(formattedCommands);
  } catch (err) {
    console.error('Get commands error:', err);
    res.status(500).json({ error: 'Failed to get commands' });
  }
});

module.exports = router;
