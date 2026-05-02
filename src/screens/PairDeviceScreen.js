import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import PrimaryButton from '../components/PrimaryButton';
import { useApp } from '../store/AppContext';
import { colors } from '../theme/colors';
import { commonStyles } from '../theme/styles';

/**
 * PairDeviceScreen
 *
 * Can be reached two ways:
 *   (a) Manually from Dashboard → no route params → blank form
 *   (b) From ScanScreen (QR) → route.params.device_id + device_key → auto-filled
 */
export default function PairDeviceScreen({ navigation, route }) {
  const { state, actions } = useApp();

  // Auto-fill from QR scan route params if available
  const [deviceId, setDeviceId]   = useState(route.params?.device_id  ?? '');
  const [deviceKey, setDeviceKey] = useState(route.params?.device_key ?? '');
  const [success, setSuccess]     = useState(false);

  const fromQR = Boolean(route.params?.device_id);
  const canSubmit = deviceId.trim().length > 0 && deviceKey.trim().length > 0;

  async function submit() {
    const ok = await actions.pairDevice(deviceId.trim(), deviceKey.trim());
    if (ok) {
      setSuccess(true);
      // Brief success flash then navigate to Dashboard
      setTimeout(() => {
        navigation.navigate('Dashboard');
      }, 1200);
    }
  }

  return (
    <SafeAreaView edges={['bottom']} style={commonStyles.screen}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={commonStyles.title}>
            {fromQR ? 'Confirm Pairing' : 'Pair Device'}
          </Text>
          <Text style={commonStyles.subtitle}>
            {fromQR
              ? 'Device credentials were read from the QR code. Tap Add to pair.'
              : 'Enter the device ID and pairing key from the device label.'}
          </Text>
        </View>

        {/* QR badge */}
        {fromQR && (
          <View style={styles.qrBadge}>
            <Text style={styles.qrBadgeIcon}>📷</Text>
            <Text style={styles.qrBadgeText}>Filled from QR scan</Text>
          </View>
        )}

        {/* Success state */}
        {success ? (
          <View style={[commonStyles.card, styles.successCard]}>
            <Text style={styles.successIcon}>✓</Text>
            <Text style={styles.successTitle}>Device Added!</Text>
            <Text style={styles.successSub}>Redirecting to dashboard…</Text>
          </View>
        ) : (
          <View style={[commonStyles.card, styles.form]}>
            <Text style={commonStyles.label}>Device ID</Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="esp32-xxxx"
              placeholderTextColor={colors.muted}
              value={deviceId}
              onChangeText={setDeviceId}
              style={[commonStyles.input, fromQR && styles.readonlyInput]}
              editable={!fromQR}
            />

            <Text style={commonStyles.label}>Device Key</Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="pairing key"
              placeholderTextColor={colors.muted}
              secureTextEntry={!fromQR}   // show key when filled from QR for transparency
              value={deviceKey}
              onChangeText={setDeviceKey}
              style={[commonStyles.input, fromQR && styles.readonlyInput]}
              editable={!fromQR}
            />

            {/* Already-paired error */}
            {state.error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{state.error}</Text>
                {state.error.toLowerCase().includes('pair') && (
                  <Text style={styles.errorHint}>
                    This device may already be linked to an account.
                  </Text>
                )}
              </View>
            ) : null}

            <PrimaryButton
              label="Add Device"
              loading={state.pairLoading}
              disabled={!canSubmit}
              onPress={submit}
            />

            {/* Manual scan link (only when not from QR) */}
            {!fromQR && (
              <TouchableOpacity
                style={styles.scanLink}
                activeOpacity={0.7}
                onPress={() => navigation.navigate('Scan')}
              >
                <Text style={styles.scanLinkText}>📷  Scan QR code instead</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
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
  qrBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.accentSoft,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.accent
  },
  qrBadgeIcon: {
    fontSize: 16
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
    opacity: 0.7,
    borderStyle: 'dashed'
  },
  errorBox: {
    backgroundColor: '#3B1A1A',
    borderRadius: 8,
    padding: 12,
    gap: 4
  },
  errorText: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: '600'
  },
  errorHint: {
    color: colors.muted,
    fontSize: 12
  },
  scanLink: {
    alignItems: 'center',
    paddingVertical: 10
  },
  scanLinkText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: '600'
  },
  // Success
  successCard: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 36
  },
  successIcon: {
    fontSize: 48,
    color: colors.accent
  },
  successTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '800'
  },
  successSub: {
    color: colors.muted,
    fontSize: 14
  }
});
