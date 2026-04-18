import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  mediaDevices,
  MediaStream,
} from 'react-native-webrtc';
import { NativeModules } from 'react-native';
import database from '@react-native-firebase/database';
import { rlog } from './remote-logger';

const { WebRTCModule } = NativeModules;

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

let peerConnection: RTCPeerConnection | null = null;
let localStream: MediaStream | null = null;
let dataChannel: any = null;
let onMessageCallback: ((msg: any) => void) | null = null;
/** Register a handler for incoming data channel messages */
export function onDataMessage(callback: (msg: any) => void) {
  onMessageCallback = callback;
}

/** Send a message via data channel */
export function sendDataMessage(msg: any) {
  if (dataChannel && dataChannel.readyState === 'open') {
    dataChannel.send(JSON.stringify(msg));
    rlog.info('webrtc', 'Data message sent', { type: msg.type });
  } else {
    rlog.warn('webrtc', 'Data channel not open, message dropped', { type: msg.type });
  }
}

/** Send raw string data (for file transfer chunks) */
export function sendRawData(data: string) {
  if (dataChannel && dataChannel.readyState === 'open') {
    dataChannel.send(data);
  }
}

/** Get the local stream URL for preview on camera phone */
export function getLocalStreamUrl(): string | null {
  return localStream ? (localStream as any).toURL() : null;
}

/**
 * Apply hardware zoom to the active camera stream.
 *
 * Prefers the promise-returning `mediaStreamTrackSetZoomWithResult` (added to
 * Android by the withWebRTCZoom plugin in the latest native build). That variant
 * resolves with `{ ok, reason }` so we can log why zoom didn't apply when it doesn't.
 *
 * Falls back to the fire-and-forget `mediaStreamTrackSetZoom` on iOS and on older
 * Android builds that predate the diagnostic method, so iOS zoom continues to work
 * across an OTA gap before the matching native build is installed.
 */
export async function setHardwareZoom(zoomFactor: number) {
  if (!localStream) {
    rlog.debug('webrtc', 'No local stream for zoom');
    return;
  }
  const videoTrack = localStream.getVideoTracks()[0];
  if (!videoTrack) return;
  const trackId = (videoTrack as any)._id || (videoTrack as any).id;

  if (typeof WebRTCModule?.mediaStreamTrackSetZoomWithResult === 'function') {
    try {
      const result = await WebRTCModule.mediaStreamTrackSetZoomWithResult(trackId, zoomFactor);
      if (result?.ok) {
        rlog.debug('webrtc', 'Hardware zoom applied', { zoom: zoomFactor });
      } else {
        rlog.warn('webrtc', 'Hardware zoom did not apply', { zoom: zoomFactor, reason: result?.reason });
      }
      return;
    } catch (e: any) {
      rlog.warn('webrtc', 'Hardware zoom native error', { zoom: zoomFactor, error: e?.message });
      return;
    }
  }

  try {
    WebRTCModule.mediaStreamTrackSetZoom(trackId, zoomFactor);
    rlog.debug('webrtc', 'Hardware zoom applied (legacy)', { zoom: zoomFactor });
  } catch (e: any) {
    rlog.debug('webrtc', 'Hardware zoom failed (legacy)', { error: e?.message });
  }
}

/** Start a preview-only stream (separate from the peer connection stream) */
export async function initPreviewStream(): Promise<string> {
  const preview = await getLocalStream();
  localStream = preview as MediaStream;
  return (preview as any).toURL();
}

/**
 * Release the local camera so another library (vision-camera) can open it.
 * Why: Android/iOS only permit one owner of a physical camera device at a time.
 * Stops the track(s) but keeps the peer connection open for sender.replaceTrack() on resume.
 */
export async function pauseCameraCapture(): Promise<void> {
  if (!localStream) {
    rlog.debug('webrtc', 'pauseCameraCapture: no local stream');
    return;
  }
  rlog.info('webrtc', 'Pausing camera capture (releasing hardware)');
  localStream.getTracks().forEach((t) => t.stop());
}

/**
 * Re-acquire the camera after a pause and wire the new track into the peer connection.
 * Uses RTCRtpSender.replaceTrack to avoid SDP renegotiation.
 * Returns the new stream URL for the local preview, or null if there is no peer connection.
 */
