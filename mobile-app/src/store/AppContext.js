import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, onApiTrace, onUnauthorized, setAuthToken } from '../services/api';
import { clearSession, loadSession, saveSession } from '../services/auth';
import {
  connectMQTT,
  disconnectMQTT,
  onMQTTError,
  onMQTTStatus,
  publishCommand,
  subscribeDevice as subscribeMQTTDevice
} from '../services/mqtt';
import { localDeviceApi } from '../services/local';
import { DEVICE_STALE_CHECK_MS } from '../config/env';
import { getDeviceStatus, mergeDeviceState, normalizeDevice } from '../utils/device';

const AppContext = createContext(null);
const DEVICE_CACHE_KEY = 'iotyk.devices';

const initialState = {
  booting: true,
  token: null,
  mqttCredentials: null,
  devices: [],
  loadingDevices: false,
  authLoading: false,
  pairLoading: false,
  mqttStatus: 'offline',
  error: null,
  loginTrace: []   // [{step, method, path, url, status, latencyMs, requestBody, responseBody}]
};

function reducer(state, action) {
  switch (action.type) {
    case 'BOOT_DONE':
      return { ...state, booting: false, token: action.token, mqttCredentials: action.mqttCredentials };
    case 'AUTH_LOADING':
      return { ...state, authLoading: action.value, error: null, loginTrace: [] };
    case 'LOGIN_TRACE_APPEND':
      return { ...state, loginTrace: [...state.loginTrace, action.entry] };
    case 'LOGIN_SUCCESS':
      return {
        ...state,
        token: action.token,
        mqttCredentials: action.mqttCredentials,
        authLoading: false,
        error: null
      };
    case 'LOGOUT':
      return { ...initialState, booting: false };
    case 'ERROR':
      return { ...state, error: action.message, authLoading: false, loadingDevices: false, pairLoading: false };
    case 'LOAD_DEVICES':
      return { ...state, loadingDevices: true, error: null };
    case 'SET_DEVICES':
      return { ...state, devices: action.devices, loadingDevices: false, error: null };
    case 'UPSERT_DEVICE':
      return { ...state, devices: upsertDevice(state.devices, action.device), pairLoading: false, error: null };
    case 'PAIR_LOADING':
      return { ...state, pairLoading: action.value, error: null };
    case 'MQTT_STATUS':
      return { ...state, mqttStatus: action.status };
    case 'DEVICE_STATE':
      return {
        ...state,
        devices: state.devices.map((device) =>
          device.namespace === action.namespace ? mergeDeviceState(device, action.state) : device
        )
      };
    case 'DEVICE_LINK_MODE':
      return {
        ...state,
        devices: state.devices.map((device) =>
          device.namespace === action.namespace
            ? {
              ...device,
              connectionMode: action.mode,
              state: { ...(device.state || {}), connection_mode: action.mode }
            }
            : device
        )
      };
    case 'CLEAR_DEVICE_PENDING':
      return {
        ...state,
        devices: state.devices.map((device) =>
          device.namespace === action.namespace
            ? { ...device, state: { ...(device.state || {}), pending: false } }
            : device
        )
      };
    case 'MARK_STALE':
      return {
        ...state,
        devices: state.devices.map((device) => {
          const status = getDeviceStatus(device.lastSeen);
          const online = status !== 'offline';
          return device.status === status && device.online === online && device.offline === !online
            ? device
            : { ...device, status, online, offline: !online };
        })
      };
    default:
      return state;
  }
}

export async function cacheDevices(devices) {
  await AsyncStorage.setItem(DEVICE_CACHE_KEY, JSON.stringify(devices));
}

export async function loadCachedDevices() {
  const cached = await AsyncStorage.getItem(DEVICE_CACHE_KEY);
  if (!cached) return [];

  try {
    const devices = JSON.parse(cached);
    return Array.isArray(devices) ? devices.map(normalizeDevice).filter((device) => device.namespace) : [];
  } catch {
    await AsyncStorage.removeItem(DEVICE_CACHE_KEY);
    return [];
  }
}

