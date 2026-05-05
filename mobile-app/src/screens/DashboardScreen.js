import React, { useLayoutEffect } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, FlatList, Platform, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import DebugPanel from '../components/DebugPanel';
import DeviceCard from '../components/DeviceCard';
import { useApp } from '../store/AppContext';
import { colors } from '../theme/colors';
import { commonStyles } from '../theme/styles';

export default function DashboardScreen({ navigation }) {
  const { state, actions } = useApp();

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={styles.headerActions}>
          <Pressable onPress={showAddMenu} style={styles.iconButton}>
            <Text style={styles.iconText}>+</Text>
          </Pressable>
          <Pressable onPress={actions.logout} style={styles.logoutButton}>
            <Text style={styles.logoutText}>Logout</Text>
          </Pressable>
        </View>
      )
    });
  }, [actions.logout, navigation]);

  function showAddMenu() {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Cancel', 'Scan QR + BLE Setup', 'Enter Manually'],
          cancelButtonIndex: 0,
          title: 'Add Device'
        },
        (index) => {
          if (index === 1) navigation.navigate('Scan');
          if (index === 2) navigation.navigate('PairDevice');
        }
      );
    } else {
      Alert.alert(
        'Add Device',
        'How would you like to add a device?',
        [
          { text: 'Scan QR + BLE Setup', onPress: () => navigation.navigate('Scan') },
          { text: 'Enter Manually',      onPress: () => navigation.navigate('PairDevice') },
          { text: 'Cancel', style: 'cancel' }
        ]
      );
    }
  }

  function toggleDevice(device, value) {
    actions.togglePower(device.namespace, value).catch((error) => {
      Alert.alert('MQTT unavailable', error.message);
    });
  }

  return (
    <SafeAreaView edges={['bottom']} style={commonStyles.screen}>
      <FlatList
        contentContainerStyle={styles.content}
        data={state.devices}
        keyExtractor={(item) => item.namespace}
        refreshControl={
          <RefreshControl
            refreshing={state.loadingDevices}
            tintColor={colors.accent}
            onRefresh={actions.refreshDevices}
          />
        }
        ListHeaderComponent={
          <View style={styles.top}>
            <View>
              <Text style={commonStyles.title}>Devices</Text>
              <Text style={commonStyles.subtitle}>{state.mqttStatus === 'connected' ? 'MQTT connected' : `MQTT ${state.mqttStatus}`}</Text>
            </View>
            <View style={[styles.statusPill, state.mqttStatus === 'connected' && styles.statusPillLive]}>
              <Text style={styles.statusPillText}>{state.mqttStatus}</Text>
            </View>
          </View>
        }
        ListEmptyComponent={
          <View style={[commonStyles.card, styles.empty]}>
            {state.loadingDevices ? (
              <ActivityIndicator color={colors.accent} />
            ) : (
              <>
                <Text style={styles.emptyTitle}>No devices paired</Text>
                <Text style={styles.emptyText}>Use the plus button to add your first device.</Text>
              </>
            )}
          </View>
        }
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        renderItem={({ item }) => (
          <DeviceCard
            device={item}
            onPress={() => navigation.navigate('Device', { namespace: item.namespace, name: item.name })}
            onToggle={(index, value) => actions.toggleRelay(item.namespace, index, value)}
            onSubscribe={actions.subscribeDevice}
          />
        )}
        ListFooterComponent={
          <View>
            {state.error ? <Text style={[commonStyles.error, styles.footerError]}>{state.error}</Text> : null}
            <DebugPanel mqttStatus={state.mqttStatus} deviceCount={state.devices.length} />
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 20,
    gap: 14
  },
  top: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 14,
    marginBottom: 6
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10
  },
  iconButton: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center'
  },
  iconText: {
    color: '#04100D',
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '800'
  },
  logoutButton: {
    minHeight: 34,
    justifyContent: 'center'
  },
  logoutText: {
    color: colors.muted,
    fontWeight: '700'
  },
  statusPill: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: colors.surface
  },
  statusPillLive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent
  },
  statusPillText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase'
  },
  empty: {
    alignItems: 'center',
    gap: 8,
    marginTop: 10
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '800'
  },
  emptyText: {
    color: colors.muted,
    textAlign: 'center'
  },
  footerError: {
    marginTop: 12
  }
});
