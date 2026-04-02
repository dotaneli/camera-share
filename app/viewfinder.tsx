import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View, Pressable, TextInput, Alert, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { decodeQRPayload } from '../lib/pairing';
import { useAppStore } from '../lib/store';
import log from '../lib/logger';
import { rlog } from '../lib/remote-logger';
import { joinRoom, lookupNumericCode } from '../lib/firebase';
import { startAsViewfinder, cleanupWebRTC } from '../lib/webrtc';
import { RTCView } from 'react-native-webrtc';

// Separate component for the camera — only rendered after lazy load
function QRScanner({ onScanned }: { onScanned: (roomId: string) => void }) {
  rlog.info('viewfinder', 'QRScanner: requiring vision-camera');
  let VisionCameraModule: any;
  try {
    VisionCameraModule = require('react-native-vision-camera');
    rlog.info('viewfinder', 'QRScanner: require succeeded', { keys: Object.keys(VisionCameraModule).join(',') });
  } catch (e: any) {
    rlog.fatal('viewfinder', 'QRScanner: require FAILED', { error: e?.message });
    return (
      <View style={styles.content}>
        <Text style={styles.errorText}>Camera module failed to load</Text>
        <Text style={styles.status}>{e?.message}</Text>
      </View>
    );
  }

  const { Camera, useCameraDevice, useCodeScanner } = VisionCameraModule;
  rlog.info('viewfinder', 'QRScanner: calling useCameraDevice');
  const device = useCameraDevice('back');
  rlog.info('viewfinder', 'QRScanner: device result', { hasDevice: !!device });
  const hasScanned = useRef(false);

  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: (codes: any[]) => {
      if (hasScanned.current) return;
      const qrValue = codes[0]?.value;
      if (!qrValue) return;
      const result = decodeQRPayload(qrValue);
      if (result) {
        hasScanned.current = true;
        rlog.info('viewfinder', 'QR scanned successfully');
        onScanned(result.roomId);
      }
    },
  });

  if (!device) {
    rlog.warn('viewfinder', 'QRScanner: no camera device found');
    return (
      <View style={styles.content}>
        <Text style={styles.status}>No camera found</Text>
      </View>
    );
  }

  rlog.info('viewfinder', 'QRScanner: rendering Camera component');
  return (
    <Camera
      style={StyleSheet.absoluteFill}
      device={device}
      isActive={true}
      codeScanner={codeScanner}
    />
  );
}

