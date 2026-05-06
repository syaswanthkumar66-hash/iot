import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';

export default function DebugPanel({ mqttStatus, deviceCount }) {
  if (!__DEV__) return null;

  return (
    <View style={styles.panel}>
      <Text style={styles.text}>MQTT: {mqttStatus}</Text>
      <Text style={styles.text}>Devices: {deviceCount}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    marginTop: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4
  },
  text: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700'
  }
});
