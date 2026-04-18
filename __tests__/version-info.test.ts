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
});
