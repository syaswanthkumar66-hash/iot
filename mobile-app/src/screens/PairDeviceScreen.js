import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import PrimaryButton from '../components/PrimaryButton';
import { useApp } from '../store/AppContext';
import { colors } from '../theme/colors';
import { commonStyles } from '../theme/styles';

export default function PairDeviceScreen({ navigation, route }) {
  const { state } = useApp();
  const [deviceId, setDeviceId] = useState(route.params?.device_id ?? '');
  const [deviceKey, setDeviceKey] = useState(route.params?.device_key ?? '');

  const fromQR = Boolean(route.params?.device_id);
  const canSubmit = deviceId.trim().length > 0 && deviceKey.trim().length > 0;

  function submit() {
    navigation.navigate('BLEProvision', {
      device_id: deviceId.trim(),
      device_key: deviceKey.trim()
    });
  }

  if (!fromQR) {
    return (
      <SafeAreaView edges={['bottom']} style={commonStyles.screen}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.header}>
            <Text style={commonStyles.title}>Add Device</Text>
            <Text style={commonStyles.subtitle}>
              Choose how you want to find your ESP32. QR scans the label first, then Bluetooth connects to that exact device.
            </Text>
          </View>

          <View style={styles.choiceGrid}>
            <TouchableOpacity
              activeOpacity={0.82}
              style={[commonStyles.card, styles.choiceCard]}
              onPress={() => navigation.navigate('Scan')}
            >
              <View style={[styles.choiceMark, styles.qrMark]}>
                <Text style={styles.choiceMarkText}>QR</Text>
              </View>
              <Text style={styles.choiceTitle}>Scan QR Code</Text>
              <Text style={styles.choiceText}>
                Use the camera to read device ID and key, then connect over Bluetooth for WiFi setup.
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.82}
              style={[commonStyles.card, styles.choiceCard]}
              onPress={() => navigation.navigate('BLEScan')}
            >
              <View style={[styles.choiceMark, styles.bleMark]}>
                <Text style={styles.choiceMarkText}>BLE</Text>
              </View>
              <Text style={styles.choiceTitle}>Scan Bluetooth</Text>
              <Text style={styles.choiceText}>
                Ask for Bluetooth permission, find nearby IoTYK ESP32 devices, then choose one to configure.
              </Text>
            </TouchableOpacity>
          </View>

          <View style={[commonStyles.card, styles.form]}>
            <Text style={styles.sectionTitle}>Enter manually</Text>
            <Text style={commonStyles.label}>Device ID</Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="esp32-xxxx"
              placeholderTextColor={colors.muted}
              value={deviceId}
              onChangeText={setDeviceId}
              style={commonStyles.input}
            />

            <Text style={commonStyles.label}>Device Key</Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="pairing key"
              placeholderTextColor={colors.muted}
              secureTextEntry
              value={deviceKey}
              onChangeText={setDeviceKey}
              style={commonStyles.input}
            />

            {state.error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{state.error}</Text>
              </View>
            ) : null}

            <PrimaryButton label="Continue to Bluetooth Setup" disabled={!canSubmit} onPress={submit} />
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['bottom']} style={commonStyles.screen}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={commonStyles.title}>Confirm QR Device</Text>
          <Text style={commonStyles.subtitle}>
            The QR code gave us the device details. Next we will ask Bluetooth permission and connect to this ESP32.
          </Text>
        </View>

        <View style={styles.qrBadge}>
          <Text style={styles.qrBadgeText}>Filled from QR scan</Text>
        </View>

        <View style={[commonStyles.card, styles.form]}>
          <Text style={commonStyles.label}>Device ID</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="esp32-xxxx"
            placeholderTextColor={colors.muted}
            value={deviceId}
            onChangeText={setDeviceId}
            style={[commonStyles.input, styles.readonlyInput]}
            editable={false}
          />

          <Text style={commonStyles.label}>Device Key</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="pairing key"
            placeholderTextColor={colors.muted}
            value={deviceKey}
            onChangeText={setDeviceKey}
            style={[commonStyles.input, styles.readonlyInput]}
            editable={false}
          />

          {state.error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{state.error}</Text>
            </View>
          ) : null}

          <PrimaryButton label="Connect with Bluetooth" disabled={!canSubmit} onPress={submit} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 1,
    padding: 20,
    gap: 20
  },
  header: {
    gap: 6
  },
  choiceGrid: {
    gap: 12
  },
  choiceCard: {
    gap: 10,
    overflow: 'hidden'
  },
  choiceMark: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7
  },
  qrMark: {
    backgroundColor: '#1E3A5F'
  },
  bleMark: {
    backgroundColor: colors.accentSoft
  },
  choiceMarkText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '900'
  },
  choiceTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800'
  },
  choiceText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800'
  },
  qrBadge: {
    backgroundColor: colors.accentSoft,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.accent
  },
  qrBadgeText: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '700'
  },
  form: {
    gap: 12
  },
  readonlyInput: {
    opacity: 0.72,
    borderStyle: 'dashed'
  },
  errorBox: {
    backgroundColor: '#3B1A1A',
    borderRadius: 8,
    padding: 12
  },
  errorText: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: '600'
  }
});
