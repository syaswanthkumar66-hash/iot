import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  disconnectBle,
  requestBlePermissions,
  scanAndConnect,
  sendWifi,
  sendPairingToken,
  stopScan,
  waitForBluetooth
} from '../services/ble';
import { api } from '../services/api';
import { localDeviceApi } from '../services/local';
import { useApp } from '../store/AppContext';
import { colors } from '../theme/colors';
import { commonStyles } from '../theme/styles';

// ─── Step constants ───────────────────────────────────────────────────────────
const STEP = { PERMISSION: 0, SCANNING: 1, WIFI_FORM: 2, SENDING: 3, SUCCESS: 4, ERROR: 5 };

// ─── Pulsing ring animation ───────────────────────────────────────────────────
function PulseRing({ color = colors.accent }) {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(scale,   { toValue: 1.55, duration: 900, useNativeDriver: true, easing: Easing.out(Easing.ease) }),
          Animated.timing(scale,   { toValue: 1,    duration: 900, useNativeDriver: true, easing: Easing.in(Easing.ease) })
        ]),
        Animated.sequence([
          Animated.timing(opacity, { toValue: 0,    duration: 900, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0.6,  duration: 900, useNativeDriver: true })
        ])
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [scale, opacity]);

  return (
    <View style={pulseStyles.wrap}>
      <Animated.View style={[pulseStyles.ring, { borderColor: color, transform: [{ scale }], opacity }]} />
      <View style={[pulseStyles.core, { backgroundColor: color }]} />
    </View>
  );
}

const pulseStyles = StyleSheet.create({
  wrap: { width: 72, height: 72, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: 72, height: 72, borderRadius: 36, borderWidth: 2 },
  core: { width: 28, height: 28, borderRadius: 14 }
});

// ─── Step indicator ───────────────────────────────────────────────────────────
function StepBar({ step }) {
  const steps = ['Scan', 'Connect', 'Configure', 'Done'];
  const active = [STEP.SCANNING, STEP.WIFI_FORM, STEP.SENDING, STEP.SUCCESS];
  return (
    <View style={stepStyles.row}>
      {steps.map((label, i) => {
        const done = step > active[i];
        const current = step === active[i];
        return (
          <View key={label} style={stepStyles.item}>
            <View style={[stepStyles.dot, current && stepStyles.dotActive, done && stepStyles.dotDone]}>
              <Text style={[stepStyles.dotText, (current || done) && stepStyles.dotTextActive]}>
                {done ? '✓' : i + 1}
              </Text>
            </View>
            <Text style={[stepStyles.label, (current || done) && stepStyles.labelActive]}>{label}</Text>
            {i < steps.length - 1 && (
              <View style={[stepStyles.line, done && stepStyles.lineDone]} />
            )}
          </View>
        );
      })}
    </View>
  );
}

