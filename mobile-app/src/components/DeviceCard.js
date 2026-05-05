import React, { useEffect } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import { commonStyles } from '../theme/styles';
import ToggleSwitch from './ToggleSwitch';
import { formatLastSeen } from '../utils/device';

export default function DeviceCard({ device, onPress, onToggle, onSubscribe }) {
  const offline = device.offline || !device.online;
  const pending = Boolean(device.state?.pending);
  const statusColor = offline ? colors.danger : colors.accent;
  const statusLabel = offline ? 'Device Offline' : 'Online';
  const connectionLabel = device.connectionMode === 'local'
    ? 'Local'
    : device.connectionMode === 'internet'
      ? 'Internet'
      : 'Waiting';
  const connectionColor = device.connectionMode === 'local' ? colors.accent : device.connectionMode === 'internet' ? colors.warning : colors.muted;

  const relayCount = device.relayCount || 1;
  const relays = device.state?.relays || Array.from({ length: relayCount }, (_, i) => ({ id: i, power: 'off' }));

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
      </View>

      <View style={styles.controls}>
        {relays.map((relay, index) => (
          <View key={index} style={styles.relayRow}>
            <Text style={styles.relayLabel}>Switch {index + 1}</Text>
            {pending ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : (
              <ToggleSwitch 
                value={relay.power === 'on'} 
                disabled={offline || pending} 
                onValueChange={(val) => onToggle(index, val)} 
              />
            )}
          </View>
        ))}
      </View>

      <View style={styles.footer}>
        <Text style={styles.lastSeen} numberOfLines={1}>{formatLastSeen(device.lastSeen)}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 12
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
    fontWeight: '800'
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4
  },
  status: {
    fontSize: 13
  },
  linkMode: {
    fontSize: 12,
    fontWeight: '800'
  },
  controls: {
    gap: 8,
    marginTop: 8
  },
  relayRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 10,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 8
  },
  relayLabel: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600'
  },
  footer: {
    marginTop: 4
  },
  lastSeen: {
    color: colors.muted,
    fontSize: 12,
    textAlign: 'right'
  }
});
