/**
 * Lumenpulse Theme Colors
 * Light and Dark palettes aligned with brand identity.
 */

export type ThemeMode = 'system' | 'light' | 'dark';

export interface ThemeColors {
  background: string;
  surface: string;
  card: string;
  cardBorder: string;
  text: string;
  textSecondary: string;
  accent: string;
  accentSecondary: string;
  border: string;
  danger: string;
  tabBar: string;
  tabBarBorder: string;
  tabBarActive: string;
  tabBarInactive: string;
  statusBarStyle: 'light' | 'dark';
}

export const darkColors: ThemeColors = {
  background: '#0a0a0a',
  surface: '#141414',
  card: 'rgba(255, 255, 255, 0.05)',
  cardBorder: 'rgba(219, 116, 207, 0.2)',
  text: '#ffffff',
  textSecondary: 'rgba(255, 255, 255, 0.6)',
  accent: '#db74cf',
  accentSecondary: '#7a85ff',
  border: 'rgba(255, 255, 255, 0.1)',
  danger: '#ff4757',
  tabBar: '#0a0a0a',
  tabBarBorder: 'rgba(219, 116, 207, 0.2)',
  tabBarActive: '#db74cf',
  tabBarInactive: '#ffffff',
  statusBarStyle: 'light',
};

export const lightColors: ThemeColors = {
  background: '#f8f6fa',
  surface: '#ffffff',
  card: 'rgba(219, 116, 207, 0.06)',
  cardBorder: 'rgba(219, 116, 207, 0.18)',
  text: '#1a1a2e',
  textSecondary: 'rgba(26, 26, 46, 0.55)',
  accent: '#c254b5',
  accentSecondary: '#5a65e0',
  border: 'rgba(26, 26, 46, 0.1)',
  danger: '#e63946',
  tabBar: '#ffffff',
  tabBarBorder: 'rgba(219, 116, 207, 0.15)',
  tabBarActive: '#c254b5',
  tabBarInactive: '#8e8e93',
  statusBarStyle: 'dark',
};
