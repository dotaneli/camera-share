import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  mediaDevices,
  MediaStream,
} from 'react-native-webrtc';
import database from '@react-native-firebase/database';
import { rlog } from './remote-logger';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

let peerConnection: RTCPeerConnection | null = null;
let localStream: MediaStream | null = null;

/** Get the local camera stream (720p, rear camera) */
async function getLocalStream(): Promise<MediaStream> {
  rlog.info('webrtc', 'Getting local camera stream');
  const stream = await mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: 'environment',
      width: { ideal: 1280 },
      height: { ideal: 720 },
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

  localStream = await getLocalStream();
  peerConnection = createPeerConnection(roomId, 'camera', () => {
    // Camera doesn't need remote stream
  });

  // Add local tracks to peer connection
  localStream.getTracks().forEach((track) => {
    peerConnection!.addTrack(track, localStream!);
  });
  rlog.info('webrtc', 'Local tracks added to peer connection');

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
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  if (roomId) {
    database().ref(`/rooms/${roomId}/iceCandidates`).off();
    database().ref(`/rooms/${roomId}/answer`).off();
    database().ref(`/rooms/${roomId}/offer`).off();
  }
}