export async function resumeCameraCapture(): Promise<string | null> {
  rlog.info('webrtc', 'Resuming camera capture');
  const newStream = await getLocalStream();
  localStream = newStream;

  if (peerConnection) {
    const senders = (peerConnection as any).getSenders?.() ?? [];
    for (const sender of senders) {
      const kind = sender.track?.kind;
      const newTrack = newStream.getTracks().find((t) => t.kind === kind);
      if (newTrack) {
        try {
          await sender.replaceTrack(newTrack);
          rlog.info('webrtc', 'Track replaced on sender', { kind });
        } catch (e: any) {
          rlog.error('webrtc', 'replaceTrack failed', { kind, error: e?.message });
        }
      }
    }
  }

  return (newStream as any).toURL();
}

/** Get the local camera stream (1080p, rear camera, with audio) */
async function getLocalStream(): Promise<MediaStream> {
  rlog.info('webrtc', 'Getting local camera stream');
  const stream = await mediaDevices.getUserMedia({
    audio: true,
    video: {
      facingMode: 'environment',
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 30 },
    },
  });
  rlog.info('webrtc', 'Local stream acquired', {
    tracks: (stream as any).getTracks().length,
  });
  return stream as MediaStream;
}

/** Create peer connection and set up ICE candidate exchange via Firebase */
function createPeerConnection(
  roomId: string,
  role: 'camera' | 'viewfinder',
  onRemoteStream: (stream: MediaStream) => void,
): RTCPeerConnection {
  rlog.info('webrtc', 'Creating peer connection', { role });
  const pc = new RTCPeerConnection(ICE_SERVERS) as any;

  // Log ICE connection state changes
  pc.addEventListener('iceconnectionstatechange', () => {
    rlog.info('webrtc', 'ICE state', { state: pc.iceConnectionState });
  });

  pc.addEventListener('connectionstatechange', () => {
    rlog.info('webrtc', 'Connection state', { state: pc.connectionState });
  });

  // Send ICE candidates to Firebase
  const myRole = role;
  const otherRole = role === 'camera' ? 'viewfinder' : 'camera';

  pc.addEventListener('icecandidate', (event: any) => {
    if (event.candidate) {
      rlog.debug('webrtc', 'Sending ICE candidate', { type: event.candidate.type });
      database()
        .ref(`/rooms/${roomId}/iceCandidates/${myRole}`)
        .push()
        .set({
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid,
          sdpMLineIndex: event.candidate.sdpMLineIndex,
        })
        .catch((e: any) => rlog.error('webrtc', 'Failed to send ICE candidate', { error: e?.message }));
    }
  });

  // Handle remote stream
  pc.addEventListener('track', (event: any) => {
    rlog.info('webrtc', 'Remote track received', { kind: event.track?.kind });
    if (event.streams && event.streams[0]) {
      onRemoteStream(event.streams[0] as MediaStream);
    }
  });

  return pc;
}

/** Start listening for remote ICE candidates — call AFTER remote description is set */
function listenForIceCandidates(roomId: string, role: 'camera' | 'viewfinder', pc: any) {
  const otherRole = role === 'camera' ? 'viewfinder' : 'camera';
  database()
    .ref(`/rooms/${roomId}/iceCandidates/${otherRole}`)
    .on('child_added', (snapshot) => {
      const data = snapshot.val();
      if (data) {
        rlog.debug('webrtc', 'Received ICE candidate');
        pc.addIceCandidate(new RTCIceCandidate(data))
          .catch((e: any) => rlog.error('webrtc', 'Failed to add ICE candidate', { error: e?.message }));
      }
    });
}

