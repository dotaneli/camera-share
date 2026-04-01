import { useCallback, useState } from 'react';
import { StyleSheet, Text, View, Pressable, TextInput, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Camera, useCameraDevice, useCodeScanner } from 'react-native-vision-camera';
import { decodeQRPayload } from '../lib/pairing';
import { useAppStore } from '../lib/store';
import log from '../lib/logger';

export default function ViewfinderScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const resetRole = useAppStore((s) => s.resetRole);
  const [scannedRoomId, setScannedRoomId] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState('');
  const [showManualEntry, setShowManualEntry] = useState(false);

  const device = useCameraDevice('back');

  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: useCallback((codes: any[]) => {
      if (scannedRoomId) return; // Already scanned
      const qrValue = codes[0]?.value;
      if (!qrValue) return;

      const result = decodeQRPayload(qrValue);
      if (result) {
        log.info(`QR scanned — room: ${result.roomId}`);
        setScannedRoomId(result.roomId);
      }
    }, [scannedRoomId]),
  });

  const handleBack = () => {
    log.info('Leaving viewfinder mode');
    resetRole();
    router.back();
  };

  const handleManualSubmit = () => {
    if (manualCode.length === 6) {
      log.info(`Manual code entered: ${manualCode}`);
      // For now, just show the code was entered. Firebase lookup comes in M3.
      setScannedRoomId(`manual-${manualCode}`);
    } else {
      Alert.alert('Invalid code', 'Please enter the 6-digit code from the Camera phone.');
    }
  };

  const handleReset = () => {
    setScannedRoomId(null);
    setManualCode('');
    setShowManualEntry(false);
  };

  // Scanned successfully — show result
  if (scannedRoomId) {
    return (
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <Pressable onPress={handleBack} style={styles.backButton} accessibilityLabel="Go back" accessibilityRole="button">
            <Text style={styles.backText}>← Back</Text>
          </Pressable>
        </View>
        <View style={styles.content}>
          <Text style={styles.successIcon}>✓</Text>
          <Text style={styles.successText}>Room found!</Text>
          <Text style={styles.roomIdText}>{scannedRoomId.substring(0, 12)}...</Text>
          <Text style={styles.status}>Connecting... (Firebase coming in M3)</Text>
          <Pressable onPress={handleReset} style={styles.resetButton}>
            <Text style={styles.resetText}>Scan again</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // Manual code entry
  if (showManualEntry) {
    return (
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <Pressable onPress={() => setShowManualEntry(false)} style={styles.backButton} accessibilityLabel="Back to scanner" accessibilityRole="button">
            <Text style={styles.backText}>← Scanner</Text>
          </Pressable>
        </View>
        <View style={styles.content}>
          <Text style={styles.instruction}>Enter the 6-digit code</Text>
          <TextInput
            style={styles.codeInput}
            value={manualCode}
            onChangeText={setManualCode}
            keyboardType="number-pad"
            maxLength={6}
            placeholder="000000"
            placeholderTextColor="#444"
            autoFocus
          />
          <Pressable
            style={[styles.submitButton, manualCode.length < 6 && styles.submitDisabled]}
            onPress={handleManualSubmit}
            disabled={manualCode.length < 6}
          >
            <Text style={styles.submitText}>Connect</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // QR Scanner view
  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 12, position: 'absolute', zIndex: 10, left: 0, right: 0 }]}>
        <Pressable onPress={handleBack} style={styles.backButton} accessibilityLabel="Go back" accessibilityRole="button">
          <Text style={styles.backText}>← Back</Text>
        </Pressable>
      </View>

      {device ? (
        <Camera
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={true}
          codeScanner={codeScanner}
        />
      ) : (
        <View style={styles.content}>
          <Text style={styles.errorText}>No camera available</Text>
        </View>
      )}

      <View style={[styles.overlay, { paddingBottom: insets.bottom + 24 }]}>
        <Text style={styles.scanText}>Point at the QR code on the Camera phone</Text>
        <Pressable onPress={() => setShowManualEntry(true)} style={styles.manualButton}>
          <Text style={styles.manualText}>Enter code manually</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButton: {
    padding: 8,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 8,
  },
  backText: {
    color: '#4aff9e',
    fontSize: 16,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  overlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    padding: 24,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  scanText: {
    color: '#fff',
    fontSize: 16,
    marginBottom: 16,
    textAlign: 'center',
  },
  manualButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#4aff9e',
  },
  manualText: {
    color: '#4aff9e',
    fontSize: 14,
  },
  instruction: {
    color: '#ccc',
    fontSize: 18,
    marginBottom: 24,
  },
  codeInput: {
    color: '#fff',
    fontSize: 40,
    fontWeight: 'bold',
    letterSpacing: 12,
    textAlign: 'center',
    borderBottomWidth: 2,
    borderBottomColor: '#4aff9e',
    paddingVertical: 12,
    paddingHorizontal: 24,
    marginBottom: 32,
    width: '80%',
    fontVariant: ['tabular-nums'],
  },
  submitButton: {
    backgroundColor: '#4aff9e',
    paddingHorizontal: 48,
    paddingVertical: 16,
    borderRadius: 12,
  },
  submitDisabled: {
    opacity: 0.3,
  },
  submitText: {
    color: '#000',
    fontSize: 18,
    fontWeight: '600',
  },
  successIcon: {
    color: '#4aff9e',
    fontSize: 64,
    marginBottom: 16,
  },
  successText: {
    color: '#4aff9e',
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  roomIdText: {
    color: '#888',
    fontSize: 14,
    fontFamily: 'monospace',
    marginBottom: 16,
  },
  status: {
    color: '#666',
    fontSize: 14,
    marginBottom: 24,
  },
  resetButton: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#4aff9e',
  },
  resetText: {
    color: '#4aff9e',
    fontSize: 14,
  },
  errorText: {
    color: '#ff4a4a',
    fontSize: 16,
  },
});
