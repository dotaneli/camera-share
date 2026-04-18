/**
 * Tests for the data-channel file transfer protocol.
 * Mocks the webrtc transport so we only exercise chunking + reassembly logic.
 * Integration-testing the peer connection itself requires devices.
 */

// Captured outbound messages — the "wire" between sender and receiver in these tests.
const outbound: any[] = [];

jest.mock('../lib/webrtc', () => ({
  sendDataMessage: jest.fn((msg: any) => outbound.push(msg)),
  sendRawData: jest.fn((raw: string) => outbound.push(JSON.parse(raw))),
}));

jest.mock('../lib/remote-logger', () => ({
  rlog: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), fatal: jest.fn() },
}));

// expo-file-system: fake a File that returns a known base64 string.
const FAKE_PHOTO_BASE64 = 'A'.repeat(40000); // 40KB → 3 chunks at 16KB each
const savedFiles: Array<{ path: string; content: string; encoding?: string }> = [];

jest.mock('expo-file-system', () => ({
  File: class {
    constructor(public path: string, public name?: string) {
      if (name) this.path = `${path}/${name}`;
    }
    get exists() { return true; }
    get uri() { return `file://${this.path}`; }
    async base64() { return FAKE_PHOTO_BASE64; }
    write(content: string, opts?: any) {
      savedFiles.push({ path: this.path, content, encoding: opts?.encoding });
    }
    delete() { /* no-op */ }
  },
  Paths: { cache: '/tmp/cache' },
}));

const mediaSaves: string[] = [];
jest.mock('expo-media-library', () => ({
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  saveToLibraryAsync: jest.fn(async (uri: string) => { mediaSaves.push(uri); }),
}));

import {
  sendFile,
  handleTransferMessage,
  onTransferProgress,
  onTransferComplete,
} from '../lib/file-transfer';

beforeEach(() => {
  outbound.length = 0;
  savedFiles.length = 0;
  mediaSaves.length = 0;
});

describe('file-transfer: sender', () => {
  it('sends file-start with correct metadata', async () => {
    await sendFile('/tmp/photo.jpg', 'photo');
    expect(outbound[0]).toMatchObject({
      type: 'file-start',
      fileType: 'photo',
      totalSize: FAKE_PHOTO_BASE64.length,
      totalChunks: Math.ceil(FAKE_PHOTO_BASE64.length / 16000),
    });
    expect(outbound[0].fileName).toMatch(/camerashare_\d+\.jpg$/);
  });

  it('emits file-chunk for each 16KB slice', async () => {
    await sendFile('/tmp/photo.jpg', 'photo');
    const chunks = outbound.filter((m) => m.type === 'file-chunk');
    expect(chunks.length).toBe(Math.ceil(FAKE_PHOTO_BASE64.length / 16000));
    // Indexes are contiguous 0..N-1
    chunks.forEach((c, i) => expect(c.index).toBe(i));
    // Reassembled payload matches source
    const reassembled = chunks.map((c) => c.data).join('');
    expect(reassembled).toBe(FAKE_PHOTO_BASE64);
  });

  it('terminates with file-end', async () => {
    await sendFile('/tmp/photo.jpg', 'photo');
    expect(outbound[outbound.length - 1]).toEqual({ type: 'file-end' });
  });

  it('uses .mp4 extension for video', async () => {
    await sendFile('/tmp/clip.mp4', 'video');
    expect(outbound[0].fileName).toMatch(/\.mp4$/);
  });
});

describe('file-transfer: receiver', () => {
  it('progress callback fires per chunk', async () => {
    const progress: Array<{ received: number; total: number }> = [];
    onTransferProgress((received, total) => progress.push({ received, total }));

    handleTransferMessage({ type: 'file-start', fileName: 'x.jpg', fileType: 'photo', totalChunks: 3, totalSize: 100 });
    handleTransferMessage({ type: 'file-chunk', index: 0, data: 'aa' });
    handleTransferMessage({ type: 'file-chunk', index: 1, data: 'bb' });
    handleTransferMessage({ type: 'file-chunk', index: 2, data: 'cc' });

    expect(progress).toEqual([
      { received: 1, total: 3 },
      { received: 2, total: 3 },
      { received: 3, total: 3 },
    ]);
  });

  it('saves reassembled file to MediaLibrary on file-end', async () => {
    const done = new Promise<{ success: boolean; fileType: string }>((resolve) => {
      onTransferComplete((success, fileType) => resolve({ success, fileType }));
    });

    handleTransferMessage({ type: 'file-start', fileName: 'shot.jpg', fileType: 'photo', totalChunks: 2, totalSize: 4 });
    handleTransferMessage({ type: 'file-chunk', index: 0, data: 'AB' });
    handleTransferMessage({ type: 'file-chunk', index: 1, data: 'CD' });
    handleTransferMessage({ type: 'file-end' });

    const result = await done;
    expect(result).toEqual({ success: true, fileType: 'photo' });
    expect(savedFiles).toHaveLength(1);
    expect(savedFiles[0]).toMatchObject({ content: 'ABCD', encoding: 'base64' });
    expect(mediaSaves).toHaveLength(1);
  });

  it('reassembles chunks in order even if messages arrive out of order', async () => {
    const done = new Promise<void>((resolve) => {
      onTransferComplete(() => resolve());
    });

    handleTransferMessage({ type: 'file-start', fileName: 'x.jpg', fileType: 'photo', totalChunks: 3, totalSize: 6 });
    // Arrive out of order
    handleTransferMessage({ type: 'file-chunk', index: 2, data: 'CC' });
    handleTransferMessage({ type: 'file-chunk', index: 0, data: 'AA' });
    handleTransferMessage({ type: 'file-chunk', index: 1, data: 'BB' });
    handleTransferMessage({ type: 'file-end' });

    await done;
    expect(savedFiles[0].content).toBe('AABBCC');
  });

  it('returns false for unrelated messages', () => {
    expect(handleTransferMessage({ type: 'zoom', level: 2 })).toBe(false);
    expect(handleTransferMessage({ type: 'shutter-done' })).toBe(false);
  });

  it('ignores file-chunk arriving before file-start', () => {
    // Reset module state by sending an end (already handled in prior test)
    // New untracked chunk should not crash
    expect(() =>
      handleTransferMessage({ type: 'file-chunk', index: 0, data: 'oops' }),
    ).not.toThrow();
  });
});
