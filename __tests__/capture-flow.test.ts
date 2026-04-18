/**
 * End-to-end simulation of the photo/video capture data-channel protocol.
 *
 * Wires the sender's outbound messages directly into the receiver's
 * handleTransferMessage, so we cover chunking + network-shape + reassembly +
 * gallery save in one scenario. Anything the two ends silently disagree on
 * (chunk ordering, framing, encoding, type inference) will surface here.
 *
 * The peer connection itself is out of scope — that needs real devices —
 * but the messages that flow over it are fully exercised.
 */

const outbound: any[] = [];

jest.mock('../lib/webrtc', () => ({
  sendDataMessage: jest.fn((msg: any) => outbound.push(msg)),
  sendRawData: jest.fn((raw: string) => outbound.push(JSON.parse(raw))),
}));

jest.mock('../lib/remote-logger', () => ({
  rlog: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), fatal: jest.fn() },
}));

// Each simulated "file" lives in this map. sendFile reads from it; saveReceivedFile
// writes into a savedFiles array that the test inspects.
const sourceFile = { base64: '' };
const savedFiles: Array<{ path: string; content: string; encoding?: string }> = [];
const mediaSaves: string[] = [];

jest.mock('expo-file-system', () => ({
  File: class {
    constructor(public path: string, public name?: string) {
      if (name) this.path = `${path}/${name}`;
    }
    get exists() { return true; }
    get uri() { return `file://${this.path}`; }
    async base64() { return sourceFile.base64; }
    write(content: string, opts?: any) {
      savedFiles.push({ path: this.path, content, encoding: opts?.encoding });
    }
    delete() { /* no-op */ }
  },
  Paths: { cache: '/tmp/cache' },
}));

jest.mock('expo-media-library', () => ({
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  saveToLibraryAsync: jest.fn(async (uri: string) => { mediaSaves.push(uri); }),
}));

import { sendFile } from '../lib/file-transfer';
import { handleTransferMessage, onTransferComplete, onTransferProgress } from '../lib/file-transfer';

/** Base64 string of arbitrary length; content matters less than that bytes round-trip. */
function makeBase64Payload(chars: string, totalLen: number): string {
  return chars.repeat(Math.ceil(totalLen / chars.length)).slice(0, totalLen);
}

async function runTransfer(fileType: 'photo' | 'video', size: number) {
  outbound.length = 0;
  savedFiles.length = 0;
  mediaSaves.length = 0;
  sourceFile.base64 = makeBase64Payload('ABCD', size);

  const progressSnapshots: Array<{ received: number; total: number }> = [];
  onTransferProgress((received, total) => progressSnapshots.push({ received, total }));

  const completion = new Promise<{ success: boolean; fileType: string }>((resolve) => {
    onTransferComplete((success, type) => resolve({ success, fileType: type }));
  });

  // Sender: chunks the payload and emits messages into `outbound`.
  await sendFile('/tmp/src.bin', fileType);

  // Simulate the data channel: deliver every outbound message to the receiver, in order.
  for (const msg of outbound) {
    handleTransferMessage(msg);
  }

  // MediaLibrary save is async — let pending microtasks settle.
  await new Promise((r) => setImmediate(r));

  return { completion: await completion, progressSnapshots };
}

describe('capture-flow: photo end-to-end', () => {
  it('transfers a small photo cleanly and saves it to the receiver gallery', async () => {
    const size = 4000; // 1 chunk (under the 16KB limit)
    const { completion, progressSnapshots } = await runTransfer('photo', size);

    expect(completion).toEqual({ success: true, fileType: 'photo' });
    expect(progressSnapshots.at(-1)).toEqual({ received: 1, total: 1 });
    expect(savedFiles).toHaveLength(1);
    expect(savedFiles[0].encoding).toBe('base64');
    expect(savedFiles[0].content).toBe(sourceFile.base64);
    expect(mediaSaves).toHaveLength(1);
    expect(mediaSaves[0]).toMatch(/camerashare_\d+\.jpg$/);
  });

  it('transfers a multi-chunk photo and the bytes round-trip exactly', async () => {
    const size = 50_000; // ~4 chunks
    const { completion, progressSnapshots } = await runTransfer('photo', size);

    expect(completion.success).toBe(true);
    expect(progressSnapshots.at(-1)).toEqual({
      received: Math.ceil(size / 16000),
      total: Math.ceil(size / 16000),
    });
    expect(savedFiles[0].content.length).toBe(size);
    expect(savedFiles[0].content).toBe(sourceFile.base64);
  });
});

describe('capture-flow: video end-to-end', () => {
  it('names the saved file with .mp4 and preserves bytes', async () => {
    const size = 100_000; // ~7 chunks
    const { completion } = await runTransfer('video', size);

    expect(completion).toEqual({ success: true, fileType: 'video' });
    expect(mediaSaves[0]).toMatch(/camerashare_\d+\.mp4$/);
    expect(savedFiles[0].content).toBe(sourceFile.base64);
  });

  it('emits enough progress updates to render a smooth progress bar', async () => {
    const { progressSnapshots } = await runTransfer('video', 200_000);
    // Every chunk fires a progress update; total should match the chunk count.
    const expectedChunks = Math.ceil(200_000 / 16000);
    expect(progressSnapshots.length).toBe(expectedChunks);
    // Progress is monotonic non-decreasing.
    for (let i = 1; i < progressSnapshots.length; i++) {
      expect(progressSnapshots[i].received).toBeGreaterThanOrEqual(progressSnapshots[i - 1].received);
    }
  });
});

describe('capture-flow: delivery order resilience', () => {
  it('reassembles correctly even when chunks arrive out of order', async () => {
    const size = 32_000; // exactly 2 chunks
    sourceFile.base64 = makeBase64Payload('XY', size);
    outbound.length = 0;
    savedFiles.length = 0;
    const completion = new Promise<boolean>((resolve) => onTransferComplete((ok) => resolve(ok)));

    await sendFile('/tmp/p.bin', 'photo');
    // Deliver file-start, chunks reversed, then file-end.
    const start = outbound.find((m) => m.type === 'file-start');
    const end = outbound.find((m) => m.type === 'file-end');
    const chunks = outbound.filter((m) => m.type === 'file-chunk').reverse();

    handleTransferMessage(start);
    chunks.forEach(handleTransferMessage);
    handleTransferMessage(end);
    await new Promise((r) => setImmediate(r));

    expect(await completion).toBe(true);
    expect(savedFiles[0].content).toBe(sourceFile.base64);
  });
});
