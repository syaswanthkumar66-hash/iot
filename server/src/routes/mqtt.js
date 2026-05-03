import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { query, withTransaction } from '../db/connection.js';
import { encrypt, generateMqttPassword } from '../utils/crypto.js';
import { emqxAdmin } from '../services/emqxAdmin.js';

const router = Router();

router.post('/refresh', requireAuth, async (req, res) => {
  try {
    const mqttUsername = `app_${req.user.id.substring(0,8)}_${Date.now().toString(36)}`;
    const mqttPassword = generateMqttPassword();
    const mqttExpiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

    await withTransaction(async (client) => {
      // 1. Find existing active credentials for this user
      const existingRes = await client.query(`
        SELECT mqtt_username FROM mqtt_credentials 
        WHERE user_id = $1 AND cred_type = 'user_temp' AND is_active = true
      `, [req.user.id]);

      // 2. Insert new credentials
      await client.query(`
        INSERT INTO mqtt_credentials (user_id, cred_type, mqtt_username, mqtt_password_enc, expires_at)
        VALUES ($1, 'user_temp', $2, $3, $4)
      `, [req.user.id, mqttUsername, encrypt(mqttPassword), mqttExpiresAt]);

      // 3. Mark old ones as inactive
      await client.query(`
        UPDATE mqtt_credentials SET is_active = false 
        WHERE user_id = $1 AND cred_type = 'user_temp' AND mqtt_username != $2
      `, [req.user.id, mqttUsername]);

      // 4. Create new user in EMQX
      await emqxAdmin.createUser(mqttUsername, mqttPassword);

      // 5. Delete old users from EMQX
      for (const row of existingRes.rows) {
        await emqxAdmin.deleteUser(row.mqtt_username).catch(e => console.error('Cleanup old EMQX user failed', e));
      }
    });

    res.json({
      mqtt: {
        url: process.env.EMQX_BROKER_URL,
        username: mqttUsername,
        password: mqttPassword,
        expiresAt: mqttExpiresAt
      }
    });
  } catch (error) {
    console.error('MQTT refresh error:', error);
    res.status(500).json({ error: 'Failed to refresh MQTT credentials' });
  }
});

export default router;
