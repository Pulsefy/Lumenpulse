import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  readThemeMode,
  resolveTheme,
  saveThemeMode,
  THEME_STORAGE_KEY,
} from '../theme-preference';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

const storage = AsyncStorage as unknown as {
  getItem: jest.Mock;
  setItem: jest.Mock;
  removeItem: jest.Mock;
};

describe('theme preference', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    storage.getItem.mockResolvedValue(null);
    storage.setItem.mockResolvedValue(undefined);
    storage.removeItem.mockResolvedValue(undefined);
  });

  describe('resolveTheme', () => {
    it('uses an explicit choice regardless of the OS', () => {
      expect(resolveTheme('dark', 'light')).toBe('dark');
      expect(resolveTheme('light', 'dark')).toBe('light');
    });

    it('follows the OS in system mode', () => {
      expect(resolveTheme('system', 'dark')).toBe('dark');
      expect(resolveTheme('system', 'light')).toBe('light');
    });

    it('falls back to light when the OS reports nothing', () => {
      expect(resolveTheme('system', null)).toBe('light');
      expect(resolveTheme('system', undefined)).toBe('light');
      expect(resolveTheme('system', 'unspecified')).toBe('light');
    });
  });

  it('persists the chosen mode under the shared key', async () => {
    await expect(saveThemeMode('dark')).resolves.toBe(true);
    expect(storage.setItem).toHaveBeenCalledWith(THEME_STORAGE_KEY, 'dark');
  });

  it('rejects invalid modes without writing', async () => {
    await expect(saveThemeMode('sepia' as never)).resolves.toBe(false);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('restores a saved mode', async () => {
    storage.getItem.mockResolvedValue('system');
    await expect(readThemeMode()).resolves.toBe('system');
  });

  it('clears an invalid stored value', async () => {
    storage.getItem.mockResolvedValue('sepia');
    await expect(readThemeMode()).resolves.toBeNull();
    expect(storage.removeItem).toHaveBeenCalledWith(THEME_STORAGE_KEY);
  });

  it('returns null when storage fails', async () => {
    storage.getItem.mockRejectedValue(new Error('disk'));
    await expect(readThemeMode()).resolves.toBeNull();
    storage.setItem.mockRejectedValue(new Error('disk'));
    await expect(saveThemeMode('light')).resolves.toBe(false);
  });
});
