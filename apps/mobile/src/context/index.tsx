import { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import i18n from '../i18n';
import { useColorScheme } from 'react-native';
import { lightTheme, darkTheme, Theme, ThemeColors } from '../theme/colors';

// Theme mode type
export type ThemeMode = 'system' | 'light' | 'dark';

interface LocalizationContextType {
  t: (key: string, params?: Record<string, any>) => string;
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
  const [themeMode, setThemeMode] = useState<ThemeMode>('system');
  const colorScheme = useColorScheme();

  const resolvedMode = themeMode === 'system' 
    ? (colorScheme === 'dark' ? 'dark' : 'light')
    : themeMode;

  const colors = resolvedMode === 'dark' ? darkTheme : lightTheme;

  const t = (key: string, params?: Record<string, any>): string => {
    return i18n.t(key, params);
  };

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng);
  };

  useEffect(() => {
    // Initialize from storage if needed
  }, []);

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
