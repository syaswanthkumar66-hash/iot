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
      SELECT d.device_id, d.name, d.relay_count, d.last_state, d.last_seen, d.is_online, 'owner' as role
      FROM devices d 
      WHERE d.owner_id = $1
      
      UNION
      
      SELECT d.device_id, d.name, d.relay_count, d.last_state, d.last_seen, d.is_online, s.role as role
      FROM devices d
      JOIN device_shares s ON s.device_id = d.id
      WHERE s.shared_with_id = $1 AND s.status = 'accepted'
    `, [req.user.id]);
    
    res.json({ devices: resDevices.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch devices' });
  }
});

export default router;
