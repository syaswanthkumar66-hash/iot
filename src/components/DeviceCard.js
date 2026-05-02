import React, { useEffect } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import { commonStyles } from '../theme/styles';
import ToggleSwitch from './ToggleSwitch';
import { formatLastSeen } from '../utils/device';

export default function DeviceCard({ device, onPress, onToggle, onSubscribe }) {
  const powered = device.power === 'on';
  const offline = device.offline || !device.online;
  const delayed = device.status === 'delay';
  const pending = Boolean(device.state?.pending);
  const statusColor = offline ? colors.danger : delayed ? colors.warning : colors.accent;
  const statusLabel = offline ? 'Device Offline' : delayed ? 'Delayed' : 'Online';
  const connectionLabel = device.connectionMode === 'local'
    ? 'Local'
    : device.connectionMode === 'internet'
      ? 'Internet'
      : 'Waiting';
  const connectionColor = device.connectionMode === 'local' ? colors.accent : device.connectionMode === 'internet' ? colors.warning : colors.muted;

  function handleToggle(value) {
    if (pending) return;
    onToggle(value);
  }

  useEffect(() => {
    if (!onSubscribe) return undefined;
    return onSubscribe(device.namespace);
  }, [device.namespace, onSubscribe]);

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [commonStyles.card, styles.card, { opacity: pressed ? 0.82 : 1 }]}>
      <View style={styles.header}>
        <View style={styles.nameBlock}>
          <Text style={styles.name} numberOfLines={1}>{device.name}</Text>
          <View style={styles.statusRow}>
            <View style={[styles.dot, { backgroundColor: statusColor }]} />
            <Text style={[styles.status, { color: statusColor }]}>{statusLabel}</Text>
            <Text style={[styles.linkMode, { color: connectionColor }]}>{connectionLabel}</Text>
          </View>
        </View>
        {pending ? (
          <ActivityIndicator color={colors.accent} />
        ) : (
          <ToggleSwitch value={powered} disabled={offline || pending} onValueChange={handleToggle} />
        )}
      </View>
      <View style={styles.footer}>
        <Text style={styles.metric}>Power {powered ? 'ON' : 'OFF'}</Text>
        <Text style={styles.metric}>{device.relayCount || 1} switch{(device.relayCount || 1) > 1 ? 'es' : ''}</Text>
        <Text style={styles.lastSeen} numberOfLines={1}>{formatLastSeen(device.lastSeen)}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 16
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14
  },
  nameBlock: {
    flex: 1,
    minWidth: 0
  },
  name: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4
  },
  status: {
    color: colors.muted,
    fontSize: 13
  },
  linkMode: {
    fontSize: 12,
    fontWeight: '800'
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12
  },
  metric: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '800'
  },
  lastSeen: {
    color: colors.muted,
    flex: 1,
    textAlign: 'right',
    fontSize: 12
  }
});
