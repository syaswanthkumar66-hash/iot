import { connect } from 'mqtt/dist/mqtt';

import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MQTT_KEEPALIVE_SECONDS } from '../config/env';

const MQTT_CLIENT_ID_KEY = 'iotyk.mqtt.clientId';
const MQTT_STATE_THROTTLE_MS = 300;

let client = null;
let currentConfig = null;
const subscribedTopics = new Set();
const topicRefs = new Map();
const topicCallbacks = new Map();
const statusHandlers = new Set();
const errorHandlers = new Set();
const lastMessageAt = new Map();

export async function connectMQTT(config) {
  if (!config?.url || !config?.username || !config?.password) {
    throw new Error('Invalid MQTT config.');
  }

  if (client) {
    if (isSameConfig(config)) return client;
    disconnectMQTT();
  }

  currentConfig = config;
  const clientId = await getClientId(config.username);

  client = connect(normalizeWssUrl(config.url), {
    clientId,
    username: config.username,
    password: config.password,
    protocol: 'wss',
    clean: false,
    reconnectPeriod: 3000,
    connectTimeout: 5000,
    keepalive: MQTT_KEEPALIVE_SECONDS,
    resubscribe: true
  });

  client.on('connect', () => {
    subscribedTopics.clear();
    topicRefs.forEach((count, topic) => {
      if (count > 0) subscribePacket(topic);
    });
    emitStatus('connected');
  });

  client.on('reconnect', () => emitStatus('reconnecting'));
  client.on('close', () => emitStatus('offline'));
  client.on('offline', () => emitStatus('offline'));
  client.on('error', emitError);
  client.on('message', handleMessage);

  return client;
}

export function publishCommand(topic, payload) {
  if (!client?.connected) {
    throw new Error('MQTT is not connected yet.');
  }

  client.publish(`${topic}/cmd`, JSON.stringify(payload), { qos: 1 });
}

export function subscribeTopic(topic, callback) {
  if (!topic) return () => {};

  topicRefs.set(topic, (topicRefs.get(topic) || 0) + 1);
  if (callback) {
    const callbacks = topicCallbacks.get(topic) || new Set();
    callbacks.add(callback);
    topicCallbacks.set(topic, callbacks);
  }

  subscribePacket(topic);

  return () => {
    if (callback) {
      const callbacks = topicCallbacks.get(topic);
      callbacks?.delete(callback);
      if (callbacks?.size === 0) topicCallbacks.delete(topic);
    }

    const nextCount = Math.max((topicRefs.get(topic) || 0) - 1, 0);
    if (nextCount > 0) {
      topicRefs.set(topic, nextCount);
      return;
    }

    topicRefs.delete(topic);
    lastMessageAt.delete(topic);

    if (client?.connected && subscribedTopics.has(topic)) {
      client.unsubscribe(topic, (error) => {
        if (error) emitError(error);
      });
    }

    subscribedTopics.delete(topic);
  };
}

export function disconnectMQTT() {
  subscribedTopics.clear();
  topicRefs.clear();
  topicCallbacks.clear();
  lastMessageAt.clear();
  currentConfig = null;

  if (client) {
    client.removeAllListeners();
    client.end(true);
    client = null;
  }
}

export function subscribeDevice(namespace, callback) {
  return subscribeTopic(`device/${namespace}/state`, callback);
}

export function publishPower(namespace, enabled) {
  publishCommand(`device/${namespace}`, { power: enabled ? 'on' : 'off' });
}

export function onMQTTStatus(handler) {
  statusHandlers.add(handler);
  return () => statusHandlers.delete(handler);
}

export function onMQTTError(handler) {
  errorHandlers.add(handler);
  return () => errorHandlers.delete(handler);
}

function subscribePacket(topic) {
  if (!client?.connected || subscribedTopics.has(topic)) return;

  client.subscribe(topic, { qos: 1 }, (error) => {
    if (error) {
      emitError(error);
      return;
    }
    subscribedTopics.add(topic);
  });
}

function handleMessage(topic, message) {
  const now = Date.now();
  const last = lastMessageAt.get(topic) || 0;
  if (now - last < MQTT_STATE_THROTTLE_MS) return;
  lastMessageAt.set(topic, now);

  let data;
  try {
    data = JSON.parse(message.toString());
  } catch {
    console.warn('Invalid MQTT payload:', topic, message.toString());
    return;
  }

  const callbacks = topicCallbacks.get(topic);
  callbacks?.forEach((callback) => callback(data, topic));
}

function emitStatus(status) {
  statusHandlers.forEach((handler) => handler(status));
}

function emitError(error) {
  errorHandlers.forEach((handler) => handler(error));
}

function isSameConfig(config) {
  return currentConfig?.url === config.url
    && currentConfig?.username === config.username
    && currentConfig?.password === config.password;
}

function normalizeWssUrl(url) {
  if (!url) return url;
  if (url.startsWith('wss://') && url.includes('/mqtt')) return url;
  if (url.startsWith('wss://')) return url.endsWith('/') ? `${url}mqtt` : `${url}/mqtt`;
  return url;
}

async function getClientId(username) {
  const stored = await AsyncStorage.getItem(MQTT_CLIENT_ID_KEY);
  if (stored) return stored;

  const safeUser = String(username || 'user').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32);
  const clientId = `app_${safeUser}_${Math.random().toString(16).slice(2)}`;
  await AsyncStorage.setItem(MQTT_CLIENT_ID_KEY, clientId);
  return clientId;
}

AppState.addEventListener('change', (state) => {
  if (state === 'active' && client && !client.connected) {
    client.reconnect();
  }
});
