import mqtt from 'mqtt';
import dotenv from 'dotenv';
import { query } from '../db/connection.js';

dotenv.config();

class MqttBridge {
  constructor() {
    this.client = null;
    this.brokerUrl = process.env.EMQX_BROKER_URL;
    this.username = process.env.MQTT_SERVICE_USER;
    this.password = process.env.MQTT_SERVICE_PASS;
  }

  connect() {
    if (!this.brokerUrl || !this.username || !this.password) {
      console.warn('⚠️ Server MQTT credentials not configured. Bridge will not start.');
      return;
    }

    console.log(`🔌 Connecting to MQTT Broker: ${this.brokerUrl}...`);

    this.client = mqtt.connect(this.brokerUrl, {
      clientId: `server_${Math.random().toString(16).slice(2, 10)}`,
      username: this.username,
      password: this.password,
      reconnectPeriod: 5000,
      clean: false
    });

    this.client.on('connect', () => {
      console.log('✅ Server MQTT connected successfully');
      
      // Subscribe to device status heartbeats
      this.client.subscribe('device/+/status', { qos: 1 });
      // Subscribe to device state so app refresh can restore relay switches immediately
      this.client.subscribe('device/+/state', { qos: 1 });
      // Subscribe to device problem alerts
      this.client.subscribe('device/+/problem', { qos: 1 });
    });

    this.client.on('error', (err) => {
      console.error('❌ Server MQTT Error:', err.message);
    });

    this.client.on('message', async (topic, message) => {
      try {
        await this.handleMessage(topic, message);
      } catch (err) {
        console.error(`Error handling MQTT message on ${topic}:`, err);
      }
    });
  }

  async handleMessage(topic, message) {
    const parts = topic.split('/');
    if (parts.length < 3) return;
    
    const namespace = parts[1];
    const event = parts[2];
    
    let payload = {};
    try {
      payload = JSON.parse(message.toString());
    } catch {
      payload = { raw: message.toString() };
    }

    if (event === 'status') {
      // Device heartbeat - update last_seen
      await query(`
        UPDATE devices 
        SET last_seen = NOW(), is_online = true 
        WHERE namespace = $1
      `, [namespace]);
      // console.log(`Device heartbeat updated: ${namespace}`);
    } else if (event === 'state') {
      await query(`
        UPDATE devices
        SET last_state = $2::jsonb, last_seen = NOW(), is_online = true
        WHERE namespace = $1
      `, [namespace, JSON.stringify(payload)]);
    } else if (event === 'problem') {
      console.warn(`🚨 Device Problem [${namespace}]:`, payload);
      // In a real system, you might trigger an email alert here
    }
  }

  /**
   * Publish new temporary credentials to a device's permanent connection
   */
  publishRotation(namespace, newUsername, newPassword) {
    if (!this.client || !this.client.connected) {
      throw new Error('MQTT Bridge is not connected');
    }

    const payload = JSON.stringify({
      cmd: 'rotate',
      username: newUsername,
      password: newPassword,
      ts: Date.now()
    });

    this.client.publish(`device/${namespace}/sys/rotate`, payload, { qos: 1 });
    console.log(`Published rotation command to device/${namespace}`);
  }

  /**
   * Publish factory reset command
   */
  publishReset(namespace) {
    if (!this.client || !this.client.connected) {
      throw new Error('MQTT Bridge is not connected');
    }

    const payload = JSON.stringify({ cmd: 'reset', ts: Date.now() });
    this.client.publish(`device/${namespace}/sys/reset`, payload, { qos: 1 });
    console.log(`Published reset command to device/${namespace}`);
  }
}

export const mqttBridge = new MqttBridge();
