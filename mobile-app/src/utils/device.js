import { DEVICE_STALE_MS, DEVICE_WARNING_MS } from '../config/env';

export function normalizeDevice(raw) {
  const namespace = raw.namespace || raw.device_namespace || raw.topic_namespace || raw.id || raw.device_id;
  const state = normalizeState(raw.current_state || raw.state || raw.last_state || {});
  const lastSeen = raw.last_seen || raw.lastSeen || raw.updated_at || state.last_seen || state.lastSeen || null;
  const relayCount = normalizeRelayCount(raw.relay_count ?? raw.relayCount ?? state.relay_count ?? state.relayCount ?? state.relays?.length ?? 1);
  const relays = normalizeRelays(state.relays, relayCount);
  const normalizedState = { ...state, relay_count: relayCount, relays };

  const status = getDeviceStatus(lastSeen, raw.online ?? state.online, raw.offline ?? state.offline);
  const online = status !== 'offline';

  return {
    id: String(raw.id || raw._id || raw.device_id || namespace),
    device_id: raw.device_id || raw.deviceId || raw.id || null,
    namespace: String(namespace),
    name: raw.name || raw.device_name || raw.label || `Device ${namespace}`,
    backendStatus: raw.status || null,
    firmware: raw.firmware || raw.firmware_version || raw.firmwareVersion || state.firmware || state.firmware_version || null,
    relayCount,
    connectionMode: raw.connectionMode || state.connection_mode || state.connectionMode || null,
    lastSeen,
    online,
    offline: !online,
    status,
    power: normalizePower(raw.power ?? state.power),
    gps: raw.gps || state.gps || state.location || null,
    state: normalizedState
  };
}

export function normalizeState(payload) {
  if (!payload || typeof payload !== 'object') return {};
  return { ...payload };
}

export function mergeDeviceState(device, incoming) {
  const state = normalizeState(incoming);
  const isPendingCommand = state.pending === true;
  const payloadTime = getPayloadTime(state);
  const currentTime = parseLastSeen(device.lastSeen);
  if (payloadTime && currentTime && payloadTime < currentTime) {
    return device;
  }
  const lastSeen = state.last_seen || state.lastSeen || (isPendingCommand ? device.lastSeen : new Date().toISOString());
  const relayCount = normalizeRelayCount(state.relay_count ?? state.relayCount ?? device.relayCount ?? device.state?.relay_count ?? state.relays?.length ?? 1);
  const relays = normalizeRelays(state.relays ?? device.state?.relays, relayCount);
  const mergedState = { ...(device.state || {}), ...state, relay_count: relayCount, relays };
  if (!state.pending) mergedState.pending = false;
  const power = normalizePower(state.power ?? device.power);
  const status = isPendingCommand ? device.status : getDeviceStatus(lastSeen, state.online, state.offline);

  return {
    ...device,
    state: mergedState,
    relayCount,
    connectionMode: state.connection_mode || state.connectionMode || device.connectionMode,
    lastSeen,
    online: isPendingCommand ? device.online : status !== 'offline',
    offline: isPendingCommand ? device.offline : status === 'offline',
    status,
    power,
    firmware: state.firmware || state.firmware_version || device.firmware,
    gps: state.gps || state.location || device.gps
  };
}

export function normalizeRelayCount(value) {
  const count = Number(value);
  if (!Number.isFinite(count)) return 1;
  return Math.min(Math.max(Math.floor(count), 1), 8);
}

export function normalizeRelays(value, relayCount = 1) {
  const count = normalizeRelayCount(relayCount);
  const incoming = Array.isArray(value) ? value : [];
  return Array.from({ length: count }, (_, index) => {
    const id = index + 1;
    const found = incoming.find((relay) => Number(relay?.id ?? relay?.relay ?? relay?.switch) === id) || {};
    return {
      id,
      pin: found.pin ?? null,
      power: normalizePower(found.power)
    };
  });
}

function getPayloadTime(state) {
  const value = state.ts || state.timestamp || state.time;
  if (!value) return 0;
  if (typeof value === 'number') {
    return value < 10000000000 ? value * 1000 : value;
  }
  return parseLastSeen(value);
}

export function normalizePower(value) {
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  if (typeof value === 'number') return value > 0 ? 'on' : 'off';
  const text = String(value || 'off').toLowerCase();
  return text === 'on' || text === '1' || text === 'true' ? 'on' : 'off';
}

export function isFresh(value) {
  if (!value) return false;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && Date.now() - time < DEVICE_STALE_MS;
}

export function getDeviceStatus(lastSeen, explicitOnline, explicitOffline) {
  if (explicitOffline !== undefined && Boolean(explicitOffline)) return 'offline';
  if (explicitOnline === true) return 'online';
  if (explicitOnline === false) return 'offline';

  const time = parseLastSeen(lastSeen);
  if (!time) return 'offline';

  const diff = Date.now() - time;
  if (diff > DEVICE_STALE_MS) return 'offline';
  if (diff > DEVICE_WARNING_MS) return 'delay';
  return 'online';
}

export function parseLastSeen(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

export function formatLastSeen(value) {
  if (!value) return 'No recent data';
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return 'No recent data';
  return time.toLocaleString();
}

export function readGps(gps) {
  if (!gps || typeof gps !== 'object') return null;
  const latitude = Number(gps.latitude ?? gps.lat);
  const longitude = Number(gps.longitude ?? gps.lng ?? gps.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}
