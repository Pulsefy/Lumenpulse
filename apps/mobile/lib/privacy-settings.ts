import AsyncStorage from '@react-native-async-storage/async-storage';

export interface PrivacySettings {
  backgroundRefreshEnabled: boolean;
}

export const DEFAULT_PRIVACY_SETTINGS: PrivacySettings = {
  backgroundRefreshEnabled: true,
};

const STORAGE_KEY = 'lumenpulse:privacy-settings:v1';

function normalize(raw: unknown): PrivacySettings {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_PRIVACY_SETTINGS };
  }
  const value = raw as Record<string, unknown>;
  return {
    backgroundRefreshEnabled:
      typeof value.backgroundRefreshEnabled === 'boolean'
        ? value.backgroundRefreshEnabled
        : DEFAULT_PRIVACY_SETTINGS.backgroundRefreshEnabled,
  };
}

export async function getPrivacySettings(): Promise<PrivacySettings> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return { ...DEFAULT_PRIVACY_SETTINGS };
    }
    return normalize(JSON.parse(stored));
  } catch {
    return { ...DEFAULT_PRIVACY_SETTINGS };
  }
}

export async function savePrivacySettings(settings: PrivacySettings): Promise<void> {
  const next = normalize(settings);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export async function setBackgroundRefreshEnabled(
  enabled: boolean,
): Promise<PrivacySettings> {
  const current = await getPrivacySettings();
  const next = { ...current, backgroundRefreshEnabled: enabled };
  await savePrivacySettings(next);
  return next;
}
