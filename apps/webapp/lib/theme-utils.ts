/**
 * Theme utility functions
 * 
 * This file contains utility functions for theme detection and management,
 * including system theme detection, localStorage persistence, and validation helpers.
 */

import { ResolvedTheme, ThemePreference } from '@/types/theme';
import { 
  SYSTEM_THEME_MEDIA_QUERY, 
  DEFAULT_RESOLVED_THEME, 
  DEFAULT_STORAGE_KEY,
  DEFAULT_THEME_PREFERENCE,
  isValidThemePreference
} from './theme-constants';

/**
 * Detects the current system theme preference using the prefers-color-scheme media query
 * 
 * This function checks if the browser supports the prefers-color-scheme media query
 * and returns the detected theme. If detection is not supported or fails, it returns
 * 'light' as the default fallback theme.
 * 
 * Requirements: 2.1, 2.3, 2.4, 10.1
 * 
 * @returns {ResolvedTheme} The detected system theme ('dark' or 'light')
 * 
 * @example
 * ```typescript
 * const systemTheme = detectSystemTheme();
 * console.log(systemTheme); // 'dark' or 'light'
 * ```
 */
export function detectSystemTheme(): ResolvedTheme {
  // Check if we're in a browser environment
  // Requirement 2.4: Handle cases where detection is not supported
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    // Requirement 10.1: Return 'light' as fallback when detection fails
    return DEFAULT_RESOLVED_THEME;
  }

  try {
    // Requirement 2.1: Detect system theme using prefers-color-scheme media query
    // Requirement 2.3: Use the prefers-color-scheme media query
    const mediaQuery = window.matchMedia(SYSTEM_THEME_MEDIA_QUERY);
    
    // If the media query matches, the system prefers dark mode
    if (mediaQuery.matches) {
      return 'dark';
    }
    
    // Otherwise, the system prefers light mode
    return 'light';
  } catch (error) {
    // Requirement 10.1: Handle errors gracefully and return fallback
    console.warn('Failed to detect system theme:', error);
    return DEFAULT_RESOLVED_THEME;
  }
}

/**
 * Saves the theme preference to localStorage
 * 
 * This function persists the user's theme preference to browser localStorage
 * for retrieval across sessions. It includes error handling for storage failures
 * and validates the theme value before saving.
 * 
 * Requirements: 3.1, 3.2, 10.2, 10.3
 * 
 * @param {ThemePreference} theme - The theme preference to save ('light', 'dark', or 'system')
 * @param {string} [storageKey] - Optional custom storage key (defaults to DEFAULT_STORAGE_KEY)
 * @returns {boolean} True if save was successful, false otherwise
 * 
 * @example
 * ```typescript
 * const success = saveThemePreference('dark');
 * if (success) {
 *   console.log('Theme preference saved');
 * }
 * ```
 */
export function saveThemePreference(
  theme: ThemePreference,
  storageKey: string = DEFAULT_STORAGE_KEY
): boolean {
  // Validate the theme value before saving
  // Requirement 10.4: Validate stored values
  if (!isValidThemePreference(theme)) {
    console.error(`Invalid theme preference: ${theme}`);
    return false;
  }

  // Check if we're in a browser environment
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    console.warn('localStorage is not available');
    return false;
  }

  try {
    // Requirement 3.1: Save theme preference to localStorage
    // Requirement 3.2: Persist user's theme preference
    window.localStorage.setItem(storageKey, theme);
    return true;
  } catch (error) {
    // Requirement 10.2: Handle storage write failures
    // Requirement 10.3: Log error and continue operation
    console.error('Failed to save theme preference to localStorage:', error);
    return false;
  }
}

/**
 * Reads the theme preference from localStorage
 * 
 * This function retrieves the user's saved theme preference from browser localStorage.
 * It includes validation of the stored value and returns a fallback if the stored
 * value is invalid or if storage operations fail.
 * 
 * Requirements: 3.1, 3.2, 3.5, 10.2, 10.4
 * 
 * @param {string} [storageKey] - Optional custom storage key (defaults to DEFAULT_STORAGE_KEY)
 * @returns {ThemePreference | null} The stored theme preference, or null if not found or invalid
 * 
 * @example
 * ```typescript
 * const savedTheme = readThemePreference();
 * if (savedTheme) {
 *   console.log('Saved theme:', savedTheme);
 * } else {
 *   console.log('No saved theme found');
 * }
 * ```
 */
export function readThemePreference(
  storageKey: string = DEFAULT_STORAGE_KEY
): ThemePreference | null {
  // Check if we're in a browser environment
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    console.warn('localStorage is not available');
    return null;
  }

  try {
    // Requirement 3.1: Read theme preference from localStorage
    // Requirement 3.2: Retrieve saved theme preference
    const storedValue = window.localStorage.getItem(storageKey);

    // If no value is stored, return null
    if (storedValue === null) {
      return null;
    }

    // Requirement 10.4: Validate stored values
    // Requirement 3.5: Reset invalid preferences
    if (!isValidThemePreference(storedValue)) {
      console.warn(`Invalid stored theme preference: ${storedValue}. Resetting to default.`);
      // Reset invalid preference by removing it
      window.localStorage.removeItem(storageKey);
      return null;
    }

    return storedValue as ThemePreference;
  } catch (error) {
    // Requirement 10.2: Handle storage read failures
    // Requirement 10.3: Log error and continue operation
    console.error('Failed to read theme preference from localStorage:', error);
    return null;
  }
}

/**
 * Clears the theme preference from localStorage
 * 
 * This function removes the stored theme preference from localStorage.
 * Useful for resetting to default behavior or clearing invalid data.
 * 
 * Requirements: 3.5, 10.2, 10.3
 * 
 * @param {string} [storageKey] - Optional custom storage key (defaults to DEFAULT_STORAGE_KEY)
 * @returns {boolean} True if clear was successful, false otherwise
 * 
 * @example
 * ```typescript
 * const success = clearThemePreference();
 * if (success) {
 *   console.log('Theme preference cleared');
 * }
 * ```
 */
export function clearThemePreference(
  storageKey: string = DEFAULT_STORAGE_KEY
): boolean {
  // Check if we're in a browser environment
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    console.warn('localStorage is not available');
    return false;
  }

  try {
    // Requirement 3.5: Remove invalid or unwanted preferences
    window.localStorage.removeItem(storageKey);
    return true;
  } catch (error) {
    // Requirement 10.2: Handle storage operations failures
    // Requirement 10.3: Log error and continue operation
    console.error('Failed to clear theme preference from localStorage:', error);
    return false;
  }
}
