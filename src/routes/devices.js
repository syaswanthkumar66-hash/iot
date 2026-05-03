import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { query } from '../db/connection.js';
import { verifyPassword } from '../utils/crypto.js';
import { mqttBridge } from '../services/mqttBridge.js';

const router = Router();

async function ensureRelayCountColumn() {
  await query(`
    ALTER TABLE devices
    ADD COLUMN IF NOT EXISTS relay_count INTEGER NOT NULL DEFAULT 1;
  `);
}

// List devices
router.get('/', requireAuth, async (req, res) => {
  try {
    await ensureRelayCountColumn();
    // Get owned devices
    const ownedRes = await query(`
      SELECT d.device_id, d.namespace, d.name, d.firmware, COALESCE(d.relay_count, 1) AS relay_count, d.last_state, d.last_seen, d.is_online, 'owner' as role
      FROM devices d
      WHERE d.owner_id = $1
    `, [req.user.id]);

    // Get shared devices
    const sharedRes = await query(`
      SELECT d.device_id, d.namespace, d.name, d.firmware, COALESCE(d.relay_count, 1) AS relay_count, d.last_state, d.last_seen, d.is_online, s.role
      FROM devices d
      JOIN device_shares s ON s.device_id = d.id
      WHERE s.shared_with_id = $1 AND s.status = 'accepted'
    `, [req.user.id]);

    const allDevices = [...ownedRes.rows, ...sharedRes.rows].map(d => ({
      ...d,
      current_state: d.last_state // Map to what app expects
    }));

    res.json({ devices: allDevices });
  } catch (err) {
    console.error('List devices error:', err);
    res.status(500).json({ error: 'Failed to list devices' });
  }
});

// Add/Pair a device
router.post('/add-device', requireAuth, async (req, res) => {
  const { device_id, device_key } = req.body;

  if (!device_id || !device_key) {
    return res.status(400).json({ error: 'Missing device_id or device_key' });
  }

  try {
    await ensureRelayCountColumn();
    // 1. Find device
    const deviceRes = await query('SELECT * FROM devices WHERE device_id = $1', [device_id]);
    if (deviceRes.rows.length === 0) {
      return res.status(404).json({ error: 'Device not found' });
    }
    
    const device = deviceRes.rows[0];

    // 2. Check if already owned
    if (device.owner_id && device.owner_id !== req.user.id) {
      return res.status(400).json({ error: 'Device is already paired to another account' });
    }
    if (device.owner_id === req.user.id) {
      return res.json({ message: 'Already paired', device });
    }

    // 3. Verify key
    const valid = await verifyPassword(device_key, device.device_key_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid device key' });
    }

    // 4. Update owner
    const updateRes = await query(`
      UPDATE devices SET owner_id = $1 WHERE id = $2
      RETURNING device_id, namespace, name, firmware, COALESCE(relay_count, 1) AS relay_count, last_state, last_seen, is_online
    `, [req.user.id, device.id]);

    const updatedDevice = updateRes.rows[0];
    updatedDevice.current_state = updatedDevice.last_state;

    res.json({ message: 'Device added successfully', device: updatedDevice });
  } catch (err) {
    console.error('Add device error:', err);
    res.status(500).json({ error: 'Failed to add device' });
  }
});

// Remove a device
router.delete('/:namespace', requireAuth, async (req, res) => {
  const { namespace } = req.params;
  try {
    const result = await query(`
      UPDATE devices SET owner_id = NULL 
      WHERE namespace = $1 AND owner_id = $2
      RETURNING id
    `, [namespace, req.user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Device not found or not owned by you' });
    }
    
    // Cleanup shares
    await query('DELETE FROM device_shares WHERE device_id = $1', [result.rows[0].id]);

    res.json({ message: 'Device removed successfully' });
  } catch (err) {
    console.error('Remove device error:', err);
    res.status(500).json({ error: 'Failed to remove device' });
  }
});

// Reset a device
router.post('/:namespace/reset', requireAuth, async (req, res) => {
  const { namespace } = req.params;
  try {
    const deviceRes = await query('SELECT id FROM devices WHERE namespace = $1 AND owner_id = $2', [namespace, req.user.id]);
    if (deviceRes.rows.length === 0) {
      return res.status(404).json({ error: 'Device not found or not owned by you' });
    }

    // Clear state
    await query(`
      UPDATE devices SET last_state = '{}'::jsonb, is_online = false, owner_id = NULL 
      WHERE id = $1
    `, [deviceRes.rows[0].id]);

    // Send reset command via MQTT Bridge
    try {
      mqttBridge.publishReset(namespace);
    } catch (e) {
      console.warn('Failed to publish reset command', e);
    }

    res.json({ message: 'Device reset successfully' });
  } catch (err) {
    console.error('Reset device error:', err);
    res.status(500).json({ error: 'Failed to reset device' });
  }
});

export default router;
