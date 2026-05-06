import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';

export default function ToggleSwitch({ value, disabled, onValueChange }) {
  const progress = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    Animated.spring(progress, {
      toValue: value ? 1 : 0,
      useNativeDriver: false,
      speed: 18,
      bounciness: 6
    }).start();
  }, [progress, value]);

  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [2, 28] });
  const backgroundColor = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.elevated, colors.accent]
  });

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
    >
      <Animated.View style={[styles.track, { backgroundColor, opacity: disabled ? 0.45 : 1 }]}>
        <Animated.View style={[styles.thumb, { transform: [{ translateX }] }]} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    width: 58,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center'
  },
  thumb: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.text
  }
});
