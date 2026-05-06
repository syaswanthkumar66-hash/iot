import { CameraView, useCameraPermissions } from 'expo-camera';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Dimensions,
  Easing,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { scanForAny, stopScan } from '../services/ble';

const { width, height } = Dimensions.get('window');
const OVERLAY_SIZE = width * 0.68;

export default function ScanScreen({ navigation }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const scanLock = useRef(false);

  // Animated scan line
  const scanLineY = useRef(new Animated.Value(0)).current;
  const scanLineLoop = useRef(null);

  const startScanLine = useCallback(() => {
    scanLineY.setValue(0);
    scanLineLoop.current = Animated.loop(
      Animated.sequence([
        Animated.timing(scanLineY, {
          toValue: OVERLAY_SIZE - 2,
          duration: 2000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true
        }),
        Animated.timing(scanLineY, {
          toValue: 0,
          duration: 2000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true
        })
      ])
    );
    scanLineLoop.current.start();
  }, [scanLineY]);

  // ── Simultaneous BLE Discovery ──
  useEffect(() => {
    if (!permission?.granted) return;

    console.log("[DualScan] Starting background BLE scan...");
    scanForAny((device) => {
      if (scanLock.current) return;
      
      const deviceId = device.name || device.localName;
      if (deviceId) {
        console.log(`[DualScan] BLE Winner: ${deviceId}`);
        handleDeviceIdentified({ device_id: deviceId });
      }
    });

    return () => stopScan();
  }, [permission]);

  useEffect(() => {
    if (!permission) {
      requestPermission();
    }
    startScanLine();
    return () => scanLineLoop.current?.stop();
  }, [startScanLine, permission, requestPermission]);

  const handleDeviceIdentified = useCallback((data) => {
    if (scanLock.current) return;
    scanLock.current = true;
    setScanned(true);
    stopScan();

    const { device_id, device_key } = data;
    
    // Auto-transition to provisioning
    navigation.navigate('BLEProvision', { device_id, device_key });

    // Reset lock so user can re-scan if they navigate back
    setTimeout(() => {
      scanLock.current = false;
      setScanned(false);
    }, 1200);
  }, [navigation]);

  const handleBarCodeScanned = useCallback(({ data }) => {
    let parsed;
    try {
      // Expecting CSV/Pipe format ID|KEY or JSON
      if (data.includes('|')) {
        const p = data.split('|');
        parsed = { device_id: p[0], device_key: p[1] };
      } else {
        parsed = JSON.parse(data);
      }
    } catch {
      return; // Ignore invalid scans silently or show error
    }

    if (parsed.device_id) {
      console.log(`[DualScan] QR Winner: ${parsed.device_id}`);
      handleDeviceIdentified(parsed);
    }
  }, [handleDeviceIdentified]);

  // ── Permission denied ──────────────────────────────────────────
  if (permission && !permission.granted) {
    return (
      <SafeAreaView style={styles.permissionScreen}>
        <View style={styles.permissionBox}>
          <Text style={styles.permissionIcon}>📷</Text>
          <Text style={styles.permissionTitle}>Setup Access Required</Text>
          <Text style={styles.permissionText}>
            IoTYK needs camera and bluetooth access to find your hardware.
            Please enable them in your device settings.
          </Text>
          <TouchableOpacity 
            style={[styles.cancelButton, { marginTop: 20 }]} 
            onPress={requestPermission}
          >
            <Text style={styles.cancelText}>Grant Permissions</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Scanner ────────────────────────────────────────────────────
  return (
    <View style={styles.root}>
      <CameraView
        onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        style={StyleSheet.absoluteFillObject}
      />

      {/* Dark overlay with transparent cutout */}
      <View style={styles.overlayTop} />
      <View style={styles.overlayMiddle}>
        <View style={styles.overlaySide} />
        <View style={styles.scanBox}>
          <View style={[styles.corner, styles.cornerTL]} />
          <View style={[styles.corner, styles.cornerTR]} />
          <View style={[styles.corner, styles.cornerBL]} />
          <View style={[styles.corner, styles.cornerBR]} />
          {!scanned && (
            <Animated.View style={[styles.scanLine, { transform: [{ translateY: scanLineY }] }]} />
          )}
          {scanned && (
            <View style={styles.scannedOverlay}>
              <Text style={styles.scannedIcon}>✓</Text>
            </View>
          )}
        </View>
        <View style={styles.overlaySide} />
      </View>
      <View style={styles.overlayBottom}>
        <Text style={styles.scanLabel}>
          {scanned ? 'Device Identified!' : 'Scanning QR & Bluetooth...'}
        </Text>
        <Text style={styles.scanHint}>Scanning both Camera and Bluetooth for nearby hardware</Text>
        <TouchableOpacity style={styles.cancelButton} onPress={() => navigation.goBack()}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const CORNER = 22;
const BORDER = 3;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  overlayTop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.62)' },
  overlayMiddle: { flexDirection: 'row', height: OVERLAY_SIZE },
  overlaySide: { flex: 1, backgroundColor: 'rgba(0,0,0,0.62)' },
  overlayBottom: { flex: 1.2, backgroundColor: 'rgba(0,0,0,0.62)', alignItems: 'center', paddingTop: 28, gap: 10 },
  scanBox: { width: OVERLAY_SIZE, height: OVERLAY_SIZE, overflow: 'hidden' },
  scanLine: { position: 'absolute', left: 8, right: 8, height: 2, borderRadius: 1, backgroundColor: colors.accent, elevation: 4 },
  scannedOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(52, 211, 153, 0.18)', alignItems: 'center', justifyContent: 'center' },
  scannedIcon: { fontSize: 64, color: colors.accent },
  corner: { position: 'absolute', width: CORNER, height: CORNER, borderColor: colors.accent },
  cornerTL: { top: 0, left: 0, borderTopWidth: BORDER, borderLeftWidth: BORDER, borderTopLeftRadius: 4 },
  cornerTR: { top: 0, right: 0, borderTopWidth: BORDER, borderRightWidth: BORDER, borderTopRightRadius: 4 },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: BORDER, borderLeftWidth: BORDER, borderBottomLeftRadius: 4 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: BORDER, borderRightWidth: BORDER, borderTopRightRadius: 4 },
  scanLabel: { color: colors.text, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  scanHint: { color: colors.muted, fontSize: 13, textAlign: 'center', paddingHorizontal: 40 },
  cancelButton: { marginTop: 8, paddingHorizontal: 32, paddingVertical: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: 'rgba(255,255,255,0.06)' },
  cancelText: { color: colors.text, fontSize: 15, fontWeight: '700' },
  permissionScreen: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: 32 },
  permissionBox: { alignItems: 'center', gap: 14 },
  permissionIcon: { fontSize: 52 },
  permissionTitle: { color: colors.text, fontSize: 20, fontWeight: '800', textAlign: 'center' },
  permissionText: { color: colors.muted, fontSize: 14, textAlign: 'center', lineHeight: 22 }
});
