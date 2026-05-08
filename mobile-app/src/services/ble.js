import { BleManager, State } from 'react-native-ble-plx';
import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import { encode as btoa } from 'base-64';

// ─── Constants ────────────────────────────────────────────────────────────────
export const SERVICE_UUID = '12345678-1234-1234-1234-123456789abc';
export const CHAR_UUID    = 'abcd1234-5678-1234-5678-abcdef123456';
export const TOKEN_CHAR_UUID = 'abcd1234-5678-1234-5678-abcdef123457'; // Added
const SCAN_TIMEOUT_MS     = 15000;

// ─── Singleton manager ────────────────────────────────────────────────────────
let _manager = null;
let _connected = null;       // currently connected BleDevice
let _scanTimeout = null;

function bleUnavailableError() {
  return new Error(
    'Bluetooth native module is not available in this build. Use an Expo development build or a native Android/iOS build that includes react-native-ble-plx.'
  );
}

export function isBleAvailable() {
  return Boolean(NativeModules.BlePlx);
}

function manager() {
  if (!isBleAvailable()) throw bleUnavailableError();
  if (!_manager) _manager = new BleManager();
  return _manager;
}

// ─── Permissions ──────────────────────────────────────────────────────────────
export async function requestBlePermissions() {
  if (!isBleAvailable()) throw bleUnavailableError();

  if (Platform.OS === 'ios') return true;

  if (Platform.Version >= 31) {
    // Android 12+
    const grants = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
    ]);
    return Object.values(grants).every(
      (r) => r === PermissionsAndroid.RESULTS.GRANTED
    );
  }

  // Android < 12
  const result = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
  );
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

// ─── Wait for radio to be powered on ─────────────────────────────────────────
export function waitForBluetooth() {
  return new Promise((resolve, reject) => {
    const sub = manager().onStateChange((state) => {
      if (state === State.PoweredOn) {
        sub.remove();
        resolve();
      } else if (
        state === State.PoweredOff ||
        state === State.Unauthorized ||
        state === State.Unsupported
      ) {
        sub.remove();
        reject(new Error(`Bluetooth is ${state}. Please enable Bluetooth and try again.`));
      }
    }, true /* emit current state immediately */);
  });
}

// ─── Scan + connect ───────────────────────────────────────────────────────────
/**
 * Scan for a BLE device whose advertised name equals deviceId,
 * connect to it, and discover services + characteristics.
 *
 * @param {string}   deviceId       - advertised BLE name (== DEVICE_ID from QR)
 * @param {function} onStatus       - optional status string callback
 * @returns {Promise<BleDevice>}    - connected + ready device
 */
export function scanAndConnect(deviceId, onStatus) {
  return new Promise((resolve, reject) => {
    stopScan();                       // cancel any previous scan
    disconnectBle();                  // drop any previous connection

    onStatus?.(`Scanning for "${deviceId}"…`);

    _scanTimeout = setTimeout(() => {
      manager().stopDeviceScan();
      reject(new Error(`Device "${deviceId}" not found. Make sure it is powered on and nearby.`));
    }, SCAN_TIMEOUT_MS);

    manager().startDeviceScan(
      null,                           // scan all service UUIDs
      { allowDuplicates: false },
      async (error, device) => {
        if (error) {
          clearTimeout(_scanTimeout);
          reject(error);
          return;
        }

        const name = device?.name || device?.localName;
        if (name !== deviceId && !name?.startsWith(`${deviceId}-`)) return;

        // Found it
        clearTimeout(_scanTimeout);
        manager().stopDeviceScan();
        onStatus?.(`Found "${deviceId}" — connecting…`);

        try {
          const connected = await device.connect({ timeout: 10000 });
          onStatus?.('Discovering services…');
          const ready = await connected.discoverAllServicesAndCharacteristics();
          _connected = ready;
          onStatus?.('Connected');
          resolve(ready);
        } catch (err) {
          reject(new Error(`Connection failed: ${err.message}`));
        }
      }
    );
  });
}

/**
 * Start a background scan for any device advertising the IoTYK service.
 * @param {function} onFound - callback when a device is found
 */
export function scanForAny(onFound) {
  if (!isBleAvailable()) {
    console.warn(bleUnavailableError().message);
    return false;
  }

  manager().startDeviceScan(
    [SERVICE_UUID], 
    { allowDuplicates: false }, 
    (error, device) => {
      if (error) {
        console.warn('BLE scan failed:', error);
        return;
      }
      if (device) onFound(device);
    }
  );

  return true;
}

// ─── Send WiFi credentials ────────────────────────────────────────────────────
/**
 * Write "ssid,password" (base64) to the provisioning characteristic.
 */
export async function sendWifi(ssid, password) {
  if (!_connected) throw new Error('No BLE device connected.');

  const payload = `${ssid.trim()},${password}`;

  // btoa is polyfilled at the top of the file via base-64

  const base64 = btoa(unescape(encodeURIComponent(payload)));

  await _connected.writeCharacteristicWithResponseForService(
    SERVICE_UUID,
    CHAR_UUID,
    base64
  );
}

// ─── Send Pairing Token ───────────────────────────────────────────────────────
/**
 * Write token to the new token characteristic.
 */
export async function sendPairingToken(token) {
  if (!_connected) throw new Error('No BLE device connected.');

  const base64 = btoa(unescape(encodeURIComponent(token)));

  await _connected.writeCharacteristicWithResponseForService(
    SERVICE_UUID,
    TOKEN_CHAR_UUID,
    base64
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
export function stopScan() {
  clearTimeout(_scanTimeout);
  _scanTimeout = null;
  try { manager().stopDeviceScan(); } catch { /* ignore */ }
}

export async function disconnectBle() {
  if (_connected) {
    try { await _connected.cancelConnection(); } catch { /* ignore */ }
    _connected = null;
  }
}

export function destroyBle() {
  stopScan();
  disconnectBle();
  try { _manager?.destroy(); } catch { /* ignore */ }
  _manager = null;
}
