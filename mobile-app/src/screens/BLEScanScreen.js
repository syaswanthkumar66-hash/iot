import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import PrimaryButton from '../components/PrimaryButton';
import {
  requestBlePermissions,
  scanForAny,
  stopScan,
  waitForBluetooth
} from '../services/ble';
import { colors } from '../theme/colors';
import { commonStyles } from '../theme/styles';

export default function BLEScanScreen({ navigation }) {
  const [status, setStatus] = useState('Bluetooth permission is required to find nearby ESP32 devices.');
  const [error, setError] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [devices, setDevices] = useState([]);
  const seenIds = useRef(new Set());
  const scanTimeout = useRef(null);

  const addDevice = useCallback((device) => {
    const name = device?.name || device?.localName;
    if (!name || seenIds.current.has(name)) return;

    seenIds.current.add(name);
    setDevices((current) => [
      ...current,
      {
        id: device.id || name,
        name,
        rssi: device.rssi
      }
    ]);
  }, []);

  const startBleScan = useCallback(async () => {
    setError(null);
    setStatus('Requesting Bluetooth permission...');
    setScanning(false);
    setDevices([]);
    seenIds.current.clear();
    clearTimeout(scanTimeout.current);
    stopScan();

    try {
      const granted = await requestBlePermissions();
      if (!granted) {
        setError('Bluetooth permission denied. Please allow Bluetooth access to scan nearby devices.');
        setStatus('Bluetooth permission denied.');
        return;
      }

      setStatus('Waiting for Bluetooth to be ready...');
      await waitForBluetooth();

      setStatus('Scanning for nearby IoTYK ESP32 devices...');
      setScanning(true);
      const started = scanForAny(addDevice);
      if (!started) {
        setScanning(false);
        setError('Bluetooth is not available in this app build. Install and open the IoTYK development build, not Expo Go.');
        setStatus('Bluetooth unavailable.');
        return;
      }

      scanTimeout.current = setTimeout(() => {
        stopScan();
        setScanning(false);
        setStatus('Scan finished. Choose a device or scan again.');
      }, 15000);
    } catch (err) {
      setScanning(false);
      setError(err.message);
      setStatus('Bluetooth scan failed.');
    }
  }, [addDevice]);

  useEffect(() => {
    startBleScan();
    return () => {
      clearTimeout(scanTimeout.current);
      stopScan();
    };
  }, [startBleScan]);

  function chooseDevice(device) {
    clearTimeout(scanTimeout.current);
    stopScan();
    setScanning(false);
    navigation.navigate('BLEProvision', { device_id: device.name });
  }

  return (
    <SafeAreaView edges={['bottom']} style={commonStyles.screen}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={commonStyles.title}>Bluetooth Devices</Text>
          <Text style={commonStyles.subtitle}>
            Choose the ESP32 you want to connect. IoTYK will use Bluetooth to configure WiFi for that device.
          </Text>
        </View>

        <View style={[commonStyles.card, styles.statusCard]}>
          <View style={styles.statusRow}>
            {scanning ? <ActivityIndicator color={colors.accent} /> : <View style={styles.statusDot} />}
            <Text style={styles.statusText}>{status}</Text>
          </View>
          {error ? <Text style={commonStyles.error}>{error}</Text> : null}
          <PrimaryButton label={scanning ? 'Scanning...' : 'Scan Again'} disabled={scanning} onPress={startBleScan} />
        </View>

        <FlatList
          contentContainerStyle={styles.list}
          data={devices}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={
            <View style={[commonStyles.card, styles.empty]}>
              <Text style={styles.emptyTitle}>No ESP32 devices found yet</Text>
              <Text style={styles.emptyText}>
                Keep the device powered on and nearby. It must advertise the IoTYK BLE service.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity activeOpacity={0.82} style={[commonStyles.card, styles.deviceCard]} onPress={() => chooseDevice(item)}>
              <View>
                <Text style={styles.deviceName}>{item.name}</Text>
                <Text style={styles.deviceMeta}>{item.rssi ? `Signal ${item.rssi} dBm` : 'Tap to connect'}</Text>
              </View>
              <Text style={styles.deviceAction}>Connect</Text>
            </TouchableOpacity>
          )}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    gap: 16
  },
  header: {
    gap: 6
  },
  statusCard: {
    gap: 14
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10
  },
  statusDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.off
  },
  statusText: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20
  },
  list: {
    gap: 12,
    paddingBottom: 24
  },
  empty: {
    gap: 8,
    alignItems: 'center'
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800'
  },
  emptyText: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center'
  },
  deviceCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12
  },
  deviceName: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '800'
  },
  deviceMeta: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 3
  },
  deviceAction: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '900',
    textTransform: 'uppercase'
  }
});
