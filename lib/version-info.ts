/**
 * Aggregated version information for the About screen.
 *
 * Pulls from expo-constants (app.json baked into the bundle), expo-updates
 * (OTA runtime metadata), and react-native Platform. Returns a plain object
 * so it's easy to render, log, or copy to clipboard.
 *
 * Why this module exists: every time we ship an OTA it's hard to tell whether
 * the new bundle is actually running on the device. Surfacing updateId +
 * createdAt + channel in-app removes the guesswork.
 */
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';

export interface VersionInfo {
  /** App version from app.json (ties to runtimeVersion under the "appVersion" policy). */
  appVersion: string;
  /** EAS runtime version the currently-running bundle is tied to. */
  runtimeVersion: string;
  /** iOS buildNumber or Android versionCode from the bundle's view of app.json. */
  buildNumber: string;
  /** EAS Update channel (e.g. "preview", "production"). "embedded" when no OTA has been applied. */
  channel: string;
  /** EAS Update ID of the bundle currently running. null when it's the one embedded in the native build. */
  updateId: string | null;
  /** When the currently-running OTA bundle was published. null when embedded. */
  updateCreatedAt: string | null;
  /** True if running the bundle baked into the native build (no OTA applied). */
  isEmbedded: boolean;
  /** True if expo-updates fell back to the embedded bundle after an OTA failed to load. */
  isEmergency: boolean;
  /** ios / android / web. */
  platform: string;
}

export function getVersionInfo(): VersionInfo {
  const cfg = Constants.expoConfig ?? ({} as any);

  const buildNumber =
    Platform.OS === 'ios'
      ? String(cfg.ios?.buildNumber ?? '?')
      : String(cfg.android?.versionCode ?? '?');

  return {
    appVersion: String(cfg.version ?? 'unknown'),
    runtimeVersion: String(Updates.runtimeVersion ?? 'unknown'),
    buildNumber,
    channel: String(Updates.channel ?? 'embedded'),
    updateId: Updates.updateId ?? null,
    updateCreatedAt: Updates.createdAt?.toISOString() ?? null,
    isEmbedded: Boolean(Updates.isEmbeddedLaunch),
    isEmergency: Boolean(Updates.isEmergencyLaunch),
    platform: Platform.OS,
  };
}

/** One-line human-friendly summary, safe to include in crash logs. */
export function formatVersionSummary(info: VersionInfo): string {
  const src = info.isEmbedded ? 'embedded' : info.updateId?.slice(0, 8) ?? 'unknown';
  return `v${info.appVersion} (${info.platform} build ${info.buildNumber}) · ${info.channel} · ${src}`;
}
