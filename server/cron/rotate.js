const cron = require('node-cron');
const db = require('../db');
const auth = require('../auth');
const mqtt = require('../mqtt');

/**
 * Start credential rotation cron job
 * Runs every 24 hours to rotate temp MQTT credentials for all online devices
 */
function startRotationCron() {
  // Schedule for every 24 hours (0 0 * * * = midnight every day)
  // For testing, use '*/5 * * * *' (every 5 minutes)
  const schedule = process.env.NODE_ENV === 'development' ? '*/30 * * * *' : '0 0 * * *';

  const task = cron.schedule(schedule, () => {
    rotateCredentials();
  });

  console.log(`✓ Credential rotation cron started (schedule: ${schedule})`);
  return task;
}

/**
 * Rotate credentials for all online devices
 */
async function rotateCredentials() {
  try {
    console.log(`\n🔄 Starting credential rotation job at ${new Date().toISOString()}`);

    // Get all online devices
    const onlineDevices = db.prepare(`
      SELECT id, namespace, temp_mqtt_user, temp_mqtt_pass
      FROM devices
      WHERE online = 1
    `).all();

    console.log(`Found ${onlineDevices.length} online devices`);

    let rotatedCount = 0;
    for (const device of onlineDevices) {
      try {
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

        rotatedCount++;
        console.log(`  ✓ Rotated ${device.id}`);
      } catch (err) {
        console.error(`  ✗ Failed to rotate ${device.id}:`, err.message);
      }
    }

    console.log(`✓ Credential rotation complete: ${rotatedCount}/${onlineDevices.length} devices`);
  } catch (err) {
    console.error('Credential rotation error:', err);
  }
}

module.exports = {
  startRotationCron,
};
