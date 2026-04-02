import { useEffect, useState } from 'react';
import { StyleSheet, Text, View, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppStore } from '../lib/store';
import { generateRoomId, deriveNumericCode, encodeQRPayload } from '../lib/pairing';
import { createRoom, deleteRoom, onRoomStatusChange } from '../lib/firebase';
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
    setNumericCode(code);
    setQrPayload(encodeQRPayload(id));

    // Create room in Firebase
    createRoom(id, code).then((success) => {
      setRoomStatus(success ? 'waiting' : 'error');
    });

    // Listen for viewfinder joining
    const unsubscribe = onRoomStatusChange(id, (status) => {
      setRoomStatus(status);
      if (status === 'paired') {
        rlog.info('camera', 'Viewfinder connected!');
      }
    });

    return () => {
      unsubscribe();
      deleteRoom(id, code);
    };
  }, []);

  const handleBack = () => {
    rlog.info('camera', 'Leaving camera mode');
    resetRole();
    router.back();
  };

  const statusText = {
    creating: 'Creating room...',
    waiting: 'Waiting for viewfinder to connect...',
    paired: 'Viewfinder connected!',
    closed: 'Room closed',
    error: 'Failed to create room',
  }[roomStatus] ?? roomStatus;

  const statusColor = roomStatus === 'paired' ? '#4aff9e' : roomStatus === 'error' ? '#ff4a4a' : '#666';

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
            <QRCode
              value={qrPayload}
              size={220}
              backgroundColor="#fff"
              color="#000"
            />
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
  },
  backText: {
    color: '#4a9eff',
    fontSize: 16,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    marginLeft: 12,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  instruction: {
    color: '#ccc',
    fontSize: 16,
    marginBottom: 24,
    textAlign: 'center',
  },
  qrContainer: {
    padding: 16,
    backgroundColor: '#fff',
    borderRadius: 16,
    marginBottom: 24,
  },
  orText: {
    color: '#666',
    fontSize: 14,
    marginBottom: 12,
  },
  codeContainer: {
    paddingHorizontal: 32,
    paddingVertical: 16,
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#4a9eff',
    marginBottom: 32,
  },
  numericCode: {
    color: '#4a9eff',
    fontSize: 36,
    fontWeight: 'bold',
    letterSpacing: 8,
    fontVariant: ['tabular-nums'],
  },
  status: {
    fontSize: 16,
    fontWeight: '500',
  },
});
