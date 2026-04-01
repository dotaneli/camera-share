import { randomUUID } from 'expo-crypto';

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** Generate a cryptographically random room ID (22-char base62 = ~128 bits) */
export function generateRoomId(): string {
  const uuid = randomUUID().replace(/-/g, '');
  // Convert hex UUID to base62
  let num = BigInt('0x' + uuid);
  let result = '';
  while (num > 0n) {
    result = BASE62[Number(num % 62n)] + result;
    num = num / 62n;
  }
  return result.padStart(22, '0');
}

/** Derive a 6-digit numeric code from a room ID */
export function deriveNumericCode(roomId: string): string {
  let hash = 0;
  for (let i = 0; i < roomId.length; i++) {
    const char = roomId.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  const code = Math.abs(hash) % 1000000;
  return code.toString().padStart(6, '0');
}

/** Encode pairing data into QR payload */
export function encodeQRPayload(roomId: string): string {
  return JSON.stringify({ r: roomId, v: 1 });
}

/** Decode QR payload back to room ID */
export function decodeQRPayload(payload: string): { roomId: string; version: number } | null {
  try {
    const data = JSON.parse(payload);
    if (data && typeof data.r === 'string' && typeof data.v === 'number') {
      return { roomId: data.r, version: data.v };
    }
    return null;
  } catch {
    return null;
  }
}
