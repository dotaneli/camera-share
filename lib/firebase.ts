import { firebase } from '@react-native-firebase/app';
import auth from '@react-native-firebase/auth';
import database from '@react-native-firebase/database';
import { rlog } from './remote-logger';

let initialized = false;

/** Sign in anonymously — called once on app launch */
export async function initAuth(): Promise<string | null> {
  try {
    if (!initialized) {
      rlog.info('firebase', 'Initializing anonymous auth');
      const result = await auth().signInAnonymously();
      initialized = true;
      const uid = result.user.uid;
      rlog.info('firebase', 'Auth success', { uid: uid.substring(0, 8) });
      return uid;
    }
    return auth().currentUser?.uid ?? null;
  } catch (e: any) {
    rlog.fatal('firebase', 'Auth failed', { error: e?.message });
    return null;
  }
}

/** Get current user ID */
export function getUid(): string | null {
  return auth().currentUser?.uid ?? null;
}

/** Create a room (camera phone) */
export async function createRoom(roomId: string, numericCode: string): Promise<boolean> {
  try {
    const uid = getUid();
    if (!uid) {
      rlog.error('firebase', 'createRoom: not authenticated');
      return false;
    }

    const roomRef = database().ref(`/rooms/${roomId}`);
    await roomRef.set({
      metadata: {
        status: 'waiting',
        createdAt: database.ServerValue.TIMESTAMP,
        cameraUid: uid,
        viewfinderUid: null,
      },
    });

    // Store numeric code mapping
    await database().ref(`/pairCodes/${numericCode}`).set({
      roomId,
      createdAt: database.ServerValue.TIMESTAMP,
    });

    // Clean up room if camera disconnects
    roomRef.child('metadata/status').onDisconnect().set('closed');

    rlog.info('firebase', 'Room created in RTDB', { roomId: roomId.substring(0, 8) });
    return true;
  } catch (e: any) {
    rlog.fatal('firebase', 'createRoom failed', { error: e?.message });
    return false;
  }
}

/** Join a room (viewfinder phone) */
export async function joinRoom(roomId: string): Promise<boolean> {
  try {
    const uid = getUid();
    if (!uid) {
      rlog.error('firebase', 'joinRoom: not authenticated');
      return false;
    }

    const roomRef = database().ref(`/rooms/${roomId}`);
    const snapshot = await roomRef.child('metadata').once('value');
    const metadata = snapshot.val();

    if (!metadata) {
      rlog.warn('firebase', 'joinRoom: room not found');
      return false;
    }

    if (metadata.status !== 'waiting') {
      rlog.warn('firebase', 'joinRoom: room not available', { status: metadata.status });
      return false;
    }

    await roomRef.child('metadata').update({
      viewfinderUid: uid,
      status: 'paired',
    });

    rlog.info('firebase', 'Joined room', { roomId: roomId.substring(0, 8) });
    return true;
  } catch (e: any) {
    rlog.fatal('firebase', 'joinRoom failed', { error: e?.message });
    return false;
  }
}

/** Look up room ID from 6-digit numeric code */
export async function lookupNumericCode(code: string): Promise<string | null> {
  try {
    const snapshot = await database().ref(`/pairCodes/${code}`).once('value');
    const data = snapshot.val();
    if (data?.roomId) {
      rlog.info('firebase', 'Numeric code resolved', { code });
      return data.roomId;
    }
    rlog.warn('firebase', 'Numeric code not found', { code });
    return null;
  } catch (e: any) {
    rlog.error('firebase', 'lookupNumericCode failed', { error: e?.message });
    return null;
  }
}

/** Listen for room status changes */
export function onRoomStatusChange(
  roomId: string,
  callback: (status: string) => void,
): () => void {
  const ref = database().ref(`/rooms/${roomId}/metadata/status`);
  const listener = ref.on('value', (snapshot) => {
    const status = snapshot.val();
    if (status) {
      rlog.info('firebase', 'Room status changed', { status });
      callback(status);
    }
  });

  return () => ref.off('value', listener);
}

/** Clean up a room */
export async function deleteRoom(roomId: string, numericCode?: string): Promise<void> {
  try {
    await database().ref(`/rooms/${roomId}`).remove();
    if (numericCode) {
      await database().ref(`/pairCodes/${numericCode}`).remove();
    }
    rlog.info('firebase', 'Room cleaned up');
  } catch (e: any) {
    rlog.error('firebase', 'deleteRoom failed', { error: e?.message });
  }
}
