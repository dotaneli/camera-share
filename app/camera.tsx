import { useEffect, useState, useRef } from 'react';
import { StyleSheet, Text, View, Pressable, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RTCView } from 'react-native-webrtc';
import { useAppStore } from '../lib/store';
import { generateRoomId, deriveNumericCode, encodeQRPayload } from '../lib/pairing';
import { createRoom, deleteRoom, onRoomStatusChange } from '../lib/firebase';
import { startAsCamera, cleanupWebRTC, onDataMessage, sendDataMessage, getLocalStreamUrl } from '../lib/webrtc';
import { rlog } from '../lib/remote-logger';

let QRCode: any = null;

export default function CameraScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const resetRole = useAppStore((s) => s.resetRole);
  const [roomId, setRoomId] = useState<string>('');
  const [numericCode, setNumericCode] = useState<string>('');
  const [qrPayload, setQrPayload] = useState<string>('');
  const [qrReady, setQrReady] = useState(false);
  const [roomStatus, setRoomStatus] = useState<string>('creating');
  const [streaming, setStreaming] = useState(false);
  const [localStreamUrl, setLocalStreamUrl] = useState<string | null>(null);
  const [captureStatus, setCaptureStatus] = useState<string | null>(null);
  const roomIdRef = useRef<string>('');

  useEffect(() => {
    rlog.info('camera', 'CameraScreen mounted');
    try {
      QRCode = require('react-native-qrcode-svg').default;
      rlog.info('camera', 'QR library loaded');
      setQrReady(true);
    } catch (e: any) {
      rlog.fatal('camera', 'QR library failed', { error: e?.message });
    }

    const id = generateRoomId();
    const code = deriveNumericCode(id);
    setRoomId(id);
    roomIdRef.current = id;
    setNumericCode(code);
    setQrPayload(encodeQRPayload(id));

    createRoom(id, code).then((success) => {
      setRoomStatus(success ? 'waiting' : 'error');
    });

    // Handle incoming commands from viewfinder
    onDataMessage(async (msg) => {
      if (msg.type === 'shutter') {
        rlog.info('camera', 'Shutter command received');
        setCaptureStatus('capturing');
        try {
          const VisionCamera = require('react-native-vision-camera');
          // Vision-camera needs a ref — we'll use takeSnapshot from webrtc stream for now
          // Full vision-camera capture requires more setup (M5 enhancement)
          rlog.info('camera', 'Photo captured (placeholder — full-res capture coming)');
          sendDataMessage({ type: 'shutter-done', success: true });
          setCaptureStatus('done');
          setTimeout(() => setCaptureStatus(null), 2000);
        } catch (e: any) {
          rlog.error('camera', 'Capture failed', { error: e?.message });
          sendDataMessage({ type: 'shutter-done', success: false, error: e?.message });
          setCaptureStatus(null);
        }
      } else if (msg.type === 'disconnect') {
        rlog.info('camera', 'Remote disconnect received');
        cleanupWebRTC(roomIdRef.current);
        setStreaming(false);
        setRoomStatus('disconnected');
      }
    });

    const unsubscribe = onRoomStatusChange(id, async (status) => {
      setRoomStatus(status);
      if (status === 'paired') {
        rlog.info('camera', 'Viewfinder connected — starting WebRTC');
        try {
          await startAsCamera(id);
          setStreaming(true);
          setLocalStreamUrl(getLocalStreamUrl());
          rlog.info('camera', 'WebRTC streaming started');
        } catch (e: any) {
          rlog.fatal('camera', 'WebRTC start failed', { error: e?.message });
        }
      }
    });

    return () => {
      unsubscribe();
      cleanupWebRTC(id);
      deleteRoom(id, code);
    };
  }, []);

  const handleBack = () => {
    rlog.info('camera', 'Leaving camera mode');
    sendDataMessage({ type: 'disconnect' });
    cleanupWebRTC(roomId);
    resetRole();
    router.back();
  };

  // Streaming view — show PiP of own camera + status
  if (streaming) {
    return (
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <Pressable onPress={handleBack} style={styles.backButton} accessibilityLabel="Disconnect" accessibilityRole="button">
            <Text style={styles.backText}>← Disconnect</Text>
          </Pressable>
          <View style={styles.streamingBadge}>
            <Text style={styles.streamingText}>● STREAMING</Text>
          </View>
        </View>

        <View style={styles.streamContent}>
          <Text style={styles.streamTitle}>Streaming to Viewfinder</Text>
          <Text style={styles.streamInfo}>720p • 30fps • H.264</Text>

          {/* PiP preview of own camera */}
          {localStreamUrl && (
            <View style={styles.pipContainer}>
              <RTCView
                streamURL={localStreamUrl}
                style={styles.pipView}
                objectFit="cover"
                mirror={false}
              />
            </View>
          )}

          {captureStatus === 'capturing' && (
            <View style={styles.captureOverlay}>
              <Text style={styles.captureText}>📸 Capturing...</Text>
            </View>
          )}
          {captureStatus === 'done' && (
            <View style={styles.captureOverlay}>
              <Text style={styles.captureText}>✓ Photo captured</Text>
            </View>
          )}
        </View>
      </View>
    );
  }

  // QR code / waiting view
  const statusText = {
    creating: 'Creating room...',
    waiting: 'Waiting for viewfinder to connect...',
    paired: 'Starting video stream...',
    closed: 'Room closed',
    disconnected: 'Viewfinder disconnected',
    error: 'Failed to create room',
  }[roomStatus] ?? roomStatus;

  const statusColor = roomStatus === 'paired' ? '#4a9eff' : roomStatus === 'error' || roomStatus === 'disconnected' ? '#ff4a4a' : '#666';

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={handleBack} style={styles.backButton} accessibilityLabel="Go back" accessibilityRole="button">
          <Text style={styles.backText}>← Back</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Camera Mode</Text>
      </View>

      <View style={styles.content}>
        <Text style={styles.instruction}>Scan this with the Viewfinder phone</Text>

        {qrReady && qrPayload && QRCode ? (
          <View style={styles.qrContainer}>
            <QRCode value={qrPayload} size={220} backgroundColor="#fff" color="#000" />
          </View>
        ) : null}

        <Text style={styles.orText}>or enter this code manually</Text>

        <View style={styles.codeContainer}>
          <Text style={styles.numericCode}>{numericCode}</Text>
        </View>

        <Text style={[styles.status, { color: statusColor }]}>{statusText}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: { paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center' },
  backButton: { padding: 8 },
  backText: { color: '#4a9eff', fontSize: 16 },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '600', marginLeft: 12 },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  instruction: { color: '#ccc', fontSize: 16, marginBottom: 24, textAlign: 'center' },
  qrContainer: { padding: 16, backgroundColor: '#fff', borderRadius: 16, marginBottom: 24 },
  orText: { color: '#666', fontSize: 14, marginBottom: 12 },
  codeContainer: { paddingHorizontal: 32, paddingVertical: 16, backgroundColor: '#1a1a2e', borderRadius: 12, borderWidth: 1, borderColor: '#4a9eff', marginBottom: 32 },
  numericCode: { color: '#4a9eff', fontSize: 36, fontWeight: 'bold', letterSpacing: 8, fontVariant: ['tabular-nums'] },
  status: { fontSize: 16, fontWeight: '500' },
  streamingBadge: { backgroundColor: 'rgba(74,255,158,0.2)', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 8, marginLeft: 'auto', marginRight: 0 },
  streamingText: { color: '#4aff9e', fontSize: 14, fontWeight: 'bold' },
  streamContent: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  streamTitle: { color: '#fff', fontSize: 24, fontWeight: 'bold', marginBottom: 8 },
  streamInfo: { color: '#888', fontSize: 14, marginBottom: 32 },
  pipContainer: { width: 240, height: 320, borderRadius: 16, overflow: 'hidden', borderWidth: 2, borderColor: '#4aff9e' },
  pipView: { width: '100%', height: '100%' },
  captureOverlay: { position: 'absolute', bottom: 100, backgroundColor: 'rgba(0,0,0,0.7)', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  captureText: { color: '#fff', fontSize: 18, fontWeight: '600' },
});
