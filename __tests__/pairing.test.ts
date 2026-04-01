jest.mock('expo-crypto', () => ({
  randomUUID: () => '550e8400-e29b-41d4-a716-446655440000',
}));

import { generateRoomId, deriveNumericCode, encodeQRPayload, decodeQRPayload } from '../lib/pairing';

describe('Pairing', () => {
  describe('generateRoomId', () => {
    it('returns a 22-character string', () => {
      const id = generateRoomId();
      expect(id.length).toBe(22);
    });

    it('uses only base62 characters', () => {
      const id = generateRoomId();
      expect(id).toMatch(/^[0-9A-Za-z]+$/);
    });

    it('is deterministic with mocked UUID', () => {
      const id1 = generateRoomId();
      const id2 = generateRoomId();
      expect(id1).toBe(id2);
    });
  });

  describe('deriveNumericCode', () => {
    it('returns a 6-digit string', () => {
      const code = deriveNumericCode('testRoomId12345678901');
      expect(code.length).toBe(6);
      expect(code).toMatch(/^\d{6}$/);
    });

    it('is deterministic for same input', () => {
      const code1 = deriveNumericCode('abc123');
      const code2 = deriveNumericCode('abc123');
      expect(code1).toBe(code2);
    });

    it('produces different codes for different inputs', () => {
      const code1 = deriveNumericCode('room-aaa');
      const code2 = deriveNumericCode('room-bbb');
      expect(code1).not.toBe(code2);
    });

    it('pads with leading zeros if needed', () => {
      const code = deriveNumericCode('');
      expect(code).toBe('000000');
    });
  });

  describe('encodeQRPayload / decodeQRPayload', () => {
    it('round-trips correctly', () => {
      const roomId = 'testRoom123456789012';
      const payload = encodeQRPayload(roomId);
      const decoded = decodeQRPayload(payload);
      expect(decoded).toEqual({ roomId, version: 1 });
    });

    it('produces valid JSON', () => {
      const payload = encodeQRPayload('test');
      expect(() => JSON.parse(payload)).not.toThrow();
    });

    it('includes version 1', () => {
      const payload = encodeQRPayload('test');
      const parsed = JSON.parse(payload);
      expect(parsed.v).toBe(1);
    });

    it('returns null for invalid payload', () => {
      expect(decodeQRPayload('not json')).toBeNull();
      expect(decodeQRPayload('{}')).toBeNull();
      expect(decodeQRPayload('{"r": 123}')).toBeNull();
    });

    it('returns null for missing version', () => {
      expect(decodeQRPayload('{"r":"room"}')).toBeNull();
    });
  });
});
