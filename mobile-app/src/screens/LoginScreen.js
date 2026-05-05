import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  LayoutAnimation,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import PrimaryButton from '../components/PrimaryButton';
import { API_BASE_URL } from '../config/env';
import { useApp } from '../store/AppContext';
import { colors } from '../theme/colors';
import { commonStyles } from '../theme/styles';



// ─── Status badge ────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const ok = status >= 200 && status < 300;
  const warn = status >= 400 && status < 500;
  const bg = ok ? colors.accentSoft : warn ? '#3B1A1A' : '#2B1E0A';
  const fg = ok ? colors.accent : warn ? colors.danger : colors.warning;
  return (
    <View style={[traceStyles.badge, { backgroundColor: bg }]}>
      <Text style={[traceStyles.badgeText, { color: fg }]}>{status}</Text>
    </View>
  );
}

// ─── Latency pill ─────────────────────────────────────────────────────────────
function LatencyPill({ ms }) {
  const fast = ms < 400;
  const mid = ms < 1000;
  const color = fast ? colors.accent : mid ? colors.warning : colors.danger;
  return <Text style={[traceStyles.latency, { color }]}>{ms}ms</Text>;
}

// ─── JSON body block ──────────────────────────────────────────────────────────
function JsonBlock({ label, data }) {
  if (data === null || data === undefined) return null;

  let text;
  try {
    // Redact password to avoid showing it in the panel
    const safe = typeof data === 'object'
      ? Object.fromEntries(
          Object.entries(data).map(([k, v]) =>
            k.toLowerCase() === 'password' ? [k, '••••••••'] : [k, v]
          )
        )
      : data;
    text = JSON.stringify(safe, null, 2);
  } catch {
    text = String(data);
  }

  return (
    <View style={traceStyles.jsonWrap}>
      <Text style={traceStyles.jsonLabel}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Text style={traceStyles.jsonText}>{text}</Text>
      </ScrollView>
    </View>
  );
}

