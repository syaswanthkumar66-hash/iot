import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { hmac_sha256 } from '../utils/crypto';

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
    return this.sendCommandWs(deviceId, { action: 'STATUS' }, token);
  },

  /**
   * Send command directly over local WiFi
   */
  async sendCommand(deviceId, command, token) {
    return this.sendCommandWs(deviceId, command, token);
  },

  async sendCommandWs(deviceId, command, token) {
    if (!token) throw new Error('Missing local token.');
    return wsRequest(deviceId, command, token);
  }
};

function wsRequest(deviceId, command, token) {
  return new Promise((resolve, reject) => {
    // Port 80 plain WebSocket endpoint (matches high-performance S3 code freeze)
    const url = `ws://${deviceId}.local/ws`;
    const ws = new WebSocket(url);
    let authenticated = false;

    const timeoutId = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error('Local WebSocket timed out.'));
    }, LOCAL_TIMEOUT_MS);

    ws.onopen = () => {
      // Challenge nonce is pushed automatically by device on connect
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // 1. Handle challenge nonce
        if (data && data.nonce) {
          const hmac = hmac_sha256(token, data.nonce);
          ws.send(JSON.stringify({ auth: hmac }));
          return;
        }

        // 2. Handle authentication success
        if (data && data.status === 'auth_ok') {
          authenticated = true;
          const payload = {
            t: token,
            ...command
          };
          ws.send(JSON.stringify(payload));
          return;
        }

        // 3. Handle final command response
        clearTimeout(timeoutId);
        try { ws.close(); } catch {}

        if (data && data.e) {
          reject(new Error(`Device error code: ${data.e}`));
        } else {
          resolve(data);
        }
      } catch (err) {
        clearTimeout(timeoutId);
        try { ws.close(); } catch {}
        reject(new Error('Invalid local WebSocket response.'));
      }
    };

    ws.onerror = () => {
      clearTimeout(timeoutId);
      reject(new Error('Local WebSocket connection failed.'));
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
