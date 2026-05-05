import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

const TOKEN_KEY = 'iotyk.jwt';
const MQTT_KEY = 'iotyk.mqtt';

async function secureSet(key, value) {
  try {
    await SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY
    });
  } catch {
    await AsyncStorage.setItem(key, value);
  }
}

async function secureGet(key) {
  try {
    const value = await SecureStore.getItemAsync(key);
    if (value) return value;
  } catch {
    return AsyncStorage.getItem(key);
  }
  return AsyncStorage.getItem(key);
}

async function secureDelete(key) {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    // AsyncStorage fallback below keeps logout deterministic.
  }
  await AsyncStorage.removeItem(key);
}

export async function saveSession({ token, mqtt }) {
  await secureSet(TOKEN_KEY, token);
  await secureSet(MQTT_KEY, JSON.stringify(mqtt || null));
}

export async function loadSession() {
  const [token, mqttJson] = await Promise.all([secureGet(TOKEN_KEY), secureGet(MQTT_KEY)]);
  let mqtt = null;
  try {
    mqtt = mqttJson ? JSON.parse(mqttJson) : null;
  } catch {
    mqtt = null;
  }
  return { token, mqtt };
}

export async function clearSession() {
  await Promise.all([secureDelete(TOKEN_KEY), secureDelete(MQTT_KEY)]);
}