const stepStyles = StyleSheet.create({
  row:          { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', gap: 0 },
  item:         { alignItems: 'center', width: 72 },
  dot:          { width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  dotActive:    { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  dotDone:      { borderColor: colors.accent, backgroundColor: colors.accent },
  dotText:      { color: colors.muted, fontSize: 11, fontWeight: '800' },
  dotTextActive:{ color: colors.text },
  label:        { color: colors.muted, fontSize: 10, fontWeight: '700', marginTop: 4, textAlign: 'center' },
  labelActive:  { color: colors.text },
  line:         { position: 'absolute', top: 14, left: 50, width: 22, height: 1.5, backgroundColor: colors.border },
  lineDone:     { backgroundColor: colors.accent }
});

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function BLEProvisionScreen({ navigation, route }) {
  const { device_id, device_key } = route.params ?? {};
  const { actions } = useApp();

  const [step, setStep]         = useState(STEP.PERMISSION);
  const [statusText, setStatus] = useState('Requesting Bluetooth permissions…');
  const [ssid, setSsid]         = useState('');
  const [wifiPass, setWifiPass] = useState('');
  const [error, setError]       = useState(null);

  // Abort controller for cleanup on unmount
  const aborted = useRef(false);

  // ── Boot: permissions → BT state → scan ──────────────────────────────────
  useEffect(() => {
    aborted.current = false;

    async function provision() {
      // 1. Permissions
      let granted = false;
      try {
        granted = await requestBlePermissions();
      } catch (err) {
        if (aborted.current) return;
        setError(err.message);
        setStep(STEP.ERROR);
        return;
      }

      if (aborted.current) return;
      if (!granted) {
        setError('Bluetooth permissions denied. Please allow Bluetooth access in Settings.');
        setStep(STEP.ERROR);
        return;
      }

      // 2. Wait for Bluetooth radio
      setStatus('Waiting for Bluetooth to be ready…');
      try {
        await waitForBluetooth();
      } catch (err) {
        if (aborted.current) return;
        setError(err.message);
        setStep(STEP.ERROR);
        return;
      }

      if (aborted.current) return;

      // 3. Scan + connect
      setStep(STEP.SCANNING);
      try {
        await scanAndConnect(device_id, (msg) => {
          if (!aborted.current) setStatus(msg);
        });
      } catch (err) {
        if (aborted.current) return;
        setError(err.message);
        setStep(STEP.ERROR);
        return;
      }

      if (aborted.current) return;
      setStep(STEP.WIFI_FORM);
    }

    provision();

    return () => {
      aborted.current = true;
      stopScan();
    };
  }, [device_id]);

  // ── Cleanup on leave ────────────────────────────────────────────────────────
  useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', () => {
      aborted.current = true;
      stopScan();
      disconnectBle();
    });
    return unsub;
  }, [navigation]);

  // ── Send WiFi credentials ───────────────────────────────────────────────────
  async function handleSendWifi() {
    if (!ssid.trim()) {
      Alert.alert('Missing SSID', 'Please enter your WiFi network name.');
      return;
    }
    setStep(STEP.SENDING);
    setStatus('Pairing device with your account...');

    // Auto-pair via REST API using QR credentials before WiFi is sent,
    // while the BLE connection is still available for the secure payload.
    if (device_id && device_key) {
      try {
        setStatus('Getting pairing token and initial credentials...');
        const tokenRes = await api.getPairingToken(device_id);
        if (tokenRes?.token && tokenRes?.temp_mqtt) {
           setStatus('Sending secure payload to device...');
           // Bundle token and MQTT credentials into a single JSON payload
           const payload = JSON.stringify({
             token: tokenRes.token,
             mqtt: {
               u: tokenRes.temp_mqtt.username,
               p: tokenRes.temp_mqtt.password
             }
           });
           await sendPairingToken(payload);
           await localDeviceApi.saveToken(device_id, tokenRes.token);
        }

        setStatus('Registering device to your account...');
        await actions.pairDevice(device_id, device_key);
      } catch (err) {
        // Pairing may already be done or fail gracefully; proceed to dashboard
        console.log('Pairing step error (may be safe to ignore):', err);
      }
    }

    try {
      setStatus('Sending WiFi credentials via Bluetooth...');
      await sendWifi(ssid, wifiPass);
    } catch (err) {
      setError(`Failed to send WiFi: ${err.message}`);
      setStep(STEP.ERROR);
      return;
    }

    // Disconnect BLE; device will now connect via WiFi.
    await disconnectBle();
    setStatus('WiFi sent. Device will use local network first, then MQTT when remote.');

    setStep(STEP.SUCCESS);
  }

  // ── Retry ───────────────────────────────────────────────────────────────────
  function retry() {
    setError(null);
    setSsid('');
    setWifiPass('');
    setStep(STEP.PERMISSION);
    setStatus('Requesting Bluetooth permissions…');
    aborted.current = false;
    // Re-trigger effect by navigating back + forward (or just restart logic):
    navigation.replace('BLEProvision', route.params);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView edges={['bottom']} style={commonStyles.screen}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={bleStyles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <View style={bleStyles.header}>
            <Text style={commonStyles.title}>WiFi Setup</Text>
            <Text style={commonStyles.subtitle}>
              Connecting <Text style={{ color: colors.accent }}>{device_id}</Text> to your network
            </Text>
          </View>

          {/* Step bar */}
          {step !== STEP.PERMISSION && step !== STEP.ERROR && (
            <StepBar step={step} />
          )}

          {/* ── SCANNING ── */}
          {(step === STEP.PERMISSION || step === STEP.SCANNING) && (
            <View style={bleStyles.centeredCard}>
              <PulseRing color={colors.accent} />
              <Text style={bleStyles.statusText}>{statusText}</Text>
              <Text style={bleStyles.hintText}>
                Make sure "{device_id}" is powered on and within 10m
              </Text>
            </View>
          )}

          {/* ── WIFI FORM ── */}
          {step === STEP.WIFI_FORM && (
            <View style={[commonStyles.card, bleStyles.form]}>
              <View style={bleStyles.connectedBadge}>
                <View style={bleStyles.connectedDot} />
                <Text style={bleStyles.connectedText}>Device connected via Bluetooth</Text>
              </View>

              <Text style={commonStyles.label}>WiFi Network (SSID)</Text>
              <TextInput
                style={commonStyles.input}
                placeholder="MyHomeNetwork"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
                value={ssid}
                onChangeText={setSsid}
              />

              <Text style={commonStyles.label}>WiFi Password</Text>
              <TextInput
                style={commonStyles.input}
                placeholder="Password"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                value={wifiPass}
                onChangeText={setWifiPass}
              />

              <TouchableOpacity
                style={[commonStyles.button, !ssid.trim() && { opacity: 0.45 }]}
                activeOpacity={0.8}
                disabled={!ssid.trim()}
                onPress={handleSendWifi}
              >
                <Text style={commonStyles.buttonText}>Send to Device</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ── SENDING ── */}
          {step === STEP.SENDING && (
            <View style={bleStyles.centeredCard}>
              <ActivityIndicator size="large" color={colors.accent} />
              <Text style={bleStyles.statusText}>{statusText}</Text>
            </View>
          )}

          {/* ── SUCCESS ── */}
          {step === STEP.SUCCESS && (
            <View style={bleStyles.centeredCard}>
              <View style={bleStyles.successCircle}>
                <Text style={bleStyles.successIcon}>✓</Text>
              </View>
              <Text style={bleStyles.successTitle}>WiFi Configured!</Text>
              <Text style={bleStyles.hintText}>
                The device will connect to your network and appear online in a few seconds.
              </Text>
              <TouchableOpacity
                style={[commonStyles.button, bleStyles.doneButton]}
                activeOpacity={0.8}
                onPress={() => navigation.navigate('Dashboard')}
              >
                <Text style={commonStyles.buttonText}>Go to Dashboard</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ── ERROR ── */}
          {step === STEP.ERROR && (
            <View style={bleStyles.centeredCard}>
              <View style={bleStyles.errorCircle}>
                <Text style={bleStyles.errorIcon}>✕</Text>
              </View>
              <Text style={bleStyles.errorTitle}>Something went wrong</Text>
              <Text style={bleStyles.errorMsg}>{error}</Text>
              <View style={bleStyles.errorActions}>
                <TouchableOpacity
                  style={[commonStyles.button, bleStyles.retryButton]}
                  activeOpacity={0.8}
                  onPress={retry}
                >
                  <Text style={commonStyles.buttonText}>Try Again</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={bleStyles.cancelLink}
                  activeOpacity={0.7}
                  onPress={() => navigation.goBack()}
                >
                  <Text style={bleStyles.cancelLinkText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const bleStyles = StyleSheet.create({
  scroll: {
    flexGrow: 1,
    padding: 20,
    gap: 24
  },
  header: {
    gap: 6
  },
  centeredCard: {
    ...StyleSheet.absoluteFillObject,
    position: 'relative',
    backgroundColor: '#101720',
    borderWidth: 1,
    borderColor: '#243244',
    borderRadius: 12,
    padding: 28,
    alignItems: 'center',
    gap: 18
  },
  statusText: {
    color: '#F5F8FB',
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center'
  },
  hintText: {
    color: '#8EA0B3',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20
  },
  // WiFi form
  form: {
    gap: 12
  },
  connectedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#0E3B31',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  connectedDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#34D399'
  },
  connectedText: {
    color: '#34D399',
    fontSize: 12,
    fontWeight: '700'
  },
  // Success
  successCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#0E3B31',
    borderWidth: 2,
    borderColor: '#34D399',
    alignItems: 'center',
    justifyContent: 'center'
  },
  successIcon: {
    fontSize: 34,
    color: '#34D399'
  },
  successTitle: {
    color: '#F5F8FB',
    fontSize: 20,
    fontWeight: '800'
  },
  doneButton: {
    width: '100%',
    marginTop: 4
  },
  // Error
  errorCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#3B1A1A',
    borderWidth: 2,
    borderColor: '#F87171',
    alignItems: 'center',
    justifyContent: 'center'
  },
  errorIcon: {
    fontSize: 34,
    color: '#F87171'
  },
  errorTitle: {
    color: '#F5F8FB',
    fontSize: 18,
    fontWeight: '800'
  },
  errorMsg: {
    color: '#8EA0B3',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20
  },
  errorActions: {
    width: '100%',
    gap: 12,
    alignItems: 'center'
  },
  retryButton: {
    width: '100%'
  },
  cancelLink: {
    paddingVertical: 6
  },
  cancelLinkText: {
    color: '#8EA0B3',
    fontSize: 14,
    fontWeight: '700'
  }
});
