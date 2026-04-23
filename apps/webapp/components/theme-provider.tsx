"use client";

import { useEffect, useState, useCallback, ReactNode } from 'react';
import { ThemeContext } from '@/contexts/theme-context';
import { 
  ThemePreference, 
  ResolvedTheme, 
  ThemeState,
  ThemeProviderProps 
} from '@/types/theme';
import {
  DEFAULT_STORAGE_KEY,
  DEFAULT_THEME_PREFERENCE,
  DEFAULT_RESOLVED_THEME,
  THEME_ATTRIBUTE,
} from '@/lib/theme-constants';
import {
  detectSystemTheme,
  saveThemePreference,
  readThemePreference,
} from '@/lib/theme-utils';

/**
 * ThemeProvider component manages theme state and provides it to the application
 * 
 * This component:
 * - Initializes theme state from localStorage or defaults
 * - Detects and tracks system theme changes
 * - Resolves 'system' preference to actual light/dark theme
 * - Persists user preferences to localStorage
 * - Applies theme to the document element
 * - Provides theme context to all child components
 * 
 * Requirements: 1.2, 1.4, 3.1, 3.2, 6.4
 * 
 * @example
 * ```tsx
 * <ThemeProvider defaultTheme="system" enableTransitions={true}>
 *   <App />
 * </ThemeProvider>
 * ```
 */
export function ThemeProvider({
  children,
  defaultTheme = DEFAULT_THEME_PREFERENCE,
  storageKey = DEFAULT_STORAGE_KEY,
  enableTransitions = true,
}: ThemeProviderProps) {
  // Initialize state with defaults
  // We'll update these in useEffect after mount to avoid hydration mismatch
  const [themeState, setThemeState] = useState<ThemeState>(() => {
    // During SSR or initial render, use safe defaults
    return {
      preference: defaultTheme,
      resolvedTheme: DEFAULT_RESOLVED_THEME,
      systemTheme: DEFAULT_RESOLVED_THEME,
    };
  });

  /**
   * Resolves a theme preference to an actual theme value
   * If preference is 'system', returns the system theme
   * Otherwise returns the preference as-is
   * 
   * Requirements: 1.4, 2.1
   */
  const resolveTheme = useCallback((
    preference: ThemePreference,
    systemTheme: ResolvedTheme
  ): ResolvedTheme => {
    if (preference === 'system') {
      return systemTheme;
    }
    return preference as ResolvedTheme;
  }, []);

  /**
   * Updates the theme preference and persists it to localStorage
   * 
   * This function:
   * 1. Updates the preference in state
   * 2. Resolves the preference to an actual theme
   * 3. Saves the preference to localStorage
   * 
   * Requirements: 1.2, 1.4, 3.1, 3.2, 6.4
   */
  const setTheme = useCallback((newPreference: ThemePreference) => {
    setThemeState((prevState) => {
      // Resolve the new preference to an actual theme
      const newResolvedTheme = resolveTheme(newPreference, prevState.systemTheme);

      // Save preference to localStorage
      // Requirement 3.1, 3.2: Persist user's theme preference
      saveThemePreference(newPreference, storageKey);

      return {
        ...prevState,
        preference: newPreference,
        resolvedTheme: newResolvedTheme,
      };
    });
  }, [resolveTheme, storageKey]);

  // Initialize theme from localStorage on mount
  // Requirement 3.1, 3.2: Retrieve saved theme preference
  useEffect(() => {
    // Detect system theme
    const detectedSystemTheme = detectSystemTheme();

    // Read saved preference from localStorage
    const savedPreference = readThemePreference(storageKey);
    
    // Use saved preference if available, otherwise use default
    const initialPreference = savedPreference ?? defaultTheme;

    // Resolve the preference to an actual theme
    const initialResolvedTheme = resolveTheme(initialPreference, detectedSystemTheme);

    // Update state with initialized values
    setThemeState({
      preference: initialPreference,
      resolvedTheme: initialResolvedTheme,
      systemTheme: detectedSystemTheme,
    });
  }, [defaultTheme, storageKey, resolveTheme]);

  // Listen for system theme changes
  // Requirement 2.2, 2.3: Update theme when system preference changes within 200ms
  useEffect(() => {
    // Only set up listener in browser environment
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    // Create media query for system theme detection
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    // Handler for system theme changes
    const handleSystemThemeChange = (event: MediaQueryListEvent | MediaQueryList) => {
      const newSystemTheme: ResolvedTheme = event.matches ? 'dark' : 'light';

      setThemeState((prevState) => {
        // Only update if system theme actually changed
        if (prevState.systemTheme === newSystemTheme) {
          return prevState;
        }

        // If user preference is 'system', we need to update the resolved theme too
        const newResolvedTheme = prevState.preference === 'system' 
          ? newSystemTheme 
          : prevState.resolvedTheme;

        return {
          ...prevState,
          systemTheme: newSystemTheme,
          resolvedTheme: newResolvedTheme,
        };
      });
    };

    // Set up the listener
    // Modern browsers use addEventListener, older ones use addListener
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleSystemThemeChange);
    } else {
      // Fallback for older browsers
      mediaQuery.addListener(handleSystemThemeChange);
    }

    // Cleanup listener on unmount
    return () => {
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener('change', handleSystemThemeChange);
      } else {
        // Fallback for older browsers
        mediaQuery.removeListener(handleSystemThemeChange);
      }
    };
  }, []);

  // Apply theme to document element whenever resolvedTheme changes
  // Requirement 1.2: Apply theme within 100ms of selection
  // Requirement 4.2: Update CSS variables when theme changes
  // Requirement 5.3: Prevent multiple simultaneous transitions
  useEffect(() => {
    // Apply theme by setting data-theme attribute on document element
    if (typeof document !== 'undefined') {
      const root = document.documentElement;
      
      // Prevent multiple simultaneous transitions by temporarily disabling transitions
      // This ensures smooth theme changes without visual glitches
      if (enableTransitions) {
        // Add a class to disable transitions temporarily
        root.classList.add('theme-transitioning');
      }
      
      // Apply the theme by setting the data-theme attribute
      // This triggers CSS variable updates automatically via CSS rules
      root.setAttribute(THEME_ATTRIBUTE, themeState.resolvedTheme);
      
      // Re-enable transitions after a brief delay to allow the theme to apply
      // This ensures the theme applies within 100ms as required
      if (enableTransitions) {
        // Use requestAnimationFrame to ensure the DOM has updated
        requestAnimationFrame(() => {
          // Remove the transitioning class to re-enable transitions
          root.classList.remove('theme-transitioning');
        });
      }
    }
  }, [themeState.resolvedTheme, enableTransitions]);

  // Provide context value to children
  const contextValue = {
    theme: themeState.resolvedTheme,
    preference: themeState.preference,
    systemTheme: themeState.systemTheme,
    setTheme,
    enableTransitions,
  };

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
}
