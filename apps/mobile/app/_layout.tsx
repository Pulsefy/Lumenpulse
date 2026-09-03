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

export default function RootLayout() {
  // Re-apply the stored analytics/crash-reporting opt-outs on every launch, so
  // a choice made in Settings › Data & Privacy holds across sessions.
  useEffect(() => {
    void applyPrivacyPreferences();
  }, []);

  return (
    <LocalizationProvider>
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
    </LocalizationProvider>
  );
}
