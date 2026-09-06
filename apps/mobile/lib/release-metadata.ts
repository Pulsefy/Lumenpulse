export interface ReleaseInfo {
  version: string;
  date: string;
  title: string;
  notes: string[];
}

export interface ReleaseMetadata {
  releases: ReleaseInfo[];
}

export interface UpdateInfo {
  runtimeVersion: string | null;
  updateId: string | null;
  channel: string | null;
  isEmbedded: boolean;
}

export const fallbackReleaseMetadata: ReleaseMetadata = {
  releases: [
    {
      version: '1.0.0',
      date: '2026-07-24',
      title: 'Initial MVP Release (Fallback)',
      notes: [
        'Active environment check for Testnet and Mainnet.',
        'Network context status indicators.',
        'Basic wallet and notification settings.'
      ]
    }
  ]
};

/**
 * Safely loads the release metadata JSON asset.
 * If the file is missing, empty, or malformed, it falls back to the default hardcoded release info.
 */
export function getReleaseMetadata(): ReleaseMetadata {
  try {
    // In React Native / Expo with Metro bundler, require is evaluated statically at build time.
    // If the file is successfully resolved, we validate its structure.
    const metadata = require('../assets/release-metadata.json');
    if (metadata && Array.isArray(metadata.releases)) {
      return metadata as ReleaseMetadata;
    }
  } catch (error) {
    // Graceful fallback when release metadata is unavailable or malformed
    console.warn('Unable to load release metadata, using fallback:', error);
  }
  return fallbackReleaseMetadata;
}

/**
 * Retrieves the current OTA update information from expo-updates.
 * Returns null values when no update metadata is available (e.g. in a development client).
 */
export function getUpdateInfo(): UpdateInfo {
  try {
    const Updates = require('expo-updates');
    return {
      runtimeVersion: Updates.runtimeVersion ?? null,
      updateId: Updates.updateId ?? null,
      channel: Updates.channel ?? null,
      isEmbedded: Updates.isEmbeddedLaunch ?? false,
    };
  } catch (error) {
    console.warn('Unable to load expo-updates, using fallback update info:', error);
    return { runtimeVersion: null, updateId: null, channel: null, isEmbedded: false };
  }
}
