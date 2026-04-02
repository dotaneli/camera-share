// Mock Firebase modules for testing
jest.mock('@react-native-firebase/app', () => ({ firebase: {} }));
jest.mock('@react-native-firebase/auth', () => {
  const mockUser = { uid: 'test-uid-123' };
  return () => ({
    signInAnonymously: jest.fn().mockResolvedValue({ user: mockUser }),
    currentUser: mockUser,
  });
});
jest.mock('@react-native-firebase/database', () => {
  const mockSnapshot = { val: () => ({ status: 'waiting', cameraUid: 'cam-uid' }) };
  const mockRef = {
    set: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
    once: jest.fn().mockResolvedValue(mockSnapshot),
    on: jest.fn().mockReturnValue(jest.fn()),
    off: jest.fn(),
    child: jest.fn().mockReturnThis(),
    onDisconnect: jest.fn().mockReturnValue({ set: jest.fn() }),
  };
  const db = () => ({ ref: () => mockRef });
  db.ServerValue = { TIMESTAMP: 'TIMESTAMP' };
  return db;
});
jest.mock('../lib/remote-logger', () => ({
  rlog: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    fatal: jest.fn(),
  },
}));

import { initAuth, getUid, createRoom, joinRoom, lookupNumericCode, deleteRoom } from '../lib/firebase';

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
    // The actual mock returns { status: 'waiting', cameraUid: 'cam-uid' }
    // which doesn't have roomId, so this should return null
    const result = await lookupNumericCode('123456');
    expect(result).toBeNull();
  });

  it('deletes a room without throwing', async () => {
    await expect(deleteRoom('test-room-id', '123456')).resolves.not.toThrow();
  });
});
