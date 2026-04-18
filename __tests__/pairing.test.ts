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

    it('accepts payloads with extra unknown fields (forward compat)', () => {
      const payload = JSON.stringify({ r: 'roomXyz', v: 1, ext: 'future-extension', nested: { a: 1 } });
      expect(decodeQRPayload(payload)).toEqual({ roomId: 'roomXyz', version: 1 });
    });

    it('returns null when r is non-string even if v is present', () => {
      expect(decodeQRPayload(JSON.stringify({ r: 123, v: 1 }))).toBeNull();
      expect(decodeQRPayload(JSON.stringify({ r: null, v: 1 }))).toBeNull();
      expect(decodeQRPayload(JSON.stringify({ r: {}, v: 1 }))).toBeNull();
    });

    it('returns null when v is non-number', () => {
      expect(decodeQRPayload(JSON.stringify({ r: 'room', v: '1' }))).toBeNull();
      expect(decodeQRPayload(JSON.stringify({ r: 'room', v: null }))).toBeNull();
    });

    it('returns null for JSON primitives (string, number, bool)', () => {
      expect(decodeQRPayload('"just a string"')).toBeNull();
      expect(decodeQRPayload('42')).toBeNull();
      expect(decodeQRPayload('true')).toBeNull();
      expect(decodeQRPayload('null')).toBeNull();
    });

    it('encodes an empty room id (degenerate but valid shape)', () => {
      const payload = encodeQRPayload('');
      const parsed = JSON.parse(payload);
      expect(parsed.r).toBe('');
      expect(parsed.v).toBe(1);
    });

    it('is resilient to surrounding whitespace in the payload', () => {
      const raw = '  ' + encodeQRPayload('roomY') + '  ';
      // JSON.parse tolerates surrounding whitespace — so should we
      expect(decodeQRPayload(raw)).toEqual({ roomId: 'roomY', version: 1 });
    });
  });

  describe('deriveNumericCode: broader behavior', () => {
    it('produces the same code for the same id across many calls', () => {
      const id = 'stable-room-id-42';
      const samples = Array.from({ length: 50 }, () => deriveNumericCode(id));
      expect(new Set(samples).size).toBe(1);
    });

    it('is always exactly six digits, even for very long ids', () => {
      const longId = 'x'.repeat(500);
      const code = deriveNumericCode(longId);
      expect(code).toMatch(/^\d{6}$/);
    });

    it('handles unicode input without throwing', () => {
      expect(() => deriveNumericCode('📷🎥🎬')).not.toThrow();
      expect(deriveNumericCode('📷🎥🎬')).toMatch(/^\d{6}$/);
    });
  });
});
