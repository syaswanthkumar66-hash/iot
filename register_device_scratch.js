const path = require('path');
const PROJECT_ROOT = __dirname;

// Require the project database and auth helper
const db = require(path.join(PROJECT_ROOT, 'db'));
const auth = require(path.join(PROJECT_ROOT, 'auth'));

try {
  // Step 1: Create a test/owner user for this new device
  const email = `device_owner_${Date.now()}@iotyk.com`;
  const password = 'iotyk-device-secure-pass';
  const userId = 'user_' + Date.now();
  const passwordHash = auth.hashPassword(password);

  db.prepare(`
    INSERT INTO users (id, email, password_hash, created_at)
    VALUES (?, ?, ?, ?)
  `).run(userId, email, passwordHash, Date.now());

  // Step 2: Generate brand new secure device credentials
  const deviceId = auth.generateId('ESP32-', 6); // Unique ID like "ESP32-QO6XUE"
  const namespace = auth.generateNs();
  const permUser = auth.generateMqttUser(namespace);
  const permPass = auth.generateMqttPass();
  const tempUser = auth.generateTempUser(namespace);
  const tempPass = auth.generateTempPass();
  const localToken = auth.generateLocalToken();
  const relayCount = 4;
  const relayStates = Array(relayCount).fill('off');

  // Step 3: Insert into devices table
  db.prepare(`
    INSERT INTO devices (
      id, user_id, namespace, perm_mqtt_user, perm_mqtt_pass,
      temp_mqtt_user, temp_mqtt_pass, local_token, relay_states, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    deviceId,
    userId,
    namespace,
    permUser,
    permPass,
    tempUser,
    tempPass,
    localToken,
    JSON.stringify(relayStates),
    Date.now()
  );

  console.log('\n==================================================');
  console.log('🎉 BRAND NEW DEVICE SUCCESSFULLY REGISTERED IN DATABASE!');
  console.log('==================================================\n');
  console.log(`📡 Device ID:        ${deviceId}`);
  console.log(`🔗 Local Token:     ${localToken}`);
  console.log(`📂 Namespace:       ${namespace}`);
  console.log('\n--- MQTT CREDENTIALS ---');
  console.log(`👤 Perm MQTT User:  ${permUser}`);
  console.log(`🔑 Perm MQTT Pass:  ${permPass}`);
  console.log(`👤 Temp MQTT User:  ${tempUser}`);
  console.log(`🔑 Temp MQTT Pass:  ${tempPass}`);
  console.log('\n--- ACCOUNT DETAILS ---');
  console.log(`📧 Owner Email:     ${email}`);
  console.log(`🔒 Owner Password:  ${password}`);
  console.log('\n==================================================\n');

} catch (err) {
  console.error('❌ Error registering new device:', err);
}
