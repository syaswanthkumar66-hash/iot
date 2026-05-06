import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// For mDNS discovery on React Native we'd ideally use a library like 'react-native-zeroconf'
// However, since it requires native modules that might not be in the bare Expo project yet,
// we will implement a fallback mechanism where the app attempts to ping `{device_id}.local`
// directly. Most modern mobile OS network stacks resolve .local mDNS domains automatically
// if the device is on the same subnet.

const LOCAL_TIMEOUT_MS = 2500; // Fast timeout for local network
const LOCAL_TOKEN_KEY = 'iotyk.localTokens';

/**
 * Perform a request to the device on the local network via mDNS hostname.
 */
async function localRequest(deviceId, path, method = 'GET', body = null, token = null) {
  // Mobile OS will resolve {deviceId}.local via mDNS natively
  const url = `http://${deviceId}.local${path}`;

  const headers = {
    Accept: 'application/json',
    ...(body ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LOCAL_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : null,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Local request failed: ${response.status}`);
    }

    const text = await response.text();
    return text ? JSON.parse(text) : null;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

export const localDeviceApi = {
  async saveToken(deviceId, token) {
    if (!deviceId || !token) return;
    const tokens = await readTokens();
    tokens[deviceId] = token;
    await AsyncStorage.setItem(LOCAL_TOKEN_KEY, JSON.stringify(tokens));
  },

  async getToken(deviceId) {
    const tokens = await readTokens();
    return tokens[deviceId] || null;
  },

  /**
   * Check if device is reachable on local WiFi
   */
  async ping(deviceId) {
    try {
      const data = await localRequest(deviceId, '/info');
      return !!data && data.id === deviceId;
    } catch {
      return false;
    }
  },

  /**
   * Get device state directly over local WiFi
   */
  async getState(deviceId, token) {
    return localRequest(deviceId, '/state', 'GET', null, token);
  },

  /**
   * Send command directly over local WiFi
   */
  async sendCommand(deviceId, command, token) {
    return localRequest(deviceId, '/cmd', 'POST', command, token);
  },

  async sendCommandWs(deviceId, command, token) {
    if (!token) throw new Error('Missing local token.');
    try {
      return await wsRequest(deviceId, { token, cmd: command }, true);
    } catch {
      return wsRequest(deviceId, { token, cmd: command }, false);
    }
  }
};

function wsRequest(deviceId, payload, secure = false) {
  return new Promise((resolve, reject) => {
    const url = secure ? `wss://${deviceId}.local:82` : `ws://${deviceId}.local:81`;
    const ws = new WebSocket(url);
    const timeoutId = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error(`${secure ? 'Local WSS' : 'Local WebSocket'} timed out.`));
    }, LOCAL_TIMEOUT_MS);

    ws.onopen = () => {
      ws.send(JSON.stringify(payload));
    };

    ws.onmessage = (event) => {
      clearTimeout(timeoutId);
      try { ws.close(); } catch {}
      try {
        const data = JSON.parse(event.data);
        if (data?.error) reject(new Error(data.error));
        else resolve(data);
      } catch {
        reject(new Error('Invalid local WebSocket response.'));
      }
    };

    ws.onerror = () => {
      clearTimeout(timeoutId);
      reject(new Error(`${secure ? 'Local WSS' : 'Local WebSocket'} unavailable.`));
    };
  });
}

async function readTokens() {
  const raw = await AsyncStorage.getItem(LOCAL_TOKEN_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    await AsyncStorage.removeItem(LOCAL_TOKEN_KEY);
    return {};
  }
}