/** Camera phone: create offer and start streaming */
export async function startAsCamera(
  roomId: string,
): Promise<{ localStream: MediaStream; peerConnection: RTCPeerConnection }> {
  rlog.info('webrtc', 'Starting as camera');

  // Always create a fresh stream for the peer connection
  // (preview stream is separate and will be released when this grabs the camera)
  localStream = await getLocalStream();
  peerConnection = createPeerConnection(roomId, 'camera', () => {
    // Camera doesn't need remote stream
  });

  // Add local tracks to peer connection
  localStream.getTracks().forEach((track) => {
    peerConnection!.addTrack(track, localStream!);
  });
  rlog.info('webrtc', 'Local tracks added to peer connection');

  // Create data channel (camera is the initiator)
  dataChannel = (peerConnection as any).createDataChannel('control', { ordered: true });
  dataChannel.onopen = () => rlog.info('webrtc', 'Data channel opened (camera)');
  dataChannel.onclose = () => rlog.info('webrtc', 'Data channel closed (camera)');
  dataChannel.onmessage = (event: any) => {
    try {
      const msg = JSON.parse(event.data);
      rlog.info('webrtc', 'Data message received', { type: msg.type });
      if (onMessageCallback) onMessageCallback(msg);
    } catch (e) {
      rlog.error('webrtc', 'Failed to parse data message');
    }
  };

  // Create and set offer
  const offer = await peerConnection.createOffer({});
  await peerConnection.setLocalDescription(offer);
  rlog.info('webrtc', 'Offer created and set as local description');

  // Write offer to Firebase
  await database().ref(`/rooms/${roomId}/offer`).set({
    sdp: offer.sdp,
    type: offer.type,
  });
  rlog.info('webrtc', 'Offer written to Firebase');

  // Listen for answer, then start ICE candidate exchange
  database()
    .ref(`/rooms/${roomId}/answer`)
    .on('value', async (snapshot) => {
      const answer = snapshot.val();
      if (answer && answer.sdp && peerConnection && !peerConnection.remoteDescription) {
        rlog.info('webrtc', 'Answer received from viewfinder');
        await peerConnection.setRemoteDescription(
          new RTCSessionDescription(answer),
        );
        rlog.info('webrtc', 'Remote description set — starting ICE exchange');
        listenForIceCandidates(roomId, 'camera', peerConnection);
      }
    });

  return { localStream, peerConnection };
}

/** Viewfinder phone: receive offer, send answer, get remote stream */
export async function startAsViewfinder(
  roomId: string,
  onRemoteStream: (stream: MediaStream) => void,
): Promise<RTCPeerConnection> {
  rlog.info('webrtc', 'Starting as viewfinder');

  peerConnection = createPeerConnection(roomId, 'viewfinder', onRemoteStream);

  // Listen for data channel from camera
  (peerConnection as any).addEventListener('datachannel', (event: any) => {
    dataChannel = event.channel;
    dataChannel.onopen = () => rlog.info('webrtc', 'Data channel opened (viewfinder)');
    dataChannel.onclose = () => rlog.info('webrtc', 'Data channel closed (viewfinder)');
    dataChannel.onmessage = (evt: any) => {
      try {
        const msg = JSON.parse(evt.data);
        rlog.info('webrtc', 'Data message received', { type: msg.type });
        if (onMessageCallback) onMessageCallback(msg);
      } catch (e) {
        rlog.error('webrtc', 'Failed to parse data message');
      }
    };
  });

  // Wait for offer to appear in Firebase (camera may still be creating it)
  rlog.info('webrtc', 'Waiting for offer from camera...');
  const offer = await new Promise<any>((resolve, reject) => {
    const timeout = setTimeout(() => {
      ref.off('value', listener);
      reject(new Error('Timeout waiting for offer (30s)'));
    }, 30000);

    const ref = database().ref(`/rooms/${roomId}/offer`);
    const listener = ref.on('value', (snapshot) => {
      const data = snapshot.val();
      if (data && data.sdp) {
        clearTimeout(timeout);
        ref.off('value', listener);
        resolve(data);
      }
    });
  });

  rlog.info('webrtc', 'Offer received from camera');
  await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));

  // Now safe to listen for ICE candidates
  listenForIceCandidates(roomId, 'viewfinder', peerConnection);

  // Create and set answer
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);
  rlog.info('webrtc', 'Answer created and set as local description');

  // Write answer to Firebase
  await database().ref(`/rooms/${roomId}/answer`).set({
    sdp: answer.sdp,
    type: answer.type,
  });
  rlog.info('webrtc', 'Answer written to Firebase');

  return peerConnection;
}

/** Clean up WebRTC resources */
export function cleanupWebRTC(roomId?: string) {
  rlog.info('webrtc', 'Cleaning up');
  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
    localStream = null;
  }
  if (dataChannel) {
    dataChannel.close();
    dataChannel = null;
  }
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  onMessageCallback = null;
  if (roomId) {
    database().ref(`/rooms/${roomId}/iceCandidates`).off();
    database().ref(`/rooms/${roomId}/answer`).off();
    database().ref(`/rooms/${roomId}/offer`).off();
  }
}
