import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
    ThemeMode,
    ThemeColors,
    darkColors,
    lightColors,
} from '../theme/colors';

const THEME_STORAGE_KEY = 'theme_mode';

interface ThemeContextType {
    colors: ThemeColors;
    mode: ThemeMode;
    resolvedMode: 'light' | 'dark';
    setMode: (mode: ThemeMode) => void;
    isLoaded: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

interface ThemeProviderProps {
    children: ReactNode;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
    const systemScheme = useColorScheme();
    const [mode, setModeState] = useState<ThemeMode>('system');
    const [isLoaded, setIsLoaded] = useState(false);

    // Load saved preference on mount
    useEffect(() => {
        (async () => {
            try {
                const saved = await AsyncStorage.getItem(THEME_STORAGE_KEY);
                if (saved === 'light' || saved === 'dark' || saved === 'system') {
                    setModeState(saved);
                }
            } catch (error) {
                console.error('Error loading theme preference:', error);
            } finally {
                setIsLoaded(true);
            }
        })();
    }, []);

    const setMode = (newMode: ThemeMode) => {
        setModeState(newMode);
        AsyncStorage.setItem(THEME_STORAGE_KEY, newMode).catch((error) =>
            console.error('Error saving theme preference:', error),
        );
    };

    // Resolve 'system' to actual light/dark
    const resolvedMode: 'light' | 'dark' =
        mode === 'system' ? (systemScheme === 'light' ? 'light' : 'dark') : mode;

    const colors = resolvedMode === 'light' ? lightColors : darkColors;

    return (
        <ThemeContext.Provider value={{ colors, mode, resolvedMode, setMode, isLoaded }}>
            {children}
        </ThemeContext.Provider>
    );
};

export const useTheme = (): ThemeContextType => {
    const context = useContext(ThemeContext);
    if (context === undefined) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
};
