"use client";

import { createContext, useContext } from 'react';
import { ThemeContextValue } from '@/types/theme';

/**
 * ThemeContext provides theme state and actions to all components
 * 
 * This context should be consumed via the useTheme hook, which includes
 * proper error handling for usage outside of ThemeProvider.
 * 
 * Requirements: 6.1, 6.2, 6.3, 6.4
 */
export const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

/**
 * Hook to access theme context
 * 
 * This hook provides access to the current theme state and actions.
 * It must be used within a ThemeProvider component.
 * 
 * @throws {Error} If used outside of ThemeProvider
 * @returns {ThemeContextValue} The current theme context value
 * 
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { theme, preference, setTheme } = useTheme();
 *   
 *   return (
 *     <button onClick={() => setTheme('dark')}>
 *       Current theme: {theme}
 *     </button>
 *   );
 * }
 * ```
 * 
 * Requirements: 6.1, 6.2, 6.3, 6.4
 */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  
  if (context === undefined) {
    throw new Error(
      'useTheme must be used within a ThemeProvider. ' +
      'Wrap your component tree with <ThemeProvider> to use theme functionality.'
    );
  }
  
  return context;
}
