import { API_BASE_URL } from '../config/env';
import { normalizeDevice } from '../utils/device';

let authToken = null;
let unauthorizedHandler = null;
let traceHandler = null;

export function setAuthToken(token) {
  authToken = token;
}

export function onUnauthorized(handler) {
  unauthorizedHandler = handler;
}

/** Register a callback to receive API trace events: { method, path, url, status, latencyMs, requestBody, responseBody } */
export function onApiTrace(handler) {
  traceHandler = handler;
}

async function request(path, options = {}, _traceLabel = null) {
  const method = (options.method || 'GET').toUpperCase();
  const requestBody = options.body && typeof options.body !== 'string'
    ? JSON.stringify(options.body, null, 2)
    : options.body || null;

  const headers = {
    Accept: 'application/json',
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    ...(options.headers || {})
  };

  const url = `${API_BASE_URL}${path}`;
  const t0 = Date.now();

  const response = await fetchWithRetry(url, {
    ...options,
    headers,
    body: requestBody
  });

  const latencyMs = Date.now() - t0;
  const text = await response.text();
  const data = text ? parseJson(text) : null;

  // Fire trace callback before throwing so callers see even error responses.
  if (traceHandler) {
    const safeBody = (() => {
      try { return JSON.parse(requestBody); } catch { return requestBody; }
    })();
    traceHandler({
      method,
      path,
      url,
      status: response.status,
      latencyMs,
      requestBody: safeBody,
      responseBody: data
    });
  }

  if (response.status === 401) {
    unauthorizedHandler?.();
  }

  if (!response.ok) {
    const message = data?.message || data?.error || `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return data;
}

async function fetchWithRetry(url, options, retries = 2) {
  try {
    return await fetch(url, options);
  } catch (error) {
    if (retries > 0) {
      await delay((3 - retries) * 350);
      return fetchWithRetry(url, options, retries - 1);
    }
    throw error;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function unwrapList(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.devices)) return data.devices;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.data?.devices)) return data.data.devices;
  return [];
}

export const api = {
  async login(email, password) {
    return request('/auth/login', {
      method: 'POST',
      body: { email, password }
    });
  },

  async getDevices() {
    const data = await request('/user/devices');
    return unwrapList(data).map(normalizeDevice).filter((device) => device.namespace);
  },

  async addDevice(device_id, device_key) {
    const data = await request('/user/add-device', {
      method: 'POST',
      body: { device_id, device_key }
    });
    return data?.device ? normalizeDevice(data.device) : data;
  },

  async createFactoryDevice(factoryToken) {
    return request('/factory/device', {
      method: 'POST',
      headers: { Authorization: `Bearer ${factoryToken}` },
      body: {}
    });
  },

  async getFactoryDevices(factoryToken) {
    return request('/factory/devices', {
      headers: { Authorization: `Bearer ${factoryToken}` }
    });
  },

  // --- New Routes ---

  async register(email, password, name) {
    return request('/auth/register', {
      method: 'POST',
      body: { email, password, name }
    });
  },

  async logout() {
    return request('/auth/logout', { method: 'POST' });
  },

  async mqttRefresh() {
    return request('/mqtt/refresh', { method: 'POST' });
  },

  async getPairingToken(device_id) {
    return request('/pairing/token', {
      method: 'POST',
      body: { device_id }
    });
  },

  async shareDevice(namespace, email, role) {
    return request(`/sharing/${namespace}/share`, {
      method: 'POST',
      body: { email, role }
    });
  },

  async acceptShare(token) {
    return request(`/sharing/accept/${token}`, { method: 'POST' });
  },

  async transferDevice(namespace) {
    return request(`/sharing/${namespace}/transfer`, { method: 'POST' });
  },

  async acceptTransfer(token) {
    return request(`/sharing/transfer/accept/${token}`, { method: 'POST' });
  },

  async resetDevice(namespace) {
    return request(`/user/devices/${namespace}/reset`, { method: 'POST' });
  }
};
