/**
 * Theme type definitions for the Lumenpulse application
 * 
 * This file contains all TypeScript interfaces and types related to the theme system,
 * including theme preferences, state management, and context values.
 */

/**
 * Available theme modes
 * - 'light': Light theme with bright backgrounds
 * - 'dark': Dark theme with dark backgrounds
 * - 'system': Automatically follows the system/OS theme preference
 */
export type ThemePreference = 'light' | 'dark' | 'system';

/**
 * Resolved theme values (actual theme being displayed)
 * System preference is resolved to either 'light' or 'dark'
 */
export type ResolvedTheme = 'light' | 'dark';

/**
 * Internal state managed by the ThemeProvider
 * 
 * @property preference - The user's explicit theme preference
 * @property resolvedTheme - The currently active theme (what's actually displayed)
 * @property systemTheme - The detected system/OS theme preference
 */
export interface ThemeState {
  /** The user's explicit preference ('light', 'dark', or 'system') */
  preference: ThemePreference;
  
  /** The currently resolved theme ('light' or 'dark') */
  resolvedTheme: ResolvedTheme;
  
  /** System theme detection result ('light' or 'dark') */
  systemTheme: ResolvedTheme;
}

/**
 * Context value provided to all components via ThemeContext
 * 
 * This interface defines what's available to components that consume the theme context
 */
export interface ThemeContextValue {
  /** Current resolved theme ('light' or 'dark') */
  theme: ResolvedTheme;
  
  /** User's preference ('light', 'dark', or 'system') */
  preference: ThemePreference;
  
  /** System's detected theme ('light' or 'dark') */
  systemTheme: ResolvedTheme;
  
  /** Function to update theme preference */
  setTheme: (theme: ThemePreference) => void;
  
  /** Whether transitions are enabled for theme changes */
  enableTransitions: boolean;
}

/**
 * Props for the ThemeProvider component
 */
export interface ThemeProviderProps {
  /** Child components to be wrapped by the provider */
  children: React.ReactNode;
  
  /** Default theme to use if no preference is stored (defaults to 'system') */
  defaultTheme?: ThemePreference;
  
  /** localStorage key for persisting theme preference (defaults to 'lumenpulse-theme-preference') */
  storageKey?: string;
  
  /** Whether to enable smooth transitions when changing themes (defaults to true) */
  enableTransitions?: boolean;
}

/**
 * Configuration for theme transitions
 */
export interface ThemeTransitionConfig {
  /** Transition duration in milliseconds */
  duration: number;
  
  /** CSS properties to apply transitions to */
  properties: string[];
  
  /** CSS timing function for transitions */
  timingFunction: string;
  
  /** Whether to respect prefers-reduced-motion setting */
  respectReducedMotion: boolean;
}
