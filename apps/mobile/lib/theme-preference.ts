import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ResolvedTheme, ThemeMode } from '../theme/tokens';

/**
 * Mirrors the webapp's lib/theme-constants.ts + theme-utils.ts: same
 * preference values, same 'system' default and 'light' fallback.
 */
export const THEME_STORAGE_KEY = '@theme_mode';
export const DEFAULT_THEME_MODE: ThemeMode = 'system';
export const DEFAULT_RESOLVED_THEME: ResolvedTheme = 'light';
export const VALID_THEME_MODES: readonly ThemeMode[] = ['light', 'dark', 'system'];

export function isValidThemeMode(value: unknown): value is ThemeMode {
  return typeof value === 'string' && VALID_THEME_MODES.includes(value as ThemeMode);
}

/**
 * Resolves a preference to a concrete theme. `systemScheme` is the value of
 * React Native's useColorScheme(), which may be null/undefined/'unspecified'
 * when the OS does not report one.
 */
export function resolveTheme(mode: ThemeMode, systemScheme: string | null | undefined): ResolvedTheme {
  if (mode === 'light' || mode === 'dark') return mode;
  if (systemScheme === 'dark' || systemScheme === 'light') return systemScheme;
  return DEFAULT_RESOLVED_THEME;
}

/** Reads the saved preference; invalid stored values are cleared and ignored. */
export async function readThemeMode(): Promise<ThemeMode | null> {
  try {
    const stored = await AsyncStorage.getItem(THEME_STORAGE_KEY);
    if (stored === null) return null;
    if (!isValidThemeMode(stored)) {
      await AsyncStorage.removeItem(THEME_STORAGE_KEY);
      return null;
    }
    return stored;
  } catch (error) {
    console.warn('Failed to read theme preference', error);
    return null;
  }
}

export async function saveThemeMode(mode: ThemeMode): Promise<boolean> {
  if (!isValidThemeMode(mode)) return false;
  try {
    await AsyncStorage.setItem(THEME_STORAGE_KEY, mode);
    return true;
  } catch (error) {
    console.warn('Failed to save theme preference', error);
    return false;
  }
}
