/**
 * Tests for lib/remote-logger.ts.
 *
 * The logger posts each entry to Firebase RTDB via REST (no native deps), and is
 * fire-and-forget by design — if a log crashes the app, that defeats its purpose.
 * We verify: entry shape, level routing, extra serialization, and crash resilience.
 */

const fetchMock: jest.Mock = jest.fn().mockResolvedValue({ ok: true });
(global as any).fetch = fetchMock;

import { rlog, remoteLog } from '../lib/remote-logger';

const FIREBASE_URL = 'https://camera-share-e9232-default-rtdb.firebaseio.com/logs.json';

function readBody(): any {
  const calls: any[][] = fetchMock.mock.calls as any;
  const call = calls[calls.length - 1];
  return JSON.parse(call[1].body);
}

beforeEach(() => {
  fetchMock.mockClear();
  fetchMock.mockImplementation(() => Promise.resolve({ ok: true }));
});

describe('remoteLog', () => {
  it('posts to the Firebase logs endpoint with JSON Content-Type', () => {
    remoteLog('info', 'test', 'hello');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calls: any[][] = fetchMock.mock.calls as any;
    const [url, opts] = calls[0];
    expect(url).toBe(FIREBASE_URL);
    expect(opts.method).toBe('POST');
    expect(opts.headers['Content-Type']).toBe('application/json');
  });

  it('entry shape includes ts, sid, lvl, tag, msg', () => {
    remoteLog('warn', 'webrtc', 'something went wrong');
    const body = readBody();
    expect(body).toMatchObject({ lvl: 'warn', tag: 'webrtc', msg: 'something went wrong' });
    expect(typeof body.ts).toBe('string');
    expect(body.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(typeof body.sid).toBe('string');
    expect(body.sid.length).toBeGreaterThan(0);
  });

  it('session id is stable across multiple logs in one run', () => {
    remoteLog('info', 't', '1');
    remoteLog('info', 't', '2');
    remoteLog('info', 't', '3');
    const calls: any[][] = fetchMock.mock.calls as any;
    const sids = calls.map((c) => JSON.parse(c[1].body).sid);
    expect(new Set(sids).size).toBe(1);
  });

  it('omits extra field when not provided', () => {
    remoteLog('info', 'tag', 'plain');
    const body = readBody();
    expect(body.extra).toBeUndefined();
  });

  it('serializes object extras as JSON string', () => {
    remoteLog('info', 'tag', 'msg', { a: 1, b: 'two' });
    const body = readBody();
    expect(typeof body.extra).toBe('string');
    expect(JSON.parse(body.extra)).toEqual({ a: 1, b: 'two' });
  });

  it('stringifies primitive extras', () => {
    remoteLog('info', 'tag', 'msg', 42);
    expect(readBody().extra).toBe('42');

    remoteLog('info', 'tag', 'msg', 'raw-string');
    expect(readBody().extra).toBe('raw-string');

    remoteLog('info', 'tag', 'msg', true);
    expect(readBody().extra).toBe('true');
  });

  it('does not throw when fetch rejects (fire-and-forget resilience)', () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error('network down')));
    expect(() => remoteLog('error', 't', 'msg')).not.toThrow();
  });

  it('does not throw when fetch itself throws synchronously', () => {
    fetchMock.mockImplementation(() => { throw new Error('synthetic'); });
    // By the contract of "never crash the app from logging", this must not throw.
    // The current impl lets sync throws bubble — if this test fails, harden remoteLog
    // with a try/catch around the fetch call.
    // Adjust assertion if behavior is intentionally strict.
    try {
      remoteLog('info', 't', 'msg');
    } catch (e) {
      throw new Error(
        'remoteLog rethrew a synchronous fetch error — wrap fetch in try/catch so logging can never crash the caller',
      );
    }
  });
});

describe('rlog level helpers', () => {
  const levels: Array<'debug' | 'info' | 'warn' | 'error' | 'fatal'> = [
    'debug', 'info', 'warn', 'error', 'fatal',
  ];

  it.each(levels)('rlog.%s writes an entry at that level', (level) => {
    rlog[level]('tag', 'message');
    expect(readBody().lvl).toBe(level);
  });

  it('each helper forwards tag + message + extra exactly', () => {
    rlog.info('main', 'photo captured', { w: 4080, h: 3072 });
    const body = readBody();
    expect(body).toMatchObject({ lvl: 'info', tag: 'main', msg: 'photo captured' });
    expect(JSON.parse(body.extra)).toEqual({ w: 4080, h: 3072 });
  });
});
