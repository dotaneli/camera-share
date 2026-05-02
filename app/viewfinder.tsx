import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View, Pressable, TextInput, Alert, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { decodeQRPayload } from '../lib/pairing';
import { useAppStore } from '../lib/store';
import { rlog } from '../lib/remote-logger';
import { joinRoom, lookupNumericCode } from '../lib/firebase';
import { startAsViewfinder, cleanupWebRTC, sendDataMessage, onDataMessage } from '../lib/webrtc';
import { handleTransferMessage, onTransferProgress, onTransferComplete } from '../lib/file-transfer';
import { RTCView } from 'react-native-webrtc';

// Why: react-native-webrtc on Android defaults to MODE_IN_COMMUNICATION which routes audio
// to the earpiece. For a remote-camera app the user expects loudspeaker playback.
// InCallManager.setForceSpeakerphoneOn(true) flips the routing.
let InCallManager: any = null;
try {
  InCallManager = require('react-native-incall-manager').default;
} catch {}

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
  const [captureStatus, setCaptureStatus] = useState<'idle' | 'capturing' | 'sending' | 'done'>('idle');
  const [isRecording, setIsRecording] = useState(false);
  const [transferProgress, setTransferProgress] = useState<{ received: number; total: number } | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const pinchRef = useRef<{ startDist: number; startZoom: number } | null>(null);
  const roomIdRef = useRef<string | null>(null);

  useEffect(() => {
    rlog.info('viewfinder', 'ViewfinderScreen mounted');

    // File transfer callbacks
    onTransferProgress((received, total) => {
      setTransferProgress({ received, total });
    });
    onTransferComplete((success, fileType) => {
      setTransferProgress(null);
      if (success) {
        rlog.info('viewfinder', `${fileType} saved to gallery`);
        setCaptureStatus('done');
        setTimeout(() => setCaptureStatus('idle'), 2500);
      } else {
        rlog.error('viewfinder', `Failed to save ${fileType}`);
        setCaptureStatus('idle');
        Alert.alert('Save failed', `Could not save the ${fileType} to your gallery.`);
      }
    });

    // Handle incoming messages from camera
    onDataMessage((msg) => {
      // Check if it's a file transfer message first
      if (handleTransferMessage(msg)) return;

      if (msg.type === 'shutter-done') {
        rlog.info('viewfinder', 'Shutter response', { success: msg.success });
        if (msg.success) {
          setCaptureStatus('sending');
          // Safety timeout — if no file transfer starts within 10s, reset
          setTimeout(() => setCaptureStatus((s) => s === 'sending' ? 'idle' : s), 10000);
        } else {
          setCaptureStatus('idle');
        }
      } else if (msg.type === 'record-done') {
        rlog.info('viewfinder', 'Record stopped');
        if (!msg.error) {
          setCaptureStatus('sending');
        }
        setIsRecording(false);
      } else if (msg.type === 'disconnect') {
        rlog.info('viewfinder', 'Remote disconnect received');
        cleanupWebRTC(roomIdRef.current ?? undefined);
        setJoinStatus('failed');
        setRemoteStreamUrl(null);
        Alert.alert('Disconnected', 'The camera phone disconnected.');
      }
    });

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
    roomIdRef.current = roomId;
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
        // Route audio to loudspeaker — Android's WebRTC default is the earpiece.
        if (InCallManager) {
          try {
            InCallManager.start({ media: 'video' });
            InCallManager.setForceSpeakerphoneOn(true);
            rlog.info('viewfinder', 'Audio routed to loudspeaker');
          } catch (e: any) {
            rlog.warn('viewfinder', 'InCallManager.start failed', { error: e?.message });
          }
        }
      });
    } catch (e: any) {
      rlog.fatal('viewfinder', 'WebRTC start failed', { error: e?.message });
    }
  };

  const stopInCallManager = () => {
    if (!InCallManager) return;
    try {
      InCallManager.setForceSpeakerphoneOn(false);
      InCallManager.stop();
    } catch {}
  };

  const handleBack = () => {
    rlog.info('viewfinder', 'Leaving viewfinder mode');
    stopInCallManager();
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

  const applyZoom = useCallback((next: number) => {
    const clamped = Math.min(Math.max(next, 1), 5);
    setZoomLevel(clamped);
    sendDataMessage({ type: 'zoom', level: clamped });
  }, []);

  const handleZoomIn = useCallback(() => {
    setZoomLevel((z) => {
      const next = Math.min(z + 0.5, 5);
      sendDataMessage({ type: 'zoom', level: next });
      return next;
    });
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoomLevel((z) => {
      const next = Math.max(z - 0.5, 1);
      sendDataMessage({ type: 'zoom', level: next });
      return next;
    });
  }, []);

  // Pinch-to-zoom via built-in touch events
  const getDistance = (touches: any) => {
    const [t1, t2] = [touches[0], touches[1]];
    const dx = t1.pageX - t2.pageX;
    const dy = t1.pageY - t2.pageY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const handleTouchStart = useCallback((e: any) => {
    if (e.nativeEvent.touches.length === 2) {
      const dist = getDistance(e.nativeEvent.touches);
      pinchRef.current = { startDist: dist, startZoom: zoomLevel };
    }
  }, [zoomLevel]);

  const handleTouchMove = useCallback((e: any) => {
    if (e.nativeEvent.touches.length === 2 && pinchRef.current) {
      const dist = getDistance(e.nativeEvent.touches);
      const scale = dist / pinchRef.current.startDist;
      applyZoom(pinchRef.current.startZoom * scale);
    }
  }, [applyZoom]);

  const handleTouchEnd = useCallback(() => {
    pinchRef.current = null;
  }, []);

  const handleShutter = () => {
    if (captureStatus !== 'idle') return;
    rlog.info('viewfinder', 'Shutter pressed');
    setCaptureStatus('capturing');
    sendDataMessage({ type: 'shutter' });
  };

  const handleRecord = () => {
    if (isRecording) {
      rlog.info('viewfinder', 'Stop recording pressed');
      sendDataMessage({ type: 'record-stop' });
      setIsRecording(false);
    } else {
      rlog.info('viewfinder', 'Start recording pressed');
      sendDataMessage({ type: 'record-start' });
      setIsRecording(true);
    }
  };

  const handleDisconnect = () => {
    sendDataMessage({ type: 'disconnect' });
    cleanupWebRTC(scannedRoomId ?? undefined);
    stopInCallManager();
    handleBack();
  };

  // Streaming — show live video with controls
  if (scannedRoomId && joinStatus === 'streaming' && remoteStreamUrl) {
    return (
      <View
        style={styles.container}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <RTCView
          streamURL={remoteStreamUrl}
          style={StyleSheet.absoluteFill}
          objectFit="cover"
          mirror={false}
        />

        {/* Top bar */}
        <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
          <Pressable onPress={handleDisconnect} style={styles.backButton} accessibilityLabel="Disconnect" accessibilityRole="button">
            <Text style={styles.backText}>← End</Text>
          </Pressable>
          <View style={styles.liveBadge}>
            <Text style={styles.liveText}>● LIVE</Text>
          </View>
          {isRecording && (
            <View style={styles.recBadge}>
              <Text style={styles.recText}>● REC</Text>
            </View>
          )}
        </View>

        {/* Capture feedback */}
        {captureStatus === 'capturing' && (
          <View style={styles.flashOverlay} pointerEvents="none" />
        )}
        {captureStatus === 'sending' && transferProgress && (
          <View style={styles.captureToast} pointerEvents="none">
            <Text style={styles.captureToastText}>
              Saving... {Math.round((transferProgress.received / transferProgress.total) * 100)}%
            </Text>
          </View>
        )}
        {captureStatus === 'sending' && !transferProgress && (
          <View style={styles.captureToast} pointerEvents="none">
            <Text style={styles.captureToastText}>Receiving...</Text>
          </View>
        )}
        {captureStatus === 'done' && (
          <View style={styles.captureToast} pointerEvents="none">
            <Text style={styles.captureToastText}>Saved to gallery</Text>
          </View>
        )}

        {/* Zoom controls — right side */}
        <View style={[styles.zoomControls, { bottom: insets.bottom + 110 }]}>
          <Pressable onPress={handleZoomIn} style={styles.zoomButton} accessibilityLabel="Zoom in" accessibilityRole="button">
            <Text style={styles.zoomButtonText}>+</Text>
          </Pressable>
          <Text style={styles.zoomLabel}>{zoomLevel.toFixed(1)}x</Text>
          <Pressable onPress={handleZoomOut} style={styles.zoomButton} accessibilityLabel="Zoom out" accessibilityRole="button">
            <Text style={styles.zoomButtonText}>-</Text>
          </Pressable>
        </View>

        {/* Bottom controls */}
        <View style={[styles.controlBar, { paddingBottom: insets.bottom + 16 }]}>
          {/* Record button (left) */}
          <Pressable onPress={handleRecord} style={[styles.recordButton, isRecording && styles.recordButtonActive]} accessibilityLabel={isRecording ? "Stop recording" : "Start recording"} accessibilityRole="button">
            <View style={[styles.recordInner, isRecording && styles.recordInnerActive]} />
          </Pressable>

          {/* Shutter button (center) */}
          <Pressable onPress={handleShutter} style={styles.shutterButton} disabled={captureStatus !== 'idle'} accessibilityLabel="Take photo" accessibilityRole="button">
            <View style={[styles.shutterInner, captureStatus === 'capturing' && styles.shutterCapturing]} />
          </Pressable>

          {/* Spacer (right) — keeps shutter centered */}
          <View style={{ width: 60 }} />
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
        <Pressable onPress={() => router.push('/about')} style={styles.aboutLink} accessibilityLabel="About" accessibilityRole="button">
          <Text style={styles.aboutLinkText}>About · version info</Text>
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
    marginRight: 8,
  },
  liveText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  recBadge: {
    backgroundColor: 'rgba(255,0,0,0.8)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    marginRight: 12,
  },
  recText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: 'bold',
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  zoomControls: {
    position: 'absolute', right: 16, zIndex: 10, alignItems: 'center', gap: 4,
  },
  zoomButton: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center', justifyContent: 'center',
  },
  zoomButtonText: { color: '#fff', fontSize: 24, fontWeight: 'bold', lineHeight: 26 },
  zoomLabel: { color: '#fff', fontSize: 13, fontWeight: '600', textShadowColor: '#000', textShadowRadius: 4 },
  controlBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 32,
    paddingTop: 20,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  shutterButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 4,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#fff',
  },
  shutterCapturing: {
    backgroundColor: '#ccc',
  },
  recordButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 3,
    borderColor: '#ff4444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordButtonActive: {
    borderColor: '#fff',
  },
  recordInner: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#ff4444',
  },
  recordInnerActive: {
    width: 24,
    height: 24,
    borderRadius: 4,
    backgroundColor: '#ff4444',
  },
  flashOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.6)',
    zIndex: 5,
  },
  captureToast: {
    position: 'absolute',
    top: '45%',
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    zIndex: 5,
  },
  captureToastText: {
    color: '#4aff9e',
    fontSize: 18,
    fontWeight: '600',
  },
  aboutLink: { marginTop: 14, paddingHorizontal: 12, paddingVertical: 6 },
  aboutLinkText: { color: 'rgba(255,255,255,0.45)', fontSize: 12 },
});