// ─── Single trace card ────────────────────────────────────────────────────────
function TraceCard({ entry, index }) {
  const [expanded, setExpanded] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(-6)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 250, delay: index * 80, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 250, delay: index * 80, useNativeDriver: true })
    ]).start();
  }, []);

  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((prev) => !prev);
  };

  // Build a safe response preview (hide mqtt.password)
  const safeResponse = (() => {
    try {
      if (!entry.responseBody || typeof entry.responseBody !== 'object') return entry.responseBody;
      const clone = JSON.parse(JSON.stringify(entry.responseBody));
      if (clone?.mqtt?.password) clone.mqtt.password = '••••••••';
      if (clone?.data?.mqtt?.password) clone.data.mqtt.password = '••••••••';
      return clone;
    } catch {
      return entry.responseBody;
    }
  })();

  return (
    <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
      <TouchableOpacity activeOpacity={0.75} onPress={toggle} style={traceStyles.card}>
        {/* Header row */}
        <View style={traceStyles.cardHeader}>
          <View style={traceStyles.methodBadge}>
            <Text style={traceStyles.methodText}>{entry.method}</Text>
          </View>
          <Text style={traceStyles.stepLabel} numberOfLines={1}>{entry.step}</Text>
          <View style={traceStyles.headerRight}>
            <StatusBadge status={entry.status} />
            <LatencyPill ms={entry.latencyMs} />
            <Text style={traceStyles.chevron}>{expanded ? '▲' : '▼'}</Text>
          </View>
        </View>

        {/* URL row */}
        <Text style={traceStyles.urlText} numberOfLines={expanded ? undefined : 1}>{entry.url}</Text>

        {/* Expanded detail */}
        {expanded && (
          <View style={traceStyles.detail}>
            <JsonBlock label="REQUEST BODY" data={entry.requestBody} />
            <JsonBlock label="RESPONSE" data={safeResponse} />
          </View>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

// ─── Trace panel ──────────────────────────────────────────────────────────────
function TracePanel({ trace, loading }) {
  if (!loading && trace.length === 0) return null;

  return (
    <View style={traceStyles.panel}>
      {/* Panel header */}
      <View style={traceStyles.panelHeader}>
        <View style={traceStyles.dot} />
        <Text style={traceStyles.panelTitle}>API CALL TRACE</Text>
        <Text style={traceStyles.panelBase}>{API_BASE_URL}</Text>
      </View>

      {/* In-flight placeholder */}
      {loading && trace.length === 0 && (
        <View style={traceStyles.card}>
          <Text style={traceStyles.pendingText}>⏳  Waiting for response…</Text>
        </View>
      )}

      {trace.map((entry, i) => (
        <TraceCard key={i} entry={entry} index={i} />
      ))}
    </View>
  );
}

// ─── Main screen ─────────────────────────────────────────────────────────────
export default function LoginScreen() {
  const { state, actions } = useApp();
  const [isRegister, setIsRegister] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const canSubmit = isRegister 
    ? name.trim().length > 1 && email.trim().length > 3 && password.length >= 6
    : email.trim().length > 3 && password.length > 0;
    
  const showTrace = state.authLoading || state.loginTrace.length > 0;

  const handleSubmit = () => {
    if (isRegister) {
      actions.register(name, email, password);
    } else {
      actions.login(email, password);
    }
  };

  return (
    <SafeAreaView style={commonStyles.screen}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.wrap}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Brand */}
          <View style={styles.brand}>
            <View style={styles.mark}>
              <Text style={styles.markText}>I</Text>
            </View>
            <Text style={commonStyles.title}>IoTYK</Text>
            <Text style={commonStyles.subtitle}>Secure real-time control for your connected devices.</Text>
          </View>

          {/* Form */}
          <View style={[commonStyles.card, styles.form]}>
            {isRegister && (
              <>
                <Text style={commonStyles.label}>Full Name</Text>
                <TextInput
                  autoCapitalize="words"
                  autoComplete="name"
                  placeholder="Jane Doe"
                  placeholderTextColor={colors.muted}
                  value={name}
                  onChangeText={setName}
                  style={commonStyles.input}
                />
              </>
            )}

            <Text style={commonStyles.label}>Email</Text>
            <TextInput
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              placeholder="you@example.com"
              placeholderTextColor={colors.muted}
              value={email}
              onChangeText={setEmail}
              style={commonStyles.input}
            />

            <Text style={commonStyles.label}>Password</Text>
            <TextInput
              autoCapitalize="none"
              autoComplete="password"
              placeholder={isRegister ? "Minimum 6 characters" : "Password"}
              placeholderTextColor={colors.muted}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              style={commonStyles.input}
            />

            {state.error ? <Text style={commonStyles.error}>{state.error}</Text> : null}

            <PrimaryButton
              label={isRegister ? "Create Account" : "Sign in"}
              loading={state.authLoading}
              disabled={!canSubmit}
              onPress={handleSubmit}
            />
            
            {/* Toggle Mode */}
            <TouchableOpacity 
              style={styles.toggleWrap}
              onPress={() => setIsRegister(!isRegister)}
              disabled={state.authLoading}
            >
              <Text style={styles.toggleText}>
                {isRegister ? 'Already have an account? Sign in' : "Don't have an account? Create one"}
              </Text>
            </TouchableOpacity>
          </View>

          {/* API trace panel — shown during and after login attempt */}
          {showTrace && (
            <TracePanel trace={state.loginTrace} loading={state.authLoading} />
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  wrap: {
    flex: 1
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 20,
    gap: 24
  },
  brand: {
    gap: 10
  },
  mark: {
    width: 54,
    height: 54,
    borderRadius: 8,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center'
  },
  markText: {
    color: '#04100D',
    fontSize: 28,
    fontWeight: '900'
  },
  form: {
    gap: 12
  },
  toggleWrap: {
    marginTop: 8,
    alignItems: 'center',
    paddingVertical: 12
  },
  toggleText: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '600'
  }
});

const traceStyles = StyleSheet.create({
  panel: {
    gap: 8
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 4
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.accent
  },
  panelTitle: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2
  },
  panelBase: {
    color: colors.muted,
    fontSize: 10,
    flex: 1,
    textAlign: 'right'
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 12,
    gap: 6
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  methodBadge: {
    backgroundColor: '#0E2040',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2
  },
  methodText: {
    color: colors.blue,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5
  },
  stepLabel: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
    flex: 1
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6
  },
  badge: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '800'
  },
  latency: {
    fontSize: 11,
    fontWeight: '700'
  },
  chevron: {
    color: colors.muted,
    fontSize: 10
  },
  urlText: {
    color: colors.muted,
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    paddingLeft: 2
  },
  detail: {
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 10,
    marginTop: 4
  },
  jsonWrap: {
    gap: 4
  },
  jsonLabel: {
    color: colors.muted,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1
  },
  jsonText: {
    color: colors.accent,
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    lineHeight: 17
  },
  pendingText: {
    color: colors.muted,
    fontSize: 13
  }
});
