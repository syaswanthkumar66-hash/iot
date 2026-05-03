const mqtt = require('mqtt');
const db = require('./db');

let client;

const EMQX_URL = `mqtts://${process.env.EMQX_API_USER}:${process.env.EMQX_API_PASS}@${process.env.EMQX_BROKER}:${process.env.EMQX_PORT || 8883}`;

/**
 * Connect to EMQX broker and subscribe to device topics
 */
function connectMQTT() {
  client = mqtt.connect(EMQX_URL, {
    clientId: 'iotyk-server-' + Date.now(),
    reconnectPeriod: 5000,
    rejectUnauthorized: false, // For self-signed certs in dev
  });

  client.on('connect', () => {
    console.log('✓ MQTT connected to EMQX');

    // Subscribe to all device status and state messages
    client.subscribe('device/+/status', (err) => {
      if (err) console.error('Failed to subscribe to status:', err);
      else console.log('✓ Subscribed to device/+/status');
    });

    client.subscribe('device/+/state', (err) => {
      if (err) console.error('Failed to subscribe to state:', err);
      else console.log('✓ Subscribed to device/+/state');
    });
  });

  client.on('message', (topic, payload) => {
    handleMessage(topic, payload.toString());
  });

  client.on('error', (err) => {
    console.error('MQTT error:', err);
  });

  client.on('disconnect', () => {
    console.log('⚠ MQTT disconnected');
  });
}

/**
 * Handle incoming MQTT messages from devices
 */
function handleMessage(topic, payloadStr) {
  try {
    const parts = topic.split('/');
    if (parts.length < 3) return;

    const namespace = parts[1]; // device/<ns>/status
    const type = parts[2]; // status or state

    const payload = JSON.parse(payloadStr);

    if (type === 'status') {
      // Update device online status and firmware version
      const device = db.prepare('SELECT id FROM devices WHERE namespace = ?').get(namespace);
      if (!device) {
        console.warn(`Device not found for namespace: ${namespace}`);
        return;
      }

      const now = Date.now();
      const wasOnline = db.prepare('SELECT online FROM devices WHERE id = ?').get(device.id)?.online;

      db.prepare(`
        UPDATE devices 
        SET online = 1, last_seen = ?, firmware_version = ?
        WHERE id = ?
      `).run(now, payload.fw, device.id);

      if (!wasOnline) {
        console.log(`✓ Device ${device.id} came online`);
      }
    } else if (type === 'state') {
      // Update relay states and signal strength
      const device = db.prepare('SELECT id FROM devices WHERE namespace = ?').get(namespace);
      if (!device) {
        console.warn(`Device not found for namespace: ${namespace}`);
        return;
      }

      const relayStates = payload.relays ? JSON.stringify(payload.relays) : null;
      db.prepare(`
        UPDATE devices 
        SET relay_states = ?, rssi = ?
        WHERE id = ?
      `).run(relayStates, payload.rssi, device.id);
    }
  } catch (err) {
    console.error('Error handling MQTT message:', err);
  }
}

/**
 * Publish credential rotation command to device
 */
function publishRotate(namespace, newUser, newPass) {
  if (!client || !client.connected) {
    console.error('MQTT not connected');
    return false;
  }

  const topic = `device/${namespace}/sys/rotate`;
  const payload = JSON.stringify({ username: newUser, password: newPass });

  client.publish(topic, payload, { qos: 1 }, (err) => {
    if (err) {
      console.error(`Failed to publish rotate to ${topic}:`, err);
      return false;
    }
    console.log(`✓ Published rotate command to ${topic}`);
  });

  return true;
}

/**
 * Publish relay command to device
 */
function publishCommand(namespace, cmdJson) {
  if (!client || !client.connected) {
    console.error('MQTT not connected');
    return false;
  }

  const topic = `device/${namespace}/cmd`;
  const payload = JSON.stringify(cmdJson);

  client.publish(topic, payload, { qos: 1 }, (err) => {
    if (err) {
      console.error(`Failed to publish command to ${topic}:`, err);
      return false;
    }
    console.log(`✓ Published command to ${topic}`);
  });

  return true;
}

/**
 * Publish factory reset command to device
 */
function publishReset(namespace) {
  if (!client || !client.connected) {
    console.error('MQTT not connected');
    return false;
  }

  const topic = `device/${namespace}/sys/reset`;
  const payload = JSON.stringify({});

  client.publish(topic, payload, { qos: 1 }, (err) => {
    if (err) {
      console.error(`Failed to publish reset to ${topic}:`, err);
      return false;
    }
    console.log(`✓ Published reset command to ${topic}`);
  });

  return true;
}

module.exports = {
  connectMQTT,
  publishRotate,
  publishCommand,
  publishReset,
};
