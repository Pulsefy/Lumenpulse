import React, { ReactNode } from 'react';

/**
 * Legacy entry point. Theme state lives in LocalizationProvider
 * (src/context), driven by the tokens in theme/tokens.ts. This module used to
 * hold a second, divergent palette and its own provider; it now re-exports the
 * single source so existing `useTheme()` imports keep working.
 */
export { useTheme } from '../src/context';
export type { ThemeMode, ThemeColors } from '../theme/tokens';
export { lightColors as lightTheme, darkColors as darkTheme } from '../theme/tokens';

/** No-op kept so older trees that mount <ThemeProvider> still render. */
export const ThemeProvider: React.FC<{ children: ReactNode }> = ({ children }) => <>{children}</>;
