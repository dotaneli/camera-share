jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      version: '1.0.0',
      ios: { buildNumber: '6' },
      android: { versionCode: 12 },
    },
  },
}));

jest.mock('expo-updates', () => ({
  runtimeVersion: '1.0.0',
  channel: 'preview',
  updateId: 'abcdef1234567890',
  createdAt: new Date('2026-04-18T10:00:00Z'),
  isEmbeddedLaunch: false,
  isEmergencyLaunch: false,
}));

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

import { getVersionInfo, formatVersionSummary } from '../lib/version-info';

describe('version-info', () => {
  it('assembles fields from expo-constants + expo-updates', () => {
    const info = getVersionInfo();
    expect(info).toEqual({
      appVersion: '1.0.0',
      runtimeVersion: '1.0.0',
      buildNumber: '6',
      channel: 'preview',
      updateId: 'abcdef1234567890',
      updateCreatedAt: '2026-04-18T10:00:00.000Z',
      isEmbedded: false,
      isEmergency: false,
      platform: 'ios',
    });
  });

  it('summary is human-readable and includes channel + update short id', () => {
    const summary = formatVersionSummary(getVersionInfo());
    expect(summary).toBe('v1.0.0 (ios build 6) · preview · abcdef12');
  });

  it('summary marks embedded launches explicitly', () => {
    const summary = formatVersionSummary({
      appVersion: '1.0.0',
      runtimeVersion: '1.0.0',
      buildNumber: '6',
      channel: 'preview',
      updateId: null,
      updateCreatedAt: null,
      isEmbedded: true,
      isEmergency: false,
      platform: 'android',
    });
    expect(summary).toBe('v1.0.0 (android build 6) · preview · embedded');
  });

  it('summary uses short (first 8 chars) of updateId', () => {
    const summary = formatVersionSummary({
      appVersion: '1.0.0',
      runtimeVersion: '1.0.0',
      buildNumber: '10',
      channel: 'production',
      updateId: 'abcdef1234567890xxx',
      updateCreatedAt: '2026-04-18T00:00:00.000Z',
      isEmbedded: false,
      isEmergency: false,
      platform: 'ios',
    });
    // First 8 characters of the update id
    expect(summary).toContain(' · abcdef12');
  });

  it('summary yields "unknown" when updateId is null but not embedded (should not happen but shouldn\'t crash)', () => {
    const summary = formatVersionSummary({
      appVersion: '1.0.0',
      runtimeVersion: '1.0.0',
      buildNumber: '1',
      channel: 'preview',
      updateId: null,
      updateCreatedAt: null,
      isEmbedded: false,
      isEmergency: false,
      platform: 'ios',
    });
    expect(summary).toBe('v1.0.0 (ios build 1) · preview · unknown');
  });
});

describe('version-info: alternate platforms and missing fields', () => {
  it('reads Android versionCode when Platform.OS is android', () => {
    jest.resetModules();
    jest.doMock('expo-constants', () => ({
      __esModule: true,
      default: {
        expoConfig: {
          version: '2.1.0',
          ios: { buildNumber: '9' },
          android: { versionCode: 17 },
        },
      },
    }));
    jest.doMock('expo-updates', () => ({
      runtimeVersion: '2.1.0',
      channel: 'production',
      updateId: null,
      createdAt: null,
      isEmbeddedLaunch: true,
      isEmergencyLaunch: false,
    }));
    jest.doMock('react-native', () => ({ Platform: { OS: 'android' } }));
    const { getVersionInfo } = require('../lib/version-info');
    const info = getVersionInfo();
    expect(info.platform).toBe('android');
    expect(info.buildNumber).toBe('17');
    expect(info.isEmbedded).toBe(true);
    expect(info.updateId).toBeNull();
  });

  it('degrades gracefully when expoConfig is completely missing', () => {
    jest.resetModules();
    jest.doMock('expo-constants', () => ({
      __esModule: true,
      default: {},
    }));
    jest.doMock('expo-updates', () => ({
      runtimeVersion: null,
      channel: null,
      updateId: null,
      createdAt: null,
      isEmbeddedLaunch: false,
      isEmergencyLaunch: false,
    }));
    jest.doMock('react-native', () => ({ Platform: { OS: 'ios' } }));
    const { getVersionInfo } = require('../lib/version-info');
    const info = getVersionInfo();
    expect(info.appVersion).toBe('unknown');
    expect(info.runtimeVersion).toBe('unknown');
    expect(info.buildNumber).toBe('?');
    expect(info.channel).toBe('embedded');
  });

  it('surfaces emergency-launch flag', () => {
    jest.resetModules();
    jest.doMock('expo-constants', () => ({
      __esModule: true,
      default: { expoConfig: { version: '1.0.0', ios: { buildNumber: '6' } } },
    }));
    jest.doMock('expo-updates', () => ({
      runtimeVersion: '1.0.0',
      channel: 'preview',
      updateId: 'bad-update-id',
      createdAt: new Date('2026-04-01T00:00:00Z'),
      isEmbeddedLaunch: false,
      isEmergencyLaunch: true,
    }));
    jest.doMock('react-native', () => ({ Platform: { OS: 'ios' } }));
    const { getVersionInfo } = require('../lib/version-info');
    const info = getVersionInfo();
    expect(info.isEmergency).toBe(true);
  });
});
