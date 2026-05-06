import { StyleSheet } from 'react-native';
import { colors } from './colors';

export const commonStyles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background
  },
  container: {
    flex: 1,
    paddingHorizontal: 20
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 16
  },
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 0
  },
  subtitle: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
    letterSpacing: 0
  },
  label: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0
  },
  input: {
    minHeight: 52,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    color: colors.text,
    paddingHorizontal: 14,
    fontSize: 16
  },
  button: {
    minHeight: 52,
    borderRadius: 8,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16
  },
  buttonText: {
    color: '#04100D',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0
  },
  error: {
    color: colors.danger,
    fontSize: 14,
    lineHeight: 20
  }
});
