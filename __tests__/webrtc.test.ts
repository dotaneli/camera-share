/**
 * Tests for the pure-logic parts of lib/webrtc.ts.
 *
 * The peer-connection/signaling paths depend on native react-native-webrtc and
 * are not exercised here — they'd need a device. What we can verify in Node:
 *
 *   - setHardwareZoom's promise-first / legacy-fallback branching
 *   - sendDataMessage + sendRawData open/closed-channel behavior
 *   - initPreviewStream wires localStream so subsequent zoom calls have a track
 */

const mockWebRTCModule: {
  mediaStreamTrackSetZoom: jest.Mock;
  mediaStreamTrackSetZoomWithResult?: jest.Mock;
} = {
  mediaStreamTrackSetZoom: jest.fn(),
  mediaStreamTrackSetZoomWithResult: jest.fn(),
};

jest.mock('react-native', () => ({
  NativeModules: { WebRTCModule: mockWebRTCModule },
}));

const VIDEO_TRACK = { kind: 'video', _id: 'track-vid', id: 'track-vid', stop: jest.fn() };
const AUDIO_TRACK = { kind: 'audio', _id: 'track-aud', id: 'track-aud', stop: jest.fn() };
const makeStream = () => {
  const tracks = [VIDEO_TRACK, AUDIO_TRACK];
  return {
    getTracks: () => tracks,
    getVideoTracks: () => tracks.filter((t) => t.kind === 'video'),
    getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
    toURL: () => 'rtc://mock-stream',
  };
};

const getUserMedia = jest.fn(async (_constraints?: any) => makeStream());

jest.mock('react-native-webrtc', () => ({
  mediaDevices: { getUserMedia: (c: any) => getUserMedia(c) },
  RTCPeerConnection: jest.fn(),
  RTCSessionDescription: jest.fn(),
  RTCIceCandidate: jest.fn(),
  MediaStream: jest.fn(),
}));

jest.mock('@react-native-firebase/database', () => {
  const ref = {
    set: jest.fn().mockResolvedValue(undefined),
    push: jest.fn().mockReturnThis(),
    on: jest.fn(),
    off: jest.fn(),
  };
  const db = () => ({ ref: () => ref });
  return { __esModule: true, default: db };
});

const rlogMock = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  fatal: jest.fn(),
};
jest.mock('../lib/remote-logger', () => ({ rlog: rlogMock }));

import { initPreviewStream, setHardwareZoom, sendDataMessage, sendRawData, onDataMessage } from '../lib/webrtc';

beforeEach(() => {
  jest.clearAllMocks();
  mockWebRTCModule.mediaStreamTrackSetZoomWithResult = jest.fn();
  mockWebRTCModule.mediaStreamTrackSetZoom = jest.fn();
});

describe('setHardwareZoom', () => {
  it('is a no-op when there is no local stream yet', async () => {
    await setHardwareZoom(2.0);
    expect(mockWebRTCModule.mediaStreamTrackSetZoomWithResult).not.toHaveBeenCalled();
    expect(mockWebRTCModule.mediaStreamTrackSetZoom).not.toHaveBeenCalled();
    expect(rlogMock.debug).toHaveBeenCalledWith('webrtc', 'No local stream for zoom');
  });

  describe('with an active stream', () => {
    beforeEach(async () => {
      await initPreviewStream();
    });

    it('prefers the promise method and logs success on ok:true', async () => {
      mockWebRTCModule.mediaStreamTrackSetZoomWithResult!.mockResolvedValue({ ok: true });
      await setHardwareZoom(2.5);
      expect(mockWebRTCModule.mediaStreamTrackSetZoomWithResult).toHaveBeenCalledWith('track-vid', 2.5);
      expect(mockWebRTCModule.mediaStreamTrackSetZoom).not.toHaveBeenCalled();
      expect(rlogMock.debug).toHaveBeenCalledWith('webrtc', 'Hardware zoom applied', { zoom: 2.5 });
    });

    it('logs a warn with the reason when promise method returns ok:false', async () => {
      mockWebRTCModule.mediaStreamTrackSetZoomWithResult!.mockResolvedValue({
        ok: false,
        reason: 'no current camera session',
      });
      await setHardwareZoom(3.0);
      expect(rlogMock.warn).toHaveBeenCalledWith(
        'webrtc',
        'Hardware zoom did not apply',
        { zoom: 3.0, reason: 'no current camera session' },
      );
    });

    it('catches promise-method rejection and warns without falling back', async () => {
      mockWebRTCModule.mediaStreamTrackSetZoomWithResult!.mockRejectedValue(
        new Error('ZOOM_ERROR: native exception'),
      );
      await setHardwareZoom(2.0);
      expect(rlogMock.warn).toHaveBeenCalledWith(
        'webrtc',
        'Hardware zoom native error',
        expect.objectContaining({ zoom: 2.0, error: expect.stringContaining('ZOOM_ERROR') }),
      );
      // Promise rejection branch is terminal — no fallback.
      expect(mockWebRTCModule.mediaStreamTrackSetZoom).not.toHaveBeenCalled();
    });

    it('falls back to void method when the promise method is not present (iOS / old builds)', async () => {
      delete mockWebRTCModule.mediaStreamTrackSetZoomWithResult;
      await setHardwareZoom(1.8);
      expect(mockWebRTCModule.mediaStreamTrackSetZoom).toHaveBeenCalledWith('track-vid', 1.8);
      expect(rlogMock.debug).toHaveBeenCalledWith(
        'webrtc',
        'Hardware zoom applied (legacy)',
        { zoom: 1.8 },
      );
    });

    it('fallback void method catches throws and logs debug', async () => {
      delete mockWebRTCModule.mediaStreamTrackSetZoomWithResult;
      mockWebRTCModule.mediaStreamTrackSetZoom.mockImplementation(() => {
        throw new Error('bridge not available');
      });
      await setHardwareZoom(1.5);
      expect(rlogMock.debug).toHaveBeenCalledWith(
        'webrtc',
        'Hardware zoom failed (legacy)',
        expect.objectContaining({ error: 'bridge not available' }),
      );
    });

    it('passes the track id (supports both _id and id field naming)', async () => {
      mockWebRTCModule.mediaStreamTrackSetZoomWithResult!.mockResolvedValue({ ok: true });
      await setHardwareZoom(2.0);
      const [trackIdArg] = mockWebRTCModule.mediaStreamTrackSetZoomWithResult!.mock.calls[0];
      expect(trackIdArg).toBe('track-vid');
    });
  });
});

describe('data channel dispatch (no open channel)', () => {
  it('sendDataMessage logs warn and drops when channel is not open', () => {
    sendDataMessage({ type: 'shutter' });
    expect(rlogMock.warn).toHaveBeenCalledWith(
      'webrtc',
      'Data channel not open, message dropped',
      { type: 'shutter' },
    );
  });

  it('sendRawData is a no-op when channel is not open', () => {
    expect(() => sendRawData('chunk-data')).not.toThrow();
  });

  it('onDataMessage registers a callback without throwing', () => {
    expect(() => onDataMessage(() => {})).not.toThrow();
  });
});
