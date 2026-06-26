import React, { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// This context is now deprecated - use useLocalization from src/context instead
// Kept for backward compatibility

export type ThemeMode = 'system' | 'light' | 'dark';

export interface ThemeColors {
  background: string;
  text: string;
  textSecondary: string;
  accent: string;
  accentSecondary: string;
  surface: string;
  card: string;
  cardBorder: string;
  border: string;
  danger: string;
  success: string;
  warning: string;
  tabBar: string;
  tabBarActive: string;
  tabBarInactive: string;
  tabBarBorder: string;
  statusBarStyle: 'light-content' | 'dark-content';
}

interface ThemeContextType {
  colors: ThemeColors;
  resolvedMode: 'light' | 'dark';
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

export const lightTheme: ThemeColors = {
  background: '#f5f5f7',
  text: '#1d1d1f',
  textSecondary: '#86868b',
  accent: '#7a85ff',
  accentSecondary: '#db74cf',
  surface: '#ffffff',
  card: '#ffffff',
  cardBorder: 'rgba(0, 0, 0, 0.08)',
  border: 'rgba(0, 0, 0, 0.1)',
  danger: '#ff3b30',
  success: '#34c759',
  warning: '#ff9500',
  tabBar: '#ffffff',
  tabBarActive: '#7a85ff',
  tabBarInactive: '#8e8e93',
  tabBarBorder: 'rgba(0, 0, 0, 0.1)',
  statusBarStyle: 'dark-content',
};

export const darkTheme: ThemeColors = {
  background: '#0a0a0a',
  text: '#ffffff',
  textSecondary: '#8e8e93',
  accent: '#7a85ff',
  accentSecondary: '#db74cf',
  surface: '#1c1c1e',
  card: '#2c2c2e',
  cardBorder: 'rgba(255, 255, 255, 0.1)',
  border: 'rgba(255, 255, 255, 0.15)',
  danger: '#ff453a',
  success: '#30d158',
  warning: '#ff9f0a',
  tabBar: '#1c1c1e',
  tabBarActive: '#7a85ff',
  tabBarInactive: '#48484a',
  tabBarBorder: 'rgba(255, 255, 255, 0.15)',
  statusBarStyle: 'light-content',
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [mode, setMode] = useState<ThemeMode>('system');
  const [resolvedMode, setResolvedMode] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const loadTheme = async () => {
      try {
        const savedMode = await AsyncStorage.getItem('@theme_mode');
        if (savedMode && ['system', 'light', 'dark'].includes(savedMode)) {
          setMode(savedMode as ThemeMode);
        }
      } catch (e) {
        console.error('Failed to load theme preference', e);
      }
    };
    loadTheme();
  }, []);

  useEffect(() => {
    const updateResolvedMode = () => {
      if (mode === 'system') {
        const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        setResolvedMode(isDark ? 'dark' : 'light');
      } else {
        setResolvedMode(mode);
      }
    };
    updateResolvedMode();
  }, [mode]);

  const colors = resolvedMode === 'dark' ? darkTheme : lightTheme;

  const setModeAndSave = async (newMode: ThemeMode) => {
    try {
      await AsyncStorage.setItem('@theme_mode', newMode);
      setMode(newMode);
    } catch (e) {
      console.error('Failed to save theme preference', e);
    }
  };

  return (
    <ThemeContext.Provider value={{ colors, resolvedMode, mode, setMode: setModeAndSave }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    console.warn('useTheme is deprecated. Please use useLocalization from src/context instead.');
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
