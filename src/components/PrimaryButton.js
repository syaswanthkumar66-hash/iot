import React from 'react';
import { ActivityIndicator, Pressable, Text } from 'react-native';
import { colors } from '../theme/colors';
import { commonStyles } from '../theme/styles';

export default function PrimaryButton({ label, loading, disabled, onPress, style }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        commonStyles.button,
        { opacity: disabled ? 0.5 : pressed ? 0.82 : 1 },
        style
      ]}
    >
      {loading ? <ActivityIndicator color="#04100D" /> : <Text style={commonStyles.buttonText}>{label}</Text>}
    </Pressable>
  );
}