function upsertDevice(devices, next) {
  const normalized = normalizeDevice(next);
  const exists = devices.some((device) => device.namespace === normalized.namespace);
  if (!exists) return [normalized, ...devices];
  return devices.map((device) => (device.namespace === normalized.namespace ? { ...device, ...normalized } : device));
}

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const commandTimers = useRef(new Map());

  const logout = useCallback(async () => {
    disconnectMQTT();
    setAuthToken(null);
    await clearSession();
    dispatch({ type: 'LOGOUT' });
  }, []);

  const refreshDevices = useCallback(async () => {
    dispatch({ type: 'LOAD_DEVICES' });
    try {
      const devices = await api.getDevices();
      await cacheDevices(devices);
      dispatch({ type: 'SET_DEVICES', devices });
    } catch (error) {
      dispatch({ type: 'ERROR', message: error.message });
    }
  }, []);

  const login = useCallback(async (email, password) => {
    dispatch({ type: 'AUTH_LOADING', value: true });

    // Capture every API call made during the login flow.
    onApiTrace((entry) => {
      const step = entry.path === '/auth/login' ? 'Auth — POST /auth/login'
        : entry.path === '/user/devices' ? 'Devices — GET /user/devices'
        : `${entry.method} ${entry.path}`;
      dispatch({ type: 'LOGIN_TRACE_APPEND', entry: { step, ...entry } });
    });

    try {
      const response = await api.login(email.trim(), password);
      const token = response?.token || response?.data?.token;
      const mqttCredentials = response?.mqtt || response?.data?.mqtt;

      if (!token) throw new Error('Login response did not include a JWT token.');
      if (!mqttCredentials?.url || !mqttCredentials?.username || !mqttCredentials?.password) {
        throw new Error('Invalid MQTT config.');
      }

      await saveSession({ token, mqtt: mqttCredentials });
      setAuthToken(token);
      await connectMQTT(mqttCredentials);
      dispatch({ type: 'LOGIN_SUCCESS', token, mqttCredentials });

      const devices = await api.getDevices();
      await cacheDevices(devices);
      dispatch({ type: 'SET_DEVICES', devices });
    } catch (error) {
      dispatch({ type: 'ERROR', message: error.message });
    } finally {
      // Stop tracing after the login flow completes.
      onApiTrace(null);
    }
  }, []);

  const register = useCallback(async (name, email, password) => {
    dispatch({ type: 'AUTH_LOADING', value: true });
    
    // Trace register flow too
    onApiTrace((entry) => {
      const step = entry.path === '/auth/register' ? 'Auth — POST /auth/register'
        : `${entry.method} ${entry.path}`;
      dispatch({ type: 'LOGIN_TRACE_APPEND', entry: { step, ...entry } });
    });

    try {
      // 1. Create account (hashed securely on backend)
      await api.register(email.trim(), password, name.trim());
      
      // 2. Automatically log them in
      await login(email, password);
    } catch (error) {
      dispatch({ type: 'ERROR', message: error.message });
    } finally {
      onApiTrace(null);
    }
  }, [login]);

  const pairDevice = useCallback(async (deviceId, deviceKey) => {
    dispatch({ type: 'PAIR_LOADING', value: true });
    try {
      const device = await api.addDevice(deviceId.trim(), deviceKey.trim());
      if (device?.namespace) {
        const cachedDevices = await loadCachedDevices();
        await cacheDevices(upsertDevice(cachedDevices, device));
        dispatch({ type: 'UPSERT_DEVICE', device });
      } else {
        await refreshDevices();
      }
      dispatch({ type: 'PAIR_LOADING', value: false });
      return true;
    } catch (error) {
      dispatch({ type: 'ERROR', message: error.message });
      return false;
    }
  }, [refreshDevices]);

  const sendDeviceCommand = useCallback(async (namespace, command) => {
    const device = state.devices.find((item) => item.namespace === namespace);

    if (device?.device_id) {
      try {
        const token = await localDeviceApi.getToken(device.device_id);
        if (token) {
          const response = await localDeviceApi.sendCommandWs(device.device_id, command, token);
          dispatch({ type: 'DEVICE_LINK_MODE', namespace, mode: 'local' });
          return { mode: 'local', response };
        }
      } catch {
        // Fall back to MQTT when the phone is not on the same LAN as the device.
      }
    }

    publishCommand(`device/${namespace}`, command);
    dispatch({ type: 'DEVICE_LINK_MODE', namespace, mode: 'internet' });
    return { mode: 'internet', response: null };
  }, [state.devices]);

  const togglePower = useCallback(async (namespace, enabled) => {
    const existingTimer = commandTimers.current.get(namespace);
    if (existingTimer) {
      return;
    }

    const command = { power: enabled ? 'on' : 'off' };
    const result = await sendDeviceCommand(namespace, command);

    if (result.mode === 'local' && result.response) {
      dispatch({ type: 'DEVICE_STATE', namespace, state: { ...result.response, pending: false, connection_mode: 'local' } });
      return;
    }

    dispatch({ type: 'DEVICE_STATE', namespace, state: { power: enabled ? 'on' : 'off', pending: true, connection_mode: 'internet' } });

    const timer = setTimeout(() => {
      commandTimers.current.delete(namespace);
      dispatch({ type: 'CLEAR_DEVICE_PENDING', namespace });
    }, 3000);
    commandTimers.current.set(namespace, timer);
  }, [sendDeviceCommand]);

  const toggleRelay = useCallback(async (namespace, relayId, enabled) => {
    const existingTimer = commandTimers.current.get(namespace);
    if (existingTimer) {
      return;
    }

    const command = { relay: relayId, power: enabled ? 'on' : 'off' };
    const result = await sendDeviceCommand(namespace, command);

    if (result.mode === 'local' && result.response) {
      dispatch({ type: 'DEVICE_STATE', namespace, state: { ...result.response, pending: false, connection_mode: 'local' } });
      return;
    }

    const device = state.devices.find((item) => item.namespace === namespace);
    const relays = Array.isArray(device?.state?.relays)
      ? device.state.relays.map((relay) =>
        Number(relay.id) === Number(relayId) ? { ...relay, power: enabled ? 'on' : 'off' } : relay
      )
      : undefined;
    const nextPower = relays?.some((relay) => relay.power === 'on') ? 'on' : 'off';

    dispatch({
      type: 'DEVICE_STATE',
      namespace,
      state: { power: nextPower, ...(relays ? { relays } : {}), pending: true, connection_mode: 'internet' }
    });

    const timer = setTimeout(() => {
      commandTimers.current.delete(namespace);
      dispatch({ type: 'CLEAR_DEVICE_PENDING', namespace });
    }, 3000);
    commandTimers.current.set(namespace, timer);
  }, [sendDeviceCommand, state.devices]);

  const configureWifi = useCallback(async (namespace, ssid, password) => {
    const cleanSsid = String(ssid || '').trim();
    if (!cleanSsid) throw new Error('WiFi SSID is required.');

    const result = await sendDeviceCommand(namespace, {
      wifi: {
        ssid: cleanSsid,
        password: String(password || '')
      }
    });

    dispatch({
      type: 'DEVICE_STATE',
      namespace,
      state: {
        wifi_configured: true,
        wifi_ssid: cleanSsid,
        pending: result.mode !== 'local',
        connection_mode: result.mode
      }
    });

    return result;
  }, [sendDeviceCommand]);

  const subscribeDevice = useCallback((namespace) => subscribeMQTTDevice(namespace, (state) => {
    const timer = commandTimers.current.get(namespace);
    if (timer) {
      clearTimeout(timer);
      commandTimers.current.delete(namespace);
    }
    dispatch({ type: 'DEVICE_STATE', namespace, state: { ...state, pending: false, connection_mode: 'internet' } });
  }), []);

  useEffect(() => {
    let mounted = true;

    async function boot() {
      const session = await loadSession();
      if (!mounted) return;

      setAuthToken(session.token);
      if (session.token && session.mqtt) {
        // Retry MQTT connect up to 3 times; broker may be briefly unavailable on startup.
        let lastError;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            await connectMQTT(session.mqtt);
            lastError = null;
            break;
          } catch (error) {
            lastError = error;
            if (attempt < 3) await new Promise((r) => setTimeout(r, 2000));
          }
        }
        if (lastError) {
          dispatch({ type: 'ERROR', message: lastError.message });
        }
      }
      dispatch({ type: 'BOOT_DONE', token: session.token, mqttCredentials: session.mqtt });

      const cachedDevices = await loadCachedDevices();
      if (!mounted || !cachedDevices.length) return;
      dispatch({ type: 'SET_DEVICES', devices: cachedDevices });
    }

    onUnauthorized(logout);
    boot();

    return () => {
      mounted = false;
    };
  }, [logout]);

  useEffect(() => {
    if (state.token) refreshDevices();
  }, [refreshDevices, state.token]);

  useEffect(() => {
    const unsubscribeStatus = onMQTTStatus((status) => {
      dispatch({ type: 'MQTT_STATUS', status });
    });
    const unsubscribeError = onMQTTError((error) => {
      dispatch({ type: 'ERROR', message: error?.message || 'MQTT connection error' });
    });

    return () => {
      unsubscribeStatus();
      unsubscribeError();
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => dispatch({ type: 'MARK_STALE' }), DEVICE_STALE_CHECK_MS);
    return () => clearInterval(timer);
  }, []);

  // --- MQTT Auto Refresh ---
  useEffect(() => {
    if (!state.token || !state.mqttCredentials?.expiresAt) return;

    // Set up a timer to refresh MQTT credentials 5 minutes before they expire
    const expiresAt = new Date(state.mqttCredentials.expiresAt).getTime();
    const timeUntilExpiry = expiresAt - Date.now();
    const refreshTime = Math.max(0, timeUntilExpiry - 5 * 60 * 1000); // 5 mins before

    const timeout = setTimeout(async () => {
      try {
        const response = await api.mqttRefresh();
        if (response?.mqtt) {
          await saveSession({ token: state.token, mqtt: response.mqtt });
          await connectMQTT(response.mqtt);
          dispatch({ type: 'LOGIN_SUCCESS', token: state.token, mqttCredentials: response.mqtt });
        }
      } catch (e) {
        console.warn('Failed to auto-refresh MQTT credentials:', e);
      }
    }, refreshTime);

    return () => clearTimeout(timeout);
  }, [state.token, state.mqttCredentials]);

  const value = useMemo(() => ({
    state,
    actions: {
      login,
      register,
      logout,
      refreshDevices,
      pairDevice,
      togglePower,
      toggleRelay,
      configureWifi,
      subscribeDevice
    }
  }), [login, register, logout, pairDevice, refreshDevices, state, subscribeDevice, togglePower, toggleRelay, configureWifi]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used inside AppProvider');
  return context;
}
