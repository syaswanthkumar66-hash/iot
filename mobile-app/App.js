import React from 'react';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { AppProvider, useApp } from './src/store/AppContext';
import LoginScreen from './src/screens/LoginScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import DeviceScreen from './src/screens/DeviceScreen';
import PairDeviceScreen from './src/screens/PairDeviceScreen';
import ScanScreen from './src/screens/ScanScreen';
import BLEScanScreen from './src/screens/BLEScanScreen';
import BLEProvisionScreen from './src/screens/BLEProvisionScreen';
import { colors } from './src/theme/colors';

const Stack = createNativeStackNavigator();

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.background,
    card: colors.surface,
    border: colors.border,
    primary: colors.accent,
    text: colors.text
  }
};

function RootNavigator() {
  const { state } = useApp();

  if (state.booting) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.background }
      }}
    >
      {state.token ? (
        <>
          <Stack.Screen name="Dashboard"    component={DashboardScreen}   options={{ title: 'IoTYK' }} />
          <Stack.Screen name="Device"       component={DeviceScreen}       options={({ route }) => ({ title: route.params?.name || 'Device' })} />
          <Stack.Screen name="PairDevice"   component={PairDeviceScreen}   options={{ title: 'Pair Device' }} />
          <Stack.Screen name="Scan"         component={ScanScreen}         options={{ headerShown: false }} />
          <Stack.Screen name="BLEScan"      component={BLEScanScreen}      options={{ title: 'Bluetooth Scan' }} />
          <Stack.Screen name="BLEProvision" component={BLEProvisionScreen} options={{ title: 'WiFi Setup' }} />
        </>
      ) : (
        <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <AppProvider>
      <NavigationContainer theme={navTheme}>
        <StatusBar style="light" />
        <RootNavigator />
      </NavigationContainer>
    </AppProvider>
  );
}
