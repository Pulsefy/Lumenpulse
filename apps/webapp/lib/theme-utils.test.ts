/**
 * Unit tests for theme utility functions
 * 
 * Tests system theme detection, validation, and error handling
 * Requirements: 2.4, 3.3, 3.5, 10.1, 10.2, 10.3, 10.4
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { detectSystemTheme } from './theme-utils';
import { DEFAULT_RESOLVED_THEME } from './theme-constants';

describe('detectSystemTheme', () => {
  // Store original window.matchMedia to restore after tests
  const originalMatchMedia = window.matchMedia;

  afterEach(() => {
    // Restore original matchMedia after each test
    window.matchMedia = originalMatchMedia;
    vi.restoreAllMocks();
  });

  describe('successful detection', () => {
    it('should return "dark" when system prefers dark mode', () => {
      // Requirement 2.1: Detect system theme using prefers-color-scheme
      window.matchMedia = vi.fn().mockImplementation((query) => ({
        matches: query === '(prefers-color-scheme: dark)',
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));

      const result = detectSystemTheme();
      expect(result).toBe('dark');
      expect(window.matchMedia).toHaveBeenCalledWith('(prefers-color-scheme: dark)');
    });

    it('should return "light" when system prefers light mode', () => {
      // Requirement 2.1: Detect system theme using prefers-color-scheme
      window.matchMedia = vi.fn().mockImplementation((query) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));

      const result = detectSystemTheme();
      expect(result).toBe('light');
      expect(window.matchMedia).toHaveBeenCalledWith('(prefers-color-scheme: dark)');
    });
  });

  describe('fallback behavior', () => {
    it('should return default theme when matchMedia is not supported', () => {
      // Requirement 2.4: Handle cases where detection is not supported
      // Requirement 10.1: Return 'light' as fallback when detection fails
      window.matchMedia = undefined as any;

      const result = detectSystemTheme();
      expect(result).toBe(DEFAULT_RESOLVED_THEME);
      expect(result).toBe('light');
    });

    it('should return default theme when matchMedia is not a function', () => {
      // Requirement 2.4: Handle cases where detection is not supported
      window.matchMedia = 'not a function' as any;

      const result = detectSystemTheme();
      expect(result).toBe(DEFAULT_RESOLVED_THEME);
    });

    it('should return default theme when matchMedia throws an error', () => {
      // Requirement 10.1: Handle errors gracefully
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      window.matchMedia = vi.fn().mockImplementation(() => {
        throw new Error('matchMedia error');
      });

      const result = detectSystemTheme();
      expect(result).toBe(DEFAULT_RESOLVED_THEME);
      expect(result).toBe('light');
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Failed to detect system theme:',
        expect.any(Error)
      );
    });
  });

  describe('edge cases', () => {
    it('should handle null matchMedia result', () => {
      // Requirement 10.1: Handle edge cases gracefully
      window.matchMedia = vi.fn().mockReturnValue(null as any);

      const result = detectSystemTheme();
      // Should not throw and should return a valid theme
      expect(['light', 'dark']).toContain(result);
    });

    it('should handle matchMedia result without matches property', () => {
      // Requirement 10.1: Handle edge cases gracefully
      window.matchMedia = vi.fn().mockReturnValue({
        media: '(prefers-color-scheme: dark)',
      } as any);

      const result = detectSystemTheme();
      // Should not throw and should return a valid theme
      expect(['light', 'dark']).toContain(result);
    });

    it('should handle multiple consecutive calls consistently', () => {
      // Ensure function is idempotent
      window.matchMedia = vi.fn().mockImplementation((query) => ({
        matches: true,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));

      const result1 = detectSystemTheme();
      const result2 = detectSystemTheme();
      const result3 = detectSystemTheme();

      expect(result1).toBe(result2);
      expect(result2).toBe(result3);
      expect(result1).toBe('dark');
    });
  });

  describe('server-side rendering compatibility', () => {
    it('should handle undefined window gracefully', () => {
      // Requirement 2.4: Handle cases where detection is not supported (SSR)
      const originalWindow = global.window;
      
      // Simulate SSR environment
      delete (global as any).window;

      const result = detectSystemTheme();
      expect(result).toBe(DEFAULT_RESOLVED_THEME);

      // Restore window
      global.window = originalWindow;
    });
  });

  describe('requirements validation', () => {
    it('should satisfy Requirement 2.1: Use prefers-color-scheme media query', () => {
      const matchMediaSpy = vi.fn().mockImplementation((query) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));
      
      window.matchMedia = matchMediaSpy;
      detectSystemTheme();

      expect(matchMediaSpy).toHaveBeenCalledWith('(prefers-color-scheme: dark)');
    });

    it('should satisfy Requirement 2.4: Handle unsupported detection', () => {
      window.matchMedia = undefined as any;
      
      // Should not throw
      expect(() => detectSystemTheme()).not.toThrow();
      
      // Should return a valid theme
      const result = detectSystemTheme();
      expect(['light', 'dark']).toContain(result);
    });

    it('should satisfy Requirement 10.1: Return light as fallback', () => {
      window.matchMedia = undefined as any;
      
      const result = detectSystemTheme();
      expect(result).toBe('light');
    });
  });
});

describe('saveThemePreference', () => {
  const { saveThemePreference } = require('./theme-utils');
  const { DEFAULT_STORAGE_KEY } = require('./theme-constants');

  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe('successful save operations', () => {
    it('should save valid theme preference to localStorage', () => {
      // Requirement 3.1: Save theme preference to localStorage
      const result = saveThemePreference('dark');
      
      expect(result).toBe(true);
      expect(localStorage.getItem(DEFAULT_STORAGE_KEY)).toBe('dark');
    });

    it('should save "light" theme preference', () => {
      const result = saveThemePreference('light');
      
      expect(result).toBe(true);
      expect(localStorage.getItem(DEFAULT_STORAGE_KEY)).toBe('light');
    });

    it('should save "system" theme preference', () => {
      const result = saveThemePreference('system');
      
      expect(result).toBe(true);
      expect(localStorage.getItem(DEFAULT_STORAGE_KEY)).toBe('system');
    });

    it('should use custom storage key when provided', () => {
      const customKey = 'custom-theme-key';
      const result = saveThemePreference('dark', customKey);
      
      expect(result).toBe(true);
      expect(localStorage.getItem(customKey)).toBe('dark');
      expect(localStorage.getItem(DEFAULT_STORAGE_KEY)).toBeNull();
    });

    it('should overwrite existing preference', () => {
      // Requirement 3.2: Persist user's theme preference
      saveThemePreference('light');
      expect(localStorage.getItem(DEFAULT_STORAGE_KEY)).toBe('light');
      
      saveThemePreference('dark');
      expect(localStorage.getItem(DEFAULT_STORAGE_KEY)).toBe('dark');
    });
  });

  describe('validation', () => {
    it('should reject invalid theme preference', () => {
      // Requirement 10.4: Validate stored values
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      const result = saveThemePreference('invalid' as any);
      
      expect(result).toBe(false);
      expect(localStorage.getItem(DEFAULT_STORAGE_KEY)).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Invalid theme preference: invalid'
      );
    });

    it('should reject empty string', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      const result = saveThemePreference('' as any);
      
      expect(result).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('should reject null value', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      const result = saveThemePreference(null as any);
      
      expect(result).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('should reject undefined value', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      const result = saveThemePreference(undefined as any);
      
      expect(result).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should handle localStorage.setItem errors gracefully', () => {
      // Requirement 10.2: Handle storage write failures
      // Requirement 10.3: Log error and continue operation
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const error = new Error('Storage quota exceeded');
      
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw error;
      });

      const result = saveThemePreference('dark');
      
      expect(result).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to save theme preference to localStorage:',
        error
      );
    });

    it('should handle localStorage unavailable in SSR', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const originalLocalStorage = global.localStorage;
      
      delete (global as any).localStorage;

      const result = saveThemePreference('dark');
      
      expect(result).toBe(false);
      expect(consoleWarnSpy).toHaveBeenCalledWith('localStorage is not available');

      global.localStorage = originalLocalStorage;
    });
  });
});

describe('readThemePreference', () => {
  const { readThemePreference } = require('./theme-utils');
  const { DEFAULT_STORAGE_KEY } = require('./theme-constants');

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe('successful read operations', () => {
    it('should read saved theme preference from localStorage', () => {
      // Requirement 3.1: Read theme preference from localStorage
      // Requirement 3.2: Retrieve saved theme preference
      localStorage.setItem(DEFAULT_STORAGE_KEY, 'dark');
      
      const result = readThemePreference();
      
      expect(result).toBe('dark');
    });

    it('should read "light" theme preference', () => {
      localStorage.setItem(DEFAULT_STORAGE_KEY, 'light');
      
      const result = readThemePreference();
      
      expect(result).toBe('light');
    });

    it('should read "system" theme preference', () => {
      localStorage.setItem(DEFAULT_STORAGE_KEY, 'system');
      
      const result = readThemePreference();
      
      expect(result).toBe('system');
    });

    it('should use custom storage key when provided', () => {
      const customKey = 'custom-theme-key';
      localStorage.setItem(customKey, 'dark');
      
      const result = readThemePreference(customKey);
      
      expect(result).toBe('dark');
    });

    it('should return null when no preference is stored', () => {
      const result = readThemePreference();
      
      expect(result).toBeNull();
    });
  });

  describe('validation and reset', () => {
    it('should validate stored value and reset if invalid', () => {
      // Requirement 10.4: Validate stored values
      // Requirement 3.5: Reset invalid preferences
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      localStorage.setItem(DEFAULT_STORAGE_KEY, 'invalid-theme');
      
      const result = readThemePreference();
      
      expect(result).toBeNull();
      expect(localStorage.getItem(DEFAULT_STORAGE_KEY)).toBeNull();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Invalid stored theme preference: invalid-theme. Resetting to default.'
      );
    });

    it('should reset empty string preference', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      localStorage.setItem(DEFAULT_STORAGE_KEY, '');
      
      const result = readThemePreference();
      
      expect(result).toBeNull();
      expect(localStorage.getItem(DEFAULT_STORAGE_KEY)).toBeNull();
    });

    it('should reset malformed JSON preference', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      localStorage.setItem(DEFAULT_STORAGE_KEY, '{"theme": "dark"}');
      
      const result = readThemePreference();
      
      expect(result).toBeNull();
      expect(localStorage.getItem(DEFAULT_STORAGE_KEY)).toBeNull();
    });
  });

  describe('error handling', () => {
    it('should handle localStorage.getItem errors gracefully', () => {
      // Requirement 10.2: Handle storage read failures
      // Requirement 10.3: Log error and continue operation
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const error = new Error('Storage access denied');
      
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw error;
      });

      const result = readThemePreference();
      
      expect(result).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to read theme preference from localStorage:',
        error
      );
    });

    it('should handle localStorage unavailable in SSR', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const originalLocalStorage = global.localStorage;
      
      delete (global as any).localStorage;

      const result = readThemePreference();
      
      expect(result).toBeNull();
      expect(consoleWarnSpy).toHaveBeenCalledWith('localStorage is not available');

      global.localStorage = originalLocalStorage;
    });
  });

  describe('integration with saveThemePreference', () => {
    it('should read what was saved', () => {
      const { saveThemePreference } = require('./theme-utils');
      
      saveThemePreference('dark');
      const result = readThemePreference();
      
      expect(result).toBe('dark');
    });

    it('should handle multiple save and read cycles', () => {
      const { saveThemePreference } = require('./theme-utils');
      
      saveThemePreference('light');
      expect(readThemePreference()).toBe('light');
      
      saveThemePreference('dark');
      expect(readThemePreference()).toBe('dark');
      
      saveThemePreference('system');
      expect(readThemePreference()).toBe('system');
    });
  });
});

describe('clearThemePreference', () => {
  const { clearThemePreference, saveThemePreference } = require('./theme-utils');
  const { DEFAULT_STORAGE_KEY } = require('./theme-constants');

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe('successful clear operations', () => {
    it('should clear theme preference from localStorage', () => {
      // Requirement 3.5: Remove invalid or unwanted preferences
      localStorage.setItem(DEFAULT_STORAGE_KEY, 'dark');
      
      const result = clearThemePreference();
      
      expect(result).toBe(true);
      expect(localStorage.getItem(DEFAULT_STORAGE_KEY)).toBeNull();
    });

    it('should use custom storage key when provided', () => {
      const customKey = 'custom-theme-key';
      localStorage.setItem(customKey, 'dark');
      
      const result = clearThemePreference(customKey);
      
      expect(result).toBe(true);
      expect(localStorage.getItem(customKey)).toBeNull();
    });

    it('should succeed even when no preference exists', () => {
      const result = clearThemePreference();
      
      expect(result).toBe(true);
      expect(localStorage.getItem(DEFAULT_STORAGE_KEY)).toBeNull();
    });

    it('should not affect other localStorage keys', () => {
      localStorage.setItem(DEFAULT_STORAGE_KEY, 'dark');
      localStorage.setItem('other-key', 'other-value');
      
      clearThemePreference();
      
      expect(localStorage.getItem(DEFAULT_STORAGE_KEY)).toBeNull();
      expect(localStorage.getItem('other-key')).toBe('other-value');
    });
  });

  describe('error handling', () => {
    it('should handle localStorage.removeItem errors gracefully', () => {
      // Requirement 10.2: Handle storage operations failures
      // Requirement 10.3: Log error and continue operation
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const error = new Error('Storage access denied');
      
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw error;
      });

      const result = clearThemePreference();
      
      expect(result).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to clear theme preference from localStorage:',
        error
      );
    });

    it('should handle localStorage unavailable in SSR', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const originalLocalStorage = global.localStorage;
      
      delete (global as any).localStorage;

      const result = clearThemePreference();
      
      expect(result).toBe(false);
      expect(consoleWarnSpy).toHaveBeenCalledWith('localStorage is not available');

      global.localStorage = originalLocalStorage;
    });
  });

  describe('integration scenarios', () => {
    it('should clear after save', () => {
      saveThemePreference('dark');
      expect(localStorage.getItem(DEFAULT_STORAGE_KEY)).toBe('dark');
      
      clearThemePreference();
      expect(localStorage.getItem(DEFAULT_STORAGE_KEY)).toBeNull();
    });

    it('should allow save after clear', () => {
      saveThemePreference('dark');
      clearThemePreference();
      
      saveThemePreference('light');
      expect(localStorage.getItem(DEFAULT_STORAGE_KEY)).toBe('light');
    });
  });
});
