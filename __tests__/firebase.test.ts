// Mock Firebase modules for testing. Each test can override the snapshot via
// mockSnapshotVal() so the mocked `.once('value')` yields what that test needs.
jest.mock('@react-native-firebase/app', () => ({ firebase: {} }));

let currentUser: any = { uid: 'test-uid-123' };
const signInAnonymously = jest.fn();
jest.mock('@react-native-firebase/auth', () => {
  return () => ({
    signInAnonymously: (...args: any[]) => signInAnonymously(...args),
    get currentUser() { return currentUser; },
  });
});

let snapshotVal: any = { status: 'waiting', mainUid: 'main-uid' };
const mockRef = {
  set: jest.fn().mockResolvedValue(undefined),
  update: jest.fn().mockResolvedValue(undefined),
  remove: jest.fn().mockResolvedValue(undefined),
  once: jest.fn().mockImplementation(() => Promise.resolve({ val: () => snapshotVal })),
  on: jest.fn().mockImplementation((_ev, cb) => {
    cb({ val: () => snapshotVal });
    return cb;
  }),
  off: jest.fn(),
  child: jest.fn().mockReturnThis(),
  onDisconnect: jest.fn().mockReturnValue({ set: jest.fn() }),
};
const mockDbRef = jest.fn(() => mockRef);
jest.mock('@react-native-firebase/database', () => {
  const db: any = () => ({ ref: mockDbRef });
  db.ServerValue = { TIMESTAMP: 'TIMESTAMP' };
  return db;
});

const rlogMock = {
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), fatal: jest.fn(), debug: jest.fn(),
};
jest.mock('../lib/remote-logger', () => ({ rlog: rlogMock }));

import {
  initAuth,
  getUid,
  createRoom,
  joinRoom,
  lookupNumericCode,
  deleteRoom,
  onRoomStatusChange,
} from '../lib/firebase';

beforeEach(() => {
  jest.clearAllMocks();
  signInAnonymously.mockResolvedValue({ user: { uid: 'test-uid-123' } });
  currentUser = { uid: 'test-uid-123' };
  snapshotVal = { status: 'waiting', mainUid: 'main-uid' };
});

describe('Firebase signaling', () => {
  it('initializes anonymous auth', async () => {
    const uid = await initAuth();
    expect(uid).toBe('test-uid-123');
  });

  it('returns current uid', () => {
    const uid = getUid();
    expect(uid).toBe('test-uid-123');
  });

  it('creates a room', async () => {
    const result = await createRoom('test-room-id', '123456');
    expect(result).toBe(true);
  });

  it('joins a room', async () => {
    const result = await joinRoom('test-room-id');
    expect(result).toBe(true);
  });

  it('looks up numeric code', async () => {
    // Mock returns val() with roomId since we mocked snapshot above
    // The actual mock returns { status: 'waiting', mainUid: 'main-uid' }
    // which doesn't have roomId, so this should return null
    const result = await lookupNumericCode('123456');
    expect(result).toBeNull();
  });

  it('deletes a room without throwing', async () => {
    await expect(deleteRoom('test-room-id', '123456')).resolves.not.toThrow();
  });
});

describe('Firebase signaling: edge cases', () => {
  it('createRoom returns false when not authenticated', async () => {
    currentUser = null;
    const result = await createRoom('room-x', '000000');
    expect(result).toBe(false);
    expect(rlogMock.error).toHaveBeenCalledWith('firebase', 'createRoom: not authenticated');
  });

  it('joinRoom returns false when the room does not exist', async () => {
    snapshotVal = null;
    const result = await joinRoom('ghost-room');
    expect(result).toBe(false);
    expect(rlogMock.warn).toHaveBeenCalledWith('firebase', 'joinRoom: room not found');
  });

  it('joinRoom rejects rooms that are not in "waiting" state', async () => {
    snapshotVal = { status: 'paired', mainUid: 'main-uid' };
    const result = await joinRoom('taken-room');
    expect(result).toBe(false);
    expect(rlogMock.warn).toHaveBeenCalledWith(
      'firebase',
      'joinRoom: room not available',
      { status: 'paired' },
    );
  });

  it('lookupNumericCode resolves to roomId when the entry exists', async () => {
    snapshotVal = { roomId: 'resolved-room-abc' };
    const result = await lookupNumericCode('424242');
    expect(result).toBe('resolved-room-abc');
  });

  it('lookupNumericCode catches throws and returns null', async () => {
    mockRef.once.mockRejectedValueOnce(new Error('network down'));
    const result = await lookupNumericCode('999999');
    expect(result).toBeNull();
    expect(rlogMock.error).toHaveBeenCalledWith(
      'firebase',
      'lookupNumericCode failed',
      expect.objectContaining({ error: 'network down' }),
    );
  });

  it('onRoomStatusChange invokes the callback with the value and returns an unsubscribe', () => {
    snapshotVal = 'waiting';
    const cb = jest.fn();
    const unsubscribe = onRoomStatusChange('room-y', cb);
    expect(cb).toHaveBeenCalledWith('waiting');
    expect(typeof unsubscribe).toBe('function');
    unsubscribe();
    expect(mockRef.off).toHaveBeenCalled();
  });

  it('deleteRoom without numericCode still removes the room', async () => {
    await deleteRoom('room-z');
    expect(mockRef.remove).toHaveBeenCalledTimes(1);
  });

  it('initAuth falls back to currentUser.uid when already initialized', async () => {
    await initAuth(); // first call marks initialized=true
    signInAnonymously.mockClear();
    const uid = await initAuth(); // second call shouldn't re-sign in
    expect(signInAnonymously).not.toHaveBeenCalled();
    expect(uid).toBe('test-uid-123');
  });
});
