import { useEffect, useState, useRef, useCallback } from 'react';
import { StyleSheet, Text, View, Pressable, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RTCView } from 'react-native-webrtc';
import { useAppStore } from '../lib/store';
import { generateRoomId, deriveNumericCode, encodeQRPayload } from '../lib/pairing';
import { createRoom, deleteRoom, onRoomStatusChange } from '../lib/firebase';
import {
  startAsCamera, cleanupWebRTC, onDataMessage, sendDataMessage,
  initPreviewStream, getLocalStreamUrl, setHardwareZoom,
  pauseCameraCapture, resumeCameraCapture,
} from '../lib/webrtc';
import { sendFile } from '../lib/file-transfer';
import { rlog } from '../lib/remote-logger';

let QRCode: any = null;

export default function CameraScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const resetRole = useAppStore((s) => s.resetRole);

  const [roomId, setRoomId] = useState('');
  const [numericCode, setNumericCode] = useState('');
  const [qrPayload, setQrPayload] = useState('');
  const [qrReady, setQrReady] = useState(false);
  const [roomStatus, setRoomStatus] = useState<string>('creating');
  const [streaming, setStreaming] = useState(false);
  const [localStreamUrl, setLocalStreamUrl] = useState<string | null>(null);
  const [captureStatus, setCaptureStatus] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const zoomRef = useRef(1);
  const [visionCameraActive, setVisionCameraActive] = useState(false);
  const [visionCameraAudio, setVisionCameraAudio] = useState(false);

  const roomIdRef = useRef('');
  const visionCameraRef = useRef<any>(null);
  const visionCameraReadyRef = useRef(false);

  // Why: vision-camera's <Camera> initializes asynchronously after mount.
  // Racing takePhoto against an uninitialized camera silently fails.
  const waitForVisionCamera = useCallback(async (timeoutMs = 3500) => {
    const start = Date.now();
    while (!visionCameraReadyRef.current && Date.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, 50));
    }
    return visionCameraReadyRef.current;
  }, []);

  // Start camera preview immediately on mount
  useEffect(() => {
    rlog.info('camera', 'CameraScreen mounted');

    // Load QR library
    try {
      QRCode = require('react-native-qrcode-svg').default;
      setQrReady(true);
    } catch (e: any) {
      rlog.fatal('camera', 'QR library failed', { error: e?.message });
    }

    // Pre-request vision-camera permissions so the first shutter doesn't stall on a prompt.
    // Why: webrtc has its own permission flow for getUserMedia; vision-camera needs a separate
    // grant before takePhoto/startRecording works. Requesting early lets the OS cache the grant.
    (async () => {
      try {
        const VC = require('react-native-vision-camera');
        const camStatus = await VC.Camera.getCameraPermissionStatus();
        if (camStatus !== 'granted') {
          const r = await VC.Camera.requestCameraPermission();
          rlog.info('camera', 'Pre-warmed camera permission', { result: r });
        }
        const micStatus = await VC.Camera.getMicrophonePermissionStatus();
        if (micStatus !== 'granted') {
          const r = await VC.Camera.requestMicrophonePermission();
          rlog.info('camera', 'Pre-warmed microphone permission', { result: r });
        }
      } catch (e: any) {
        rlog.warn('camera', 'Permission pre-warm failed', { error: e?.message });
      }
    })();

    // Start a preview-only stream (separate from peer connection stream)
    initPreviewStream().then((url) => {
      setLocalStreamUrl(url);
      rlog.info('camera', 'Camera preview started');
    }).catch((e: any) => {
      rlog.fatal('camera', 'Camera preview failed', { error: e?.message });
    });

    // Create room for pairing
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
      if (msg.type === 'zoom') {
        zoomRef.current = msg.level ?? 1;
        setHardwareZoom(zoomRef.current);
        rlog.info('camera', 'Zoom updated', { zoom: zoomRef.current });
      } else if (msg.type === 'shutter') {
        handleCapturePhoto();
      } else if (msg.type === 'record-start') {
        handleStartRecording();
      } else if (msg.type === 'record-stop') {
        handleStopRecording();
      } else if (msg.type === 'disconnect') {
        rlog.info('camera', 'Remote disconnect received');
        cleanupWebRTC(roomIdRef.current);
        setStreaming(false);
        setRoomStatus('disconnected');
      }
    });

    // Listen for viewfinder joining
    const unsubscribe = onRoomStatusChange(id, async (status) => {
      setRoomStatus(status);
      if (status === 'paired') {
        rlog.info('camera', 'Viewfinder connected — starting WebRTC');
        try {
          await startAsCamera(id);
          setStreaming(true);
          // Update preview to use the peer connection's fresh stream
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

  // Why: vision-camera and webrtc can't own the same physical camera simultaneously.
  // We release webrtc → let vision-camera open the camera → capture → unmount vision-camera →
  // re-acquire via getUserMedia → replaceTrack on the existing sender (no SDP renegotiation).
  const activateVisionCamera = useCallback(async (withAudio: boolean) => {
    visionCameraReadyRef.current = false;
    setVisionCameraAudio(withAudio);
    await pauseCameraCapture();
    setVisionCameraActive(true);
    const ready = await waitForVisionCamera();
    if (!ready) {
      rlog.error('camera', 'Vision camera never initialized');
      setVisionCameraActive(false);
      await resumeCameraCapture().then((url) => url && setLocalStreamUrl(url));
      return null;
    }
    return visionCameraRef.current;
  }, [waitForVisionCamera]);

  const deactivateVisionCamera = useCallback(async () => {
    setVisionCameraActive(false);
    visionCameraReadyRef.current = false;
    const url = await resumeCameraCapture();
    if (url) setLocalStreamUrl(url);
  }, []);

  // Save captured media to the camera phone's gallery too — durability if the
  // viewfinder disconnects mid-transfer, or the user wants the photo on both phones.
  const saveToLocalGallery = useCallback(async (path: string) => {
    try {
      const MediaLibrary = require('expo-media-library') as typeof import('expo-media-library');
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        rlog.warn('camera', 'Local media-library permission denied');
        return;
      }
      const uri = path.startsWith('file://') ? path : `file://${path}`;
      await MediaLibrary.saveToLibraryAsync(uri);
      rlog.info('camera', 'Saved to local gallery', { uri });
    } catch (e: any) {
      rlog.error('camera', 'Local gallery save failed', { error: e?.message });
    }
  }, []);

  // ── Photo capture ──
  const handleCapturePhoto = useCallback(async () => {
    rlog.info('camera', 'Shutter command received');
    setCaptureStatus('capturing');
    try {
      const camera = await activateVisionCamera(false);
      if (!camera) {
        sendDataMessage({ type: 'shutter-done', success: false, error: 'Camera not ready' });
        setCaptureStatus(null);
        return;
      }
      const photo = await camera.takePhoto({
        qualityPrioritization: 'quality',
        enableShutterSound: true,
      });
      rlog.info('camera', 'Photo captured', { path: photo.path, width: photo.width, height: photo.height });

      const photoPath = photo.path.startsWith('file://') ? photo.path : `file://${photo.path}`;
      await saveToLocalGallery(photoPath);

      await deactivateVisionCamera();

      setCaptureStatus('sending');
      sendDataMessage({ type: 'shutter-done', success: true });
      await sendFile(photoPath, 'photo');
      setCaptureStatus('done');
      setTimeout(() => setCaptureStatus(null), 2000);
    } catch (e: any) {
      rlog.error('camera', 'Capture failed', { error: e?.message });
      sendDataMessage({ type: 'shutter-done', success: false, error: e?.message });
      setCaptureStatus(null);
      await deactivateVisionCamera();
    }
  }, [activateVisionCamera, deactivateVisionCamera, saveToLocalGallery]);

  // ── Video recording ──
  const handleStartRecording = useCallback(async () => {
    rlog.info('camera', 'Record start command received');
    setIsRecording(true);
    setCaptureStatus('recording');
    try {
      const camera = await activateVisionCamera(true);
      if (!camera) {
        sendDataMessage({ type: 'record-ack', recording: false, error: 'Camera not ready' });
        setCaptureStatus(null);
        setIsRecording(false);
        return;
      }
      camera.startRecording({
        onRecordingFinished: async (video: any) => {
          rlog.info('camera', 'Video recorded', { path: video.path, duration: video.duration });
          const videoPath = video.path.startsWith('file://') ? video.path : `file://${video.path}`;
          await saveToLocalGallery(videoPath);
          await deactivateVisionCamera();
          setCaptureStatus('sending');
          sendDataMessage({ type: 'record-done', duration: video.duration });
          await sendFile(videoPath, 'video');
          setCaptureStatus(null);
          setIsRecording(false);
        },
        onRecordingError: async (error: any) => {
          rlog.error('camera', 'Recording error', { error: error?.message });
          await deactivateVisionCamera();
          sendDataMessage({ type: 'record-done', error: error?.message });
          setCaptureStatus(null);
          setIsRecording(false);
        },
      });
      sendDataMessage({ type: 'record-ack', recording: true });
    } catch (e: any) {
      rlog.error('camera', 'Start recording failed', { error: e?.message });
      await deactivateVisionCamera();
      setCaptureStatus(null);
      setIsRecording(false);
    }
  }, [activateVisionCamera, deactivateVisionCamera, saveToLocalGallery]);

  const handleStopRecording = useCallback(async () => {
    rlog.info('camera', 'Record stop command received');
    try {
      const camera = visionCameraRef.current;
      if (camera) {
        await camera.stopRecording();
      }
    } catch (e: any) {
      rlog.error('camera', 'Stop recording failed', { error: e?.message });
    }
  }, []);

  // ── Disconnect ──
  const handleBack = () => {
    rlog.info('camera', 'Leaving camera mode');
    sendDataMessage({ type: 'disconnect' });
    cleanupWebRTC(roomId);
    resetRole();
    router.back();
  };

  // ── Vision Camera for high-res capture (rendered but small/hidden) ──
  let VisionCameraComponent: any = null;
  let useCameraDeviceHook: any = null;
  try {
    const VC = require('react-native-vision-camera');
    VisionCameraComponent = VC.Camera;
    useCameraDeviceHook = VC.useCameraDevice;
  } catch {}

  // Status line
  const paired = streaming || roomStatus === 'paired';
  const statusText = paired
    ? (captureStatus === 'recording' ? 'Recording...' : captureStatus === 'sending' ? 'Sending...' : 'Streaming')
    : roomStatus === 'waiting' ? 'Waiting for viewfinder...'
    : roomStatus === 'creating' ? 'Starting...'
    : roomStatus === 'disconnected' ? 'Disconnected'
    : roomStatus === 'error' ? 'Error' : roomStatus;

  return (
    <View style={styles.container}>
      {/* Preview: swap between webrtc stream (normal) and vision-camera (during capture).
          Why: on Android, vision-camera's SurfaceView ignores 1×1/opacity-0 sizing and paints
          directly to the window, which caused a split-screen overlay during record. Rendering
          only one preview at a time avoids the conflict. */}
      {!visionCameraActive && localStreamUrl && (
        <RTCView
          streamURL={localStreamUrl}
          style={StyleSheet.absoluteFill}
          objectFit="cover"
          mirror={false}
          zOrder={0}
        />
      )}
      {!visionCameraActive && !localStreamUrl && (
        <View style={[StyleSheet.absoluteFill, styles.loadingBg]}>
          <Text style={styles.loadingText}>Starting camera...</Text>
        </View>
      )}

      {VisionCameraComponent && visionCameraActive && (
        <VisionCameraCapture
          CameraComponent={VisionCameraComponent}
          useCameraDevice={useCameraDeviceHook}
          cameraRef={visionCameraRef}
          zoom={zoomRef.current}
          audio={visionCameraAudio}
          onInitialized={() => {
            visionCameraReadyRef.current = true;
            rlog.info('camera', 'Vision camera initialized');
          }}
          onError={(err: any) => rlog.error('camera', 'Vision camera error', { error: err?.message })}
        />
      )}

      {/* Top bar */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={handleBack} style={styles.pillButton} accessibilityLabel="Disconnect" accessibilityRole="button">
          <Text style={styles.pillText}>← {streaming ? 'End' : 'Back'}</Text>
        </Pressable>

        <View style={[styles.statusPill, { backgroundColor: paired ? 'rgba(74,255,158,0.25)' : 'rgba(255,255,255,0.15)' }]}>
          <Text style={[styles.statusText, { color: paired ? '#4aff9e' : '#aaa' }]}>
            {paired ? '● ' : ''}{statusText}
          </Text>
        </View>
      </View>

      {/* QR overlay — shown before pairing */}
      {!paired && qrReady && qrPayload && QRCode && (
        <View style={styles.qrOverlay}>
          <View style={styles.qrCard}>
            <QRCode value={qrPayload} size={140} backgroundColor="#fff" color="#000" />
          </View>
          <Text style={styles.qrLabel}>Scan with viewfinder phone</Text>
          <View style={styles.codePill}>
            <Text style={styles.codeText}>{numericCode}</Text>
          </View>
          <Pressable onPress={() => router.push('/about')} style={styles.aboutLink} accessibilityLabel="About" accessibilityRole="button">
            <Text style={styles.aboutLinkText}>About · version info</Text>
          </Pressable>
        </View>
      )}

      {/* Capture feedback overlays */}
      {captureStatus === 'capturing' && (
        <View style={styles.flashOverlay} pointerEvents="none" />
      )}
      {captureStatus === 'done' && (
        <View style={styles.toast} pointerEvents="none">
          <Text style={styles.toastText}>Photo sent</Text>
        </View>
      )}
      {captureStatus === 'sending' && (
        <View style={styles.toast} pointerEvents="none">
          <Text style={styles.toastText}>Sending...</Text>
        </View>
      )}
      {captureStatus === 'recording' && (
        <View style={styles.recIndicator} pointerEvents="none">
          <Text style={styles.recText}>● REC</Text>
        </View>
      )}

      {/* Bottom info */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}>
        {!paired && <Text style={styles.bottomHint}>Point the Viewfinder phone at the QR code above</Text>}
        {paired && <Text style={styles.streamInfo}>720p · 30fps · H.264</Text>}
      </View>
    </View>
  );
}

/** Vision Camera for high-res capture — full-screen preview while active. */
function VisionCameraCapture({
  CameraComponent,
  useCameraDevice,
  cameraRef,
  zoom,
  audio,
  onInitialized,
  onError,
}: {
  CameraComponent: any;
  useCameraDevice: any;
  cameraRef: any;
  zoom: number;
  audio: boolean;
  onInitialized: () => void;
  onError: (err: any) => void;
}) {
  const device = useCameraDevice('back');
  if (!device) return null;

  return (
    <CameraComponent
      ref={cameraRef}
      style={StyleSheet.absoluteFill}
      device={device}
      isActive={true}
      photo={true}
      video={true}
      audio={audio}
      zoom={zoom}
      onInitialized={onInitialized}
      onError={onError}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  loadingBg: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#111' },
  loadingText: { color: '#666', fontSize: 16 },

  // Top bar
  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 8,
  },
  pillButton: {
    backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
  },
  pillText: { color: '#4aff9e', fontSize: 15, fontWeight: '600' },
  statusPill: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, marginLeft: 'auto',
  },
  statusText: { fontSize: 13, fontWeight: '600' },

  // QR overlay
  qrOverlay: {
    position: 'absolute', top: '22%', alignSelf: 'center', zIndex: 5,
    alignItems: 'center',
  },
  qrCard: {
    padding: 12, backgroundColor: '#fff', borderRadius: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.5, shadowRadius: 12, elevation: 8,
  },
  qrLabel: { color: '#fff', fontSize: 14, marginTop: 12, textShadowColor: '#000', textShadowRadius: 6 },
  codePill: {
    marginTop: 8, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 20, paddingVertical: 8, borderRadius: 12,
    borderWidth: 1, borderColor: 'rgba(74,158,255,0.5)',
  },
  codeText: { color: '#4a9eff', fontSize: 22, fontWeight: 'bold', letterSpacing: 6, fontVariant: ['tabular-nums'] },
  aboutLink: { marginTop: 24, paddingHorizontal: 12, paddingVertical: 6 },
  aboutLinkText: { color: 'rgba(255,255,255,0.45)', fontSize: 12 },

  // Capture overlays
  flashOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(255,255,255,0.6)', zIndex: 15 },
  toast: {
    position: 'absolute', top: '45%', alignSelf: 'center', zIndex: 15,
    backgroundColor: 'rgba(0,0,0,0.7)', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12,
  },
  toastText: { color: '#4aff9e', fontSize: 18, fontWeight: '600' },
  recIndicator: {
    position: 'absolute', top: '12%', alignSelf: 'center', zIndex: 15,
    backgroundColor: 'rgba(255,0,0,0.8)', paddingHorizontal: 16, paddingVertical: 6, borderRadius: 8,
  },
  recText: { color: '#fff', fontSize: 15, fontWeight: 'bold' },

  // Bottom
  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 5,
    alignItems: 'center', paddingHorizontal: 24,
  },
  bottomHint: { color: 'rgba(255,255,255,0.6)', fontSize: 14, textAlign: 'center' },
  streamInfo: { color: 'rgba(255,255,255,0.5)', fontSize: 12, textAlign: 'center' },

});