export default function ViewfinderScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const resetRole = useAppStore((s) => s.resetRole);
  const [scannedRoomId, setScannedRoomId] = useState<string | null>(null);
  const [joinStatus, setJoinStatus] = useState<'idle' | 'joining' | 'joined' | 'streaming' | 'failed'>('idle');
  const [remoteStreamUrl, setRemoteStreamUrl] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState('');
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [permissionStatus, setPermissionStatus] = useState<string>('unknown');

  useEffect(() => {
    rlog.info('viewfinder', 'ViewfinderScreen mounted');
    (async () => {
      try {
        rlog.info('viewfinder', 'Requesting camera permission');
        const VC = require('react-native-vision-camera');
        const status = await VC.Camera.getCameraPermissionStatus();
        rlog.info('viewfinder', 'Permission status', { status });
        if (status === 'granted') {
          setPermissionStatus('granted');
        } else {
          const result = await VC.Camera.requestCameraPermission();
          rlog.info('viewfinder', 'Permission request result', { result });
          setPermissionStatus(result);
        }
      } catch (e: any) {
        rlog.fatal('viewfinder', 'Permission check crashed', { error: e?.message });
      }
    })();
  }, []);

  const handleJoinRoom = async (roomId: string) => {
    setScannedRoomId(roomId);
    setJoinStatus('joining');
    rlog.info('viewfinder', 'Attempting to join room');
    const success = await joinRoom(roomId);
    if (!success) {
      setJoinStatus('failed');
      return;
    }
    setJoinStatus('joined');

    // Start WebRTC — receive video from camera
    try {
      rlog.info('viewfinder', 'Starting WebRTC as viewfinder');
      await startAsViewfinder(roomId, (stream) => {
        rlog.info('viewfinder', 'Remote stream received!');
        setRemoteStreamUrl((stream as any).toURL());
        setJoinStatus('streaming');
      });
    } catch (e: any) {
      rlog.fatal('viewfinder', 'WebRTC start failed', { error: e?.message });
    }
  };

  const handleBack = () => {
    rlog.info('viewfinder', 'Leaving viewfinder mode');
    resetRole();
    router.back();
  };

  const handleManualSubmit = async () => {
    if (manualCode.length === 6) {
      rlog.info('viewfinder', 'Looking up numeric code');
      const roomId = await lookupNumericCode(manualCode);
      if (roomId) {
        handleJoinRoom(roomId);
      } else {
        Alert.alert('Code not found', 'No room found for this code. Make sure the Camera phone is showing the code.');
      }
    } else {
      Alert.alert('Invalid code', 'Please enter the 6-digit code from the Camera phone.');
    }
  };

  const handleReset = () => {
    setScannedRoomId(null);
    setJoinStatus('idle');
    setManualCode('');
    setShowManualEntry(false);
  };

  const handleOpenSettings = () => {
    Linking.openSettings();
  };

  // Permission denied
  if (permissionStatus === 'denied') {
    return (
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <Pressable onPress={handleBack} style={styles.backButton} accessibilityLabel="Go back" accessibilityRole="button">
            <Text style={styles.backText}>← Back</Text>
          </Pressable>
        </View>
        <View style={styles.content}>
          <Text style={styles.errorText}>Camera access needed</Text>
          <Text style={styles.permissionHint}>CameraShare needs camera access to scan QR codes from the Camera phone.</Text>
          <Pressable onPress={handleOpenSettings} style={styles.settingsButton}>
            <Text style={styles.settingsText}>Open Settings</Text>
          </Pressable>
          <Pressable onPress={() => setShowManualEntry(true)} style={styles.manualButton}>
            <Text style={styles.manualText}>Enter code manually instead</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // Streaming — show live video
  if (scannedRoomId && joinStatus === 'streaming' && remoteStreamUrl) {
    return (
      <View style={styles.container}>
        <RTCView
          streamURL={remoteStreamUrl}
          style={StyleSheet.absoluteFill}
          objectFit="cover"
          mirror={false}
        />
        <View style={[styles.header, { paddingTop: insets.top + 12, position: 'absolute', zIndex: 10, left: 0, right: 0 }]}>
          <Pressable onPress={() => { cleanupWebRTC(scannedRoomId); handleBack(); }} style={styles.backButton} accessibilityLabel="Disconnect" accessibilityRole="button">
            <Text style={styles.backText}>← Disconnect</Text>
          </Pressable>
          <View style={styles.liveBadge}>
            <Text style={styles.liveText}>● LIVE</Text>
          </View>
        </View>
      </View>
    );
  }

  // Scanned / joining / joined (waiting for stream)
  if (scannedRoomId) {
    const statusMsg = {
      joining: 'Joining room...',
      joined: 'Connected — waiting for video...',
      streaming: 'Streaming',
      failed: 'Failed to join room',
      idle: '',
    }[joinStatus];
    const statusClr = joinStatus === 'joined' ? '#4aff9e' : joinStatus === 'failed' ? '#ff4a4a' : '#666';

    return (
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <Pressable onPress={() => { cleanupWebRTC(scannedRoomId); handleBack(); }} style={styles.backButton} accessibilityLabel="Go back" accessibilityRole="button">
            <Text style={styles.backText}>← Back</Text>
          </Pressable>
        </View>
        <View style={styles.content}>
          <Text style={styles.successIcon}>{joinStatus === 'joined' ? '⋯' : joinStatus === 'failed' ? '✗' : '⋯'}</Text>
          <Text style={[styles.successText, { color: statusClr }]}>{statusMsg}</Text>
          {joinStatus === 'failed' && (
            <Pressable onPress={handleReset} style={styles.resetButton}>
              <Text style={styles.resetText}>Try again</Text>
            </Pressable>
          )}
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

      {permissionStatus === 'granted' ? (
        <QRScanner onScanned={(roomId) => handleJoinRoom(roomId)} />
      ) : (
        <View style={styles.content}>
          <Text style={styles.status}>Loading camera...</Text>
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
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  permissionHint: {
    color: '#999',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 24,
    paddingHorizontal: 32,
  },
  settingsButton: {
    backgroundColor: '#4aff9e',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
    marginBottom: 16,
  },
  settingsText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '600',
  },
  liveBadge: {
    backgroundColor: 'rgba(255,0,0,0.8)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
    marginLeft: 'auto',
    marginRight: 20,
  },
  liveText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
});
