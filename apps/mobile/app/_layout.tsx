import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { View } from 'react-native';
import { applyPrivacyPreferences } from '../lib/privacy-preferences';
import { AuthProvider } from '../contexts/AuthContext';
import { DeepLinkProvider } from '../contexts/DeepLinkContext';
import { EnvironmentProvider } from '../contexts/EnvironmentContext';
import { WalletProvider } from '../contexts/WalletContext';
import { NotificationsProvider } from '../contexts/NotificationsContext';
import BiometricLockGuard from '../components/BiometricLockGuard';
import NetworkBadge from '../components/NetworkBadge';
import { LocalizationProvider } from '../src/context';
import { ThemeProvider } from '../contexts/ThemeContext';

export default function RootLayout() {
  // Re-apply the stored analytics/crash-reporting opt-outs on every launch, so
  // a choice made in Settings › Data & Privacy holds across sessions.
  useEffect(() => {
    void applyPrivacyPreferences();
  }, []);

  return (
    <LocalizationProvider>
      {/*
        ThemeProvider is deprecated in favor of useLocalization (see
        contexts/ThemeContext.tsx), but apps/mobile/app/(tabs)/projects/
        {_layout,index,[id]}.tsx still consume useTheme() from it directly
        and it was never mounted anywhere -- every /projects route threw
        "useTheme must be used within a ThemeProvider" unconditionally.
        Mounting it here (rather than migrating those 3 files to
        useLocalization) is the minimal fix; it's self-contained and only
        reads/writes its own AsyncStorage key.
      */}
      <ThemeProvider>
        <EnvironmentProvider>
          <BiometricLockGuard>
            <AuthProvider>
              <WalletProvider>
                <NotificationsProvider>
                  <DeepLinkProvider>
                    <View style={{ flex: 1 }}>
                      <Stack
                        screenOptions={{
                          headerShown: false,
                          // Accessibility improvements for screen readers
                          animation: 'fade',
                        }}
                      >
                        <Stack.Screen name="(tabs)" />
                        <Stack.Screen name="auth" />
                      </Stack>
                      <NetworkBadge />
                    </View>
                  </DeepLinkProvider>
                </NotificationsProvider>
              </WalletProvider>
            </AuthProvider>
          </BiometricLockGuard>
        </EnvironmentProvider>
      </ThemeProvider>
    </LocalizationProvider>
  );
}
