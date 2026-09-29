import AsyncStorage from '@react-native-async-storage/async-storage';

import { errorReporter } from '../error-reporting';
import {
  DEFAULT_PRIVACY_PREFERENCES,
  applyPrivacyPreferences,
  getPrivacyPreferences,
  setAnalyticsEnabled,
  setCrashReportingEnabled,
} from '../privacy-preferences';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  multiGet: jest.fn(),
}));

const mockedStorage = AsyncStorage as unknown as {
  setItem: jest.Mock;
  multiGet: jest.Mock;
};

const ANALYTICS_KEY = 'lumenpulse.privacy.analytics_enabled';
const CRASH_KEY = 'lumenpulse.privacy.crash_reporting_enabled';

function primePreferences(analytics: string | null, crash: string | null) {
  mockedStorage.multiGet.mockResolvedValue([
    [ANALYTICS_KEY, analytics],
    [CRASH_KEY, crash],
  ]);
}

describe('privacy preferences', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedStorage.setItem.mockResolvedValue(undefined);
    errorReporter.setEnabled(true);
  });

  it('defaults both toggles to enabled when nothing is stored', async () => {
    primePreferences(null, null);

    await expect(getPrivacyPreferences()).resolves.toEqual(DEFAULT_PRIVACY_PREFERENCES);
  });

  it('honours a stored opt-out', async () => {
    primePreferences('false', 'false');

    await expect(getPrivacyPreferences()).resolves.toEqual({
      analyticsEnabled: false,
      crashReportingEnabled: false,
    });
  });

  it('falls back to the default for a corrupted value rather than guessing', async () => {
    primePreferences('maybe', '');

    await expect(getPrivacyPreferences()).resolves.toEqual(DEFAULT_PRIVACY_PREFERENCES);
  });

  it('falls back to defaults when storage throws', async () => {
    mockedStorage.multiGet.mockRejectedValue(new Error('storage offline'));
    jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(getPrivacyPreferences()).resolves.toEqual(DEFAULT_PRIVACY_PREFERENCES);
  });

  it('persists an analytics opt-out', async () => {
    primePreferences('false', 'true');

    const preferences = await setAnalyticsEnabled(false);

    expect(mockedStorage.setItem).toHaveBeenCalledWith(ANALYTICS_KEY, 'false');
    expect(preferences.analyticsEnabled).toBe(false);
  });

  it('applies a crash-reporting opt-out to the reporter immediately', async () => {
    primePreferences('true', 'false');

    await setCrashReportingEnabled(false);

    expect(mockedStorage.setItem).toHaveBeenCalledWith(CRASH_KEY, 'false');
    expect(errorReporter.enabled).toBe(false);
  });

  it('re-enables the reporter when the user opts back in', async () => {
    primePreferences('true', 'true');
    errorReporter.setEnabled(false);

    await setCrashReportingEnabled(true);

    expect(errorReporter.enabled).toBe(true);
  });

  it('applies stored preferences to the reporter at start-up', async () => {
    primePreferences('true', 'false');

    const preferences = await applyPrivacyPreferences();

    expect(preferences.crashReportingEnabled).toBe(false);
    expect(errorReporter.enabled).toBe(false);
  });
});

describe('errorReporter opt-out behaviour', () => {
  beforeEach(() => {
    errorReporter.setEnabled(true);
  });

  it('drops captured errors while disabled', () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    errorReporter.setEnabled(false);

    errorReporter.captureError(new Error('boom'));

    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('reports captured errors while enabled', () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    errorReporter.captureError(new Error('boom'));

    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
