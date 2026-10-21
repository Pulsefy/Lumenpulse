import { createContext, useContext, useState, ReactNode, useEffect, useCallback } from 'react';
import i18n from '../i18n';
import { useColorScheme } from 'react-native';
import { themes, ThemeColors, ThemeMode } from '../../theme/tokens';
import {
  DEFAULT_THEME_MODE,
  readThemeMode,
  resolveTheme,
  saveThemeMode,
} from '../../lib/theme-preference';

export type { ThemeMode, ThemeColors };

interface LocalizationContextType {
  t: (key: string, paramsOrFallback?: Record<string, any> | string) => string;
  i18n: typeof i18n;
  currentLanguage: string;
  changeLanguage: (lng: string) => void;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  colors: ThemeColors;
  resolvedMode: 'light' | 'dark';
}

const LocalizationContext = createContext<LocalizationContextType | undefined>(undefined);

export const useLocalization = () => {
  const context = useContext(LocalizationContext);
  if (context === undefined) {
    throw new Error('useLocalization must be used within a LocalizationProvider');
  }
  return context;
};

// Combined with theme context for backward compatibility
export const useTheme = () => {
  const context = useContext(LocalizationContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a LocalizationProvider');
  }
  return {
    colors: context.colors,
    resolvedMode: context.resolvedMode,
    mode: context.themeMode,
    setMode: context.setThemeMode,
  };
};

interface LocalizationProviderProps {
  children: ReactNode;
}

export const LocalizationProvider: React.FC<LocalizationProviderProps> = ({ children }) => {
  const [themeMode, setThemeModeState] = useState<ThemeMode>(DEFAULT_THEME_MODE);
  // useColorScheme re-renders on OS appearance changes, so 'system' follows live.
  const colorScheme = useColorScheme();

  const resolvedMode = resolveTheme(themeMode, colorScheme);
  const colors = themes[resolvedMode];

  useEffect(() => {
    let cancelled = false;
    void readThemeMode().then((saved) => {
      if (saved && !cancelled) setThemeModeState(saved);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setThemeMode = useCallback((mode: ThemeMode) => {
    setThemeModeState(mode);
    void saveThemeMode(mode);
  }, []);

  const t = (key: string, paramsOrFallback?: Record<string, any> | string): string => {
    if (typeof paramsOrFallback === 'string') {
      return i18n.t(key, { defaultValue: paramsOrFallback });
    }

    return i18n.t(key, paramsOrFallback);
  };

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng);
  };

  return (
    <LocalizationContext.Provider
      value={{
        t,
        i18n,
        currentLanguage: i18n.language,
        changeLanguage,
        themeMode,
        setThemeMode,
        colors,
        resolvedMode,
      }}
    >
      {children}
    </LocalizationContext.Provider>
  );
};
