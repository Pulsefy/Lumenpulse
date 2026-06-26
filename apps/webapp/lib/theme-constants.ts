/**
 * Theme system constants
 * 
 * This file contains all constant values used by the theme system,
 * including storage keys, default values, and transition configurations.
 */

import { ThemePreference, ResolvedTheme, ThemeTransitionConfig } from '@/types/theme';

/**
 * Default localStorage key for storing theme preference
 * Requirements: 3.1, 3.3
 */
export const DEFAULT_STORAGE_KEY = 'lumenpulse-theme-preference';

/**
 * Default theme preference when no stored preference exists
 * Requirements: 1.1, 3.3
 */
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system';

/**
 * Default resolved theme when system detection fails
 * Requirements: 2.4, 10.1
 */
export const DEFAULT_RESOLVED_THEME: ResolvedTheme = 'light';

/**
 * HTML attribute name for theme data attribute
 * Used to apply theme to the document element
 */
export const THEME_ATTRIBUTE = 'data-theme';

/**
 * Media query for detecting system theme preference
 * Requirements: 2.1, 2.3
 */
export const SYSTEM_THEME_MEDIA_QUERY = '(prefers-color-scheme: dark)';

/**
 * Media query for detecting reduced motion preference
 * Requirements: 7.3, 7.4
 */
export const REDUCED_MOTION_MEDIA_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Default transition configuration for theme changes
 * Requirements: 5.1, 5.2, 5.4, 7.3, 7.4
 */
export const DEFAULT_TRANSITION_CONFIG: ThemeTransitionConfig = {
  duration: 250, // milliseconds
  properties: ['background-color', 'color', 'border-color'],
  timingFunction: 'ease-in-out',
  respectReducedMotion: true,
};

/**
 * Maximum time allowed for initial theme setup
 * Requirements: 9.5
 */
export const INITIAL_THEME_SETUP_TIMEOUT = 50; // milliseconds

/**
 * Maximum time allowed for theme application after selection
 * Requirements: 1.2
 */
export const THEME_APPLICATION_TIMEOUT = 100; // milliseconds

/**
 * Maximum time allowed for system theme change detection
 * Requirements: 2.2
 */
export const SYSTEM_THEME_CHANGE_TIMEOUT = 200; // milliseconds

/**
 * Valid theme preference values for validation
 * Requirements: 1.5, 3.4, 10.4
 */
export const VALID_THEME_PREFERENCES: readonly ThemePreference[] = ['light', 'dark', 'system'] as const;

/**
 * Valid resolved theme values for validation
 */
export const VALID_RESOLVED_THEMES: readonly ResolvedTheme[] = ['light', 'dark'] as const;

/**
 * Validates if a value is a valid theme preference
 * 
 * @param value - Value to validate
 * @returns True if the value is a valid theme preference
 */
export function isValidThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && VALID_THEME_PREFERENCES.includes(value as ThemePreference);
}

/**
 * Validates if a value is a valid resolved theme
 * 
 * @param value - Value to validate
 * @returns True if the value is a valid resolved theme
 */
export function isValidResolvedTheme(value: unknown): value is ResolvedTheme {
  return typeof value === 'string' && VALID_RESOLVED_THEMES.includes(value as ResolvedTheme);
}
