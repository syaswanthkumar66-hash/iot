import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { query, withTransaction } from '../db/connection.js';
import { generateToken } from '../utils/crypto.js';

const router = Router();

// --- SHARING ---

// Create share invite
router.post('/:id/share', requireAuth, async (req, res) => {
  const { email, role } = req.body;
  const { id: namespace } = req.params;

  if (!email || !['viewer', 'controller'].includes(role)) {
    return res.status(400).json({ error: 'Invalid email or role' });
  }

  try {
    const deviceRes = await query('SELECT id FROM devices WHERE namespace = $1 AND owner_id = $2', [namespace, req.user.id]);
    if (deviceRes.rows.length === 0) {
      return res.status(404).json({ error: 'Device not found or not owned by you' });
    }

    const inviteToken = generateToken(20);

    await query(`
      INSERT INTO device_shares (device_id, owner_id, invite_email, role, invite_token)
      VALUES ($1, $2, $3, $4, $5)
    `, [deviceRes.rows[0].id, req.user.id, email.toLowerCase(), role, inviteToken]);

    res.json({ message: 'Share invite created', token: inviteToken });
  } catch (error) {
    console.error('Share error:', error);
    res.status(500).json({ error: 'Failed to share device' });
  }
});

// Accept share invite
router.post('/accept/:token', requireAuth, async (req, res) => {
  const { token } = req.params;

  try {
    const shareRes = await query(`
      SELECT id, device_id, invite_email FROM device_shares 
      WHERE invite_token = $1 AND status = 'pending'
    `, [token]);

    if (shareRes.rows.length === 0) {
      return res.status(404).json({ error: 'Invalid or expired invite token' });
    }

    const share = shareRes.rows[0];
    
    if (share.invite_email && share.invite_email !== req.user.email) {
      return res.status(403).json({ error: 'This invite was sent to a different email' });
    }

    await query(`
      UPDATE device_shares 
      SET shared_with_id = $1, status = 'accepted', invite_token = NULL
      WHERE id = $2
    `, [req.user.id, share.id]);

    res.json({ message: 'Share accepted successfully' });
  } catch (error) {
    console.error('Accept share error:', error);
    res.status(500).json({ error: 'Failed to accept share' });
  }
});

// Revoke share
router.delete('/:id/share/:shareId', requireAuth, async (req, res) => {
  try {
    // Ensure the requester owns the device
    const deviceRes = await query('SELECT id FROM devices WHERE namespace = $1 AND owner_id = $2', [req.params.id, req.user.id]);
    if (deviceRes.rows.length === 0) {
      return res.status(404).json({ error: 'Device not found' });
    }

    await query('DELETE FROM device_shares WHERE id = $1 AND device_id = $2', [req.params.shareId, deviceRes.rows[0].id]);
    res.json({ message: 'Share revoked' });
  } catch (error) {
    console.error('Revoke share error:', error);
    res.status(500).json({ error: 'Failed to revoke share' });
  }
});

// --- TRANSFER ---

// Initiate transfer
router.post('/:id/transfer', requireAuth, async (req, res) => {
  try {
    const deviceRes = await query('SELECT id FROM devices WHERE namespace = $1 AND owner_id = $2', [req.params.id, req.user.id]);
    if (deviceRes.rows.length === 0) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const transferToken = generateToken(20);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await query(`
      INSERT INTO device_transfers (device_id, from_user_id, transfer_token, expires_at)
      VALUES ($1, $2, $3, $4)
    `, [deviceRes.rows[0].id, req.user.id, transferToken, expiresAt]);

    res.json({ message: 'Transfer initiated', token: transferToken });
  } catch (error) {
    console.error('Transfer error:', error);
    res.status(500).json({ error: 'Failed to initiate transfer' });
  }
});

// Accept transfer
router.post('/transfer/accept/:token', requireAuth, async (req, res) => {
  try {
    await withTransaction(async (client) => {
      const transferRes = await client.query(`
        SELECT id, device_id, from_user_id FROM device_transfers
        WHERE transfer_token = $1 AND status = 'pending' AND expires_at > NOW()
      `, [req.params.token]);

      if (transferRes.rows.length === 0) {
        throw new Error('Invalid or expired transfer token');
      }

      const transfer = transferRes.rows[0];

      // Update device owner
      await client.query('UPDATE devices SET owner_id = $1 WHERE id = $2', [req.user.id, transfer.device_id]);

      // Update shares to point to new owner (or delete them if preferred)
      await client.query('UPDATE device_shares SET owner_id = $1 WHERE device_id = $2', [req.user.id, transfer.device_id]);

      // Mark transfer complete
      await client.query('UPDATE device_transfers SET status = $1 WHERE id = $2', ['accepted', transfer.id]);
    });

    res.json({ message: 'Device ownership transferred successfully' });
  } catch (error) {
    console.error('Accept transfer error:', error);
    res.status(400).json({ error: error.message || 'Failed to accept transfer' });
  }
});

export default router;
