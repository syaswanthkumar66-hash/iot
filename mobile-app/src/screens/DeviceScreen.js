import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';
import PrimaryButton from '../components/PrimaryButton';
import ToggleSwitch from '../components/ToggleSwitch';
import { useApp } from '../store/AppContext';
import { colors } from '../theme/colors';
import { commonStyles } from '../theme/styles';
import { formatLastSeen, readGps } from '../utils/device';

export default function DeviceScreen({ route }) {
  const { state, actions } = useApp();
  const device = state.devices.find((item) => item.namespace === route.params?.namespace);
  const gps = readGps(device?.gps);
  const relays = Array.isArray(device?.state?.relays) ? device.state.relays : [];
  const [wifiSsid, setWifiSsid] = useState('');
  const [wifiPass, setWifiPass] = useState('');
  const [wifiSaving, setWifiSaving] = useState(false);

  useEffect(() => {
    if (!device?.namespace) return undefined;
    return actions.subscribeDevice(device.namespace);
  }, [actions.subscribeDevice, device?.namespace]);

  if (!device) {
    return (
      <SafeAreaView style={commonStyles.screen}>
        <View style={[commonStyles.container, styles.center]}>
          <Text style={commonStyles.error}>Device is no longer available.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const offline = device.offline || !device.online;
  const delayed = device.status === 'delay';
  const pending = Boolean(device.state?.pending);
  const statusColor = offline ? colors.danger : delayed ? colors.warning : colors.accent;
  const statusLabel = offline ? 'Device Offline' : delayed ? 'Delayed' : 'Online';
  const connectionLabel = device.connectionMode === 'local'
    ? 'Local WiFi'
    : device.connectionMode === 'internet'
      ? 'Internet MQTT'
      : 'Waiting';
  const connectionColor = device.connectionMode === 'local' ? colors.accent : device.connectionMode === 'internet' ? colors.warning : colors.muted;

  function toggle(value) {
    if (pending) return;
    actions.togglePower(device.namespace, value).catch((error) => {
      Alert.alert('MQTT unavailable', error.message);
    });
  }

  function toggleRelay(relayId, value) {
    if (pending) return;
    actions.toggleRelay(device.namespace, relayId, value).catch((error) => {
      Alert.alert('Device unavailable', error.message);
    });
  }

  async function saveWifi() {
    if (!wifiSsid.trim()) {
      Alert.alert('Missing SSID', 'Enter the WiFi network name.');
      return;
    }

    setWifiSaving(true);
    try {
      const result = await actions.configureWifi(device.namespace, wifiSsid, wifiPass);
      const path = result.mode === 'local' ? 'local WiFi' : 'internet MQTT';
      Alert.alert('WiFi sent', `Credentials were sent by ${path}. The ESP32 will restart and connect to the new network.`);
      setWifiPass('');
    } catch (error) {
      Alert.alert('WiFi setup failed', error.message);
    } finally {
      setWifiSaving(false);
    }
  }

  return (
    <SafeAreaView edges={['bottom']} style={commonStyles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={styles.heroText}>
            <Text style={commonStyles.title} numberOfLines={2}>{device.name}</Text>
            <View style={styles.heroMeta}>
              <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
              <Text style={[styles.statusText, { color: connectionColor }]}>{connectionLabel}</Text>
            </View>
          </View>
          <ToggleSwitch value={device.power === 'on'} disabled={offline || pending} onValueChange={toggle} />
        </View>

        <View style={styles.grid}>
          <InfoTile label="Power" value={(device.power || 'off').toUpperCase()} highlight={device.power === 'on'} />
          <InfoTile label="Connection" value={connectionLabel} highlight={device.connectionMode === 'local'} />
          <InfoTile label="Firmware" value={device.firmware || 'Unknown'} />
          <InfoTile label="Last seen" value={formatLastSeen(device.lastSeen)} wide />
        </View>

        {relays.length > 1 ? (
          <View style={[commonStyles.card, styles.relaysCard]}>
            <Text style={styles.sectionTitle}>Switches</Text>
            {relays.map((relay) => (
              <View key={relay.id} style={styles.relayRow}>
                <View style={styles.relayText}>
                  <Text style={styles.relayTitle}>Switch {relay.id}</Text>
                  <Text style={commonStyles.label}>{relay.pin ? `GPIO ${relay.pin}` : 'Waiting for pin'}</Text>
                </View>
                <ToggleSwitch
                  value={relay.power === 'on'}
                  disabled={offline || pending}
                  onValueChange={(value) => toggleRelay(relay.id, value)}
                />
              </View>
            ))}
          </View>
        ) : null}

        {gps ? (
          <View style={styles.mapWrap}>
            <MapView
              style={styles.map}
              initialRegion={{
                latitude: gps.latitude,
                longitude: gps.longitude,
                latitudeDelta: 0.01,
                longitudeDelta: 0.01
              }}
            >
              <Marker coordinate={gps} title={device.name} />
            </MapView>
          </View>
        ) : null}

        <View style={[commonStyles.card, styles.wifiCard]}>
          <Text style={styles.sectionTitle}>WiFi Setup</Text>
          <Text style={commonStyles.label}>Network SSID</Text>
          <TextInput
            style={commonStyles.input}
            placeholder="Home WiFi"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            value={wifiSsid}
            onChangeText={setWifiSsid}
          />
          <Text style={commonStyles.label}>Password</Text>
          <TextInput
            style={commonStyles.input}
            placeholder="WiFi password"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            value={wifiPass}
            onChangeText={setWifiPass}
          />
          <PrimaryButton
            label="Send WiFi to ESP32"
            loading={wifiSaving}
            disabled={!wifiSsid.trim() || wifiSaving}
            onPress={saveWifi}
          />
        </View>

        <View style={[commonStyles.card, styles.stateCard]}>
          <Text style={styles.sectionTitle}>State JSON</Text>
          <Text style={styles.json}>{JSON.stringify(device.state || {}, null, 2)}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function InfoTile({ label, value, highlight, wide }) {
  return (
    <View style={[commonStyles.card, styles.tile, wide && styles.wide]}>
      <Text style={commonStyles.label}>{label}</Text>
      <Text style={[styles.tileValue, highlight && styles.highlight]} numberOfLines={2}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 20,
    gap: 16
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center'
  },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16
  },
  heroText: {
    flex: 1,
    minWidth: 0
  },
  heroMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 6
  },
  statusText: {
    fontSize: 13,
    fontWeight: '700'
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12
  },
  tile: {
    flexGrow: 1,
    flexBasis: '47%',
    gap: 8,
    minHeight: 94
  },
  wide: {
    flexBasis: '100%'
  },
  tileValue: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0
  },
  highlight: {
    color: colors.accent
  },
  mapWrap: {
    height: 230,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border
  },
  map: {
    flex: 1
  },
  stateCard: {
    gap: 12
  },
  relaysCard: {
    gap: 14
  },
  wifiCard: {
    gap: 12
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800'
  },
  json: {
    color: colors.muted,
    fontFamily: 'monospace',
    fontSize: 13,
    lineHeight: 19
  },
  relayRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 12
  },
  relayText: {
    flex: 1,
    minWidth: 0
  },
  relayTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800'
  }
});
