/**
 * Analytics and crash-reporting opt-out preferences.
 *
 * These live under the `lumenpulse.privacy.` namespace, which
 * {@link ./local-data} treats as protected: clearing local data must never
 * silently opt a user back in to reporting they had turned off.
 *
 * Both default to enabled, matching the app's behaviour before this screen
 * existed. `false` means the user explicitly opted out.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { errorReporter } from './error-reporting';

export const PRIVACY_KEY_PREFIX = 'lumenpulse.privacy.';

const ANALYTICS_ENABLED_KEY = `${PRIVACY_KEY_PREFIX}analytics_enabled`;
const CRASH_REPORTING_ENABLED_KEY = `${PRIVACY_KEY_PREFIX}crash_reporting_enabled`;

export interface PrivacyPreferences {
  /** Usage analytics collection. */
  analyticsEnabled: boolean;
  /** Automatic crash and error reporting. */
  crashReportingEnabled: boolean;
}

export const DEFAULT_PRIVACY_PREFERENCES: PrivacyPreferences = {
  analyticsEnabled: true,
  crashReportingEnabled: true,
};

/**
 * A stored value is only honoured when it is exactly `'false'`. Anything else —
 * missing, corrupted, a half-written string — falls back to the default rather
 * than guessing, so a storage glitch can never flip a preference silently.
 */
const parseStoredFlag = (raw: string | null, fallback: boolean): boolean => {
  if (raw === 'false') return false;
  if (raw === 'true') return true;
  return fallback;
};

export async function getPrivacyPreferences(): Promise<PrivacyPreferences> {
  try {
    const [[, analytics], [, crashReporting]] = await AsyncStorage.multiGet([
      ANALYTICS_ENABLED_KEY,
      CRASH_REPORTING_ENABLED_KEY,
    ]);

    return {
      analyticsEnabled: parseStoredFlag(analytics, DEFAULT_PRIVACY_PREFERENCES.analyticsEnabled),
      crashReportingEnabled: parseStoredFlag(
        crashReporting,
        DEFAULT_PRIVACY_PREFERENCES.crashReportingEnabled,
      ),
    };
  } catch (error) {
    console.error('Error reading privacy preferences:', error);
    return { ...DEFAULT_PRIVACY_PREFERENCES };
  }
}

export async function setAnalyticsEnabled(enabled: boolean): Promise<PrivacyPreferences> {
  await AsyncStorage.setItem(ANALYTICS_ENABLED_KEY, String(enabled));
  return getPrivacyPreferences();
}

export async function setCrashReportingEnabled(enabled: boolean): Promise<PrivacyPreferences> {
  await AsyncStorage.setItem(CRASH_REPORTING_ENABLED_KEY, String(enabled));
  // Apply immediately so an opt-out takes effect for the current session
  // rather than only after the next launch.
  errorReporter.setEnabled(enabled);
  return getPrivacyPreferences();
}

/**
 * Reads the stored preferences and applies them to the reporting clients.
 * Call once during app start-up, after storage is available.
 */
export async function applyPrivacyPreferences(): Promise<PrivacyPreferences> {
  const preferences = await getPrivacyPreferences();
  errorReporter.setEnabled(preferences.crashReportingEnabled);
  return preferences;
}
