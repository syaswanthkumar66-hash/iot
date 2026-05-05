import { Router } from 'express';
import { query, withTransaction } from '../db/connection.js';
import { verifyPassword } from '../utils/crypto.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

/**
 * @api {post} /api/v1/devices/pair
 * Pairs a device to the logged-in user.
 */
router.post('/pair', requireAuth, async (req, res) => {
  const { deviceId, deviceKey, name } = req.body;
  const userId = req.user.id;

  if (!deviceId || !deviceKey) {
    return res.status(400).json({ error: 'Device ID and Key are required' });
  }

  try {
    // 1. Find the device
    const deviceRes = await query('SELECT * FROM devices WHERE device_id = $1', [deviceId]);
    if (deviceRes.rows.length === 0) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const device = deviceRes.rows[0];

    // 2. Check if already owned
    if (device.owner_id) {
      return res.status(400).json({ error: 'Device is already paired to another account' });
    }

    // 3. Verify the Master Key (hash check)
    const valid = await verifyPassword(deviceKey, device.device_key_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid device key' });
    }

    // 4. Update owner
    await query(`
      UPDATE devices 
      SET owner_id = $1, name = $2, last_seen = NOW()
      WHERE id = $3
    `, [userId, name || device.name || 'My ESP32', device.id]);

    res.json({ message: 'Device paired successfully', deviceId });

  } catch (err) {
    console.error('Pairing error:', err);
    res.status(500).json({ error: 'Pairing failed' });
  }
});

/**
 * @api {get} /api/v1/devices
 * Lists all devices owned by the user.
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const resDevices = await query(`
      SELECT device_id, name, relay_count, last_state, last_seen, is_online
      FROM devices WHERE owner_id = $1
    `, [req.user.id]);
    
    res.json({ devices: resDevices.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch devices' });
  }
});

export default router;
