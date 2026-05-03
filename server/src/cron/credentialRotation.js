import cron from 'node-cron';
import { query, withTransaction } from '../db/connection.js';
import { encrypt, generateMqttPassword } from '../utils/crypto.js';
import { emqxAdmin } from '../services/emqxAdmin.js';
import { mqttBridge } from '../services/mqttBridge.js';

// Run every 15 minutes
cron.schedule('*/15 * * * *', async () => {
  console.log('🔄 Running MQTT credential rotation cron job...');
  try {
    await rotateDeviceCredentials();
    await cleanupExpiredUserCredentials();
  } catch (err) {
    console.error('Cron job error:', err);
  }
});

async function rotateDeviceCredentials() {
  // Find device credentials expiring in the next 2 hours
  const expiringRes = await query(`
    SELECT mc.id, mc.device_id, mc.mqtt_username, d.namespace 
    FROM mqtt_credentials mc
    JOIN devices d ON d.id = mc.device_id
    WHERE mc.cred_type = 'device_temp' 
      AND mc.is_active = true 
      AND mc.expires_at < NOW() + INTERVAL '2 hours'
  `);

  if (expiringRes.rows.length === 0) return;

  console.log(`Rotating credentials for ${expiringRes.rows.length} devices...`);

  for (const row of expiringRes.rows) {
    try {
      const newUsername = `tmp_${row.namespace}_${Date.now().toString(36)}`;
      const newPassword = generateMqttPassword(24);
      const newExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // Next 24 hours

      await withTransaction(async (client) => {
        // 1. Create in EMQX
        await emqxAdmin.createUser(newUsername, newPassword);

        // 2. Insert into DB
        await client.query(`
          INSERT INTO mqtt_credentials (device_id, cred_type, mqtt_username, mqtt_password_enc, expires_at)
          VALUES ($1, 'device_temp', $2, $3, $4)
        `, [row.device_id, newUsername, encrypt(newPassword), newExpiresAt]);

        // 3. Mark old as inactive
        await client.query('UPDATE mqtt_credentials SET is_active = false WHERE id = $1', [row.id]);
      });

      // 4. Publish to device via MQTT bridge
      mqttBridge.publishRotation(row.namespace, newUsername, newPassword);

      // Note: We don't delete the old EMQX user immediately to allow graceful reconnect.
      // The cleanup job will delete it once it fully expires.
    } catch (err) {
      console.error(`Failed to rotate credentials for device ${row.namespace}:`, err);
    }
  }
}

async function cleanupExpiredUserCredentials() {
  // Find inactive or expired user credentials
  const expiredRes = await query(`
    SELECT id, mqtt_username 
    FROM mqtt_credentials 
    WHERE (is_active = false OR expires_at < NOW())
      AND created_at < NOW() - INTERVAL '1 hour'
      AND cred_type IN ('user_temp', 'device_temp')
  `);

  for (const row of expiredRes.rows) {
    try {
      await emqxAdmin.deleteUser(row.mqtt_username).catch(() => {});
      await query('DELETE FROM mqtt_credentials WHERE id = $1', [row.id]);
    } catch (err) {
      console.error(`Failed to cleanup credential ${row.mqtt_username}:`, err);
    }
  }
}
