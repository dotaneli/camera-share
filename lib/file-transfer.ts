/**
 * Chunked file transfer over WebRTC data channel.
 *
 * Protocol:
 *   1. Sender sends { type: 'file-start', fileType, fileName, totalSize, totalChunks }
 *   2. Sender sends { type: 'file-chunk', index, data } for each chunk (base64)
 *   3. Sender sends { type: 'file-end' }
 *   4. Receiver reassembles and saves to gallery
 */
import { sendDataMessage, sendRawData } from './webrtc';
import { rlog } from './remote-logger';

// Lazy imports — these native modules may not exist in older builds
function getFileSystem() {
  return require('expo-file-system') as typeof import('expo-file-system');
}
function getMediaLibrary() {
  return require('expo-media-library') as typeof import('expo-media-library');
}

const CHUNK_SIZE = 16000; // ~16KB per chunk (safe for data channel)

// ── Sender (camera side) ──

export async function sendFile(
  filePath: string,
  fileType: 'photo' | 'video',
): Promise<void> {
  rlog.info('transfer', 'Reading file for transfer', { filePath, fileType });

  const { File } = getFileSystem();
  const file = new File(filePath);
  if (!file.exists) {
    rlog.error('transfer', 'File not found', { filePath });
    return;
  }

  const base64 = await file.base64();
  const totalChunks = Math.ceil(base64.length / CHUNK_SIZE);
  const ext = fileType === 'photo' ? 'jpg' : 'mp4';
  const fileName = `camerashare_${Date.now()}.${ext}`;

  rlog.info('transfer', 'Starting file transfer', {
    fileName,
    size: base64.length,
    totalChunks,
  });

  // Signal start
  sendDataMessage({
    type: 'file-start',
    fileType,
    fileName,
    totalSize: base64.length,
    totalChunks,
  });

  // Send chunks
  for (let i = 0; i < totalChunks; i++) {
    const chunk = base64.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    sendRawData(JSON.stringify({ type: 'file-chunk', index: i, data: chunk }));
    // Yield to event loop every 50 chunks to avoid blocking
    if (i % 50 === 0 && i > 0) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  // Signal end
  sendDataMessage({ type: 'file-end' });
  rlog.info('transfer', 'File transfer complete', { fileName, totalChunks });
}

// ── Receiver (viewfinder side) ──

let receiveState: {
  fileType: 'photo' | 'video';
  fileName: string;
  totalChunks: number;
  chunks: string[];
  received: number;
} | null = null;

let onProgressCallback: ((progress: number, total: number) => void) | null = null;
let onCompleteCallback: ((success: boolean, fileType: string) => void) | null = null;

export function onTransferProgress(cb: (received: number, total: number) => void) {
  onProgressCallback = cb;
}

export function onTransferComplete(cb: (success: boolean, fileType: string) => void) {
  onCompleteCallback = cb;
}

/** Handle incoming data channel messages for file transfer. Returns true if handled. */
export function handleTransferMessage(msg: any): boolean {
  if (msg.type === 'file-start') {
    rlog.info('transfer', 'Receiving file', {
      fileName: msg.fileName,
      fileType: msg.fileType,
      totalChunks: msg.totalChunks,
    });
    receiveState = {
      fileType: msg.fileType,
      fileName: msg.fileName,
      totalChunks: msg.totalChunks,
      chunks: new Array(msg.totalChunks),
      received: 0,
    };
    return true;
  }

  if (msg.type === 'file-chunk' && receiveState) {
    receiveState.chunks[msg.index] = msg.data;
    receiveState.received++;
    if (onProgressCallback) {
      onProgressCallback(receiveState.received, receiveState.totalChunks);
    }
    return true;
  }

  if (msg.type === 'file-end' && receiveState) {
    rlog.info('transfer', 'File receive complete, saving...', {
      received: receiveState.received,
      total: receiveState.totalChunks,
    });
    saveReceivedFile(receiveState);
    receiveState = null;
    return true;
  }

  return false;
}

async function saveReceivedFile(state: {
  fileType: 'photo' | 'video';
  fileName: string;
  chunks: string[];
}) {
  try {
    const { File, Paths } = getFileSystem();
    const MediaLibrary = getMediaLibrary();

    const base64 = state.chunks.join('');
    const tempFile = new File(Paths.cache, state.fileName);

    // Write base64 content to temp file
    tempFile.write(base64, { encoding: 'base64' });
    rlog.info('transfer', 'Temp file written', { uri: tempFile.uri });

    // Request permission and save to gallery
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== 'granted') {
      rlog.error('transfer', 'Media library permission denied');
      if (onCompleteCallback) onCompleteCallback(false, state.fileType);
      return;
    }

    await MediaLibrary.saveToLibraryAsync(tempFile.uri);
    rlog.info('transfer', 'File saved to gallery', { fileName: state.fileName });

    // Clean up temp file
    try { tempFile.delete(); } catch {}

    if (onCompleteCallback) onCompleteCallback(true, state.fileType);
  } catch (e: any) {
    rlog.error('transfer', 'Failed to save file', { error: e?.message });
    if (onCompleteCallback) onCompleteCallback(false, state.fileType);
  }
}
