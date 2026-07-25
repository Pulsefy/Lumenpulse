export interface ReleaseInfo {
  version: string;
  date: string;
  title: string;
  notes: string[];
}

export interface ReleaseMetadata {
  releases: ReleaseInfo[];
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
