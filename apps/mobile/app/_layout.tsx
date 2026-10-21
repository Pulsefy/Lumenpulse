import '../lib/startup-metrics-bootstrap';
import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { View } from 'react-native';
import { DataPreloader } from '../components/DataPreloader';
import { StartupInteractiveGate } from '../components/StartupInteractiveGate';
import { applyPrivacyPreferences } from '../lib/privacy-preferences';
import { syncBackgroundRefreshRegistration } from '../lib/background-refresh';
import { OfflineIndicator } from '../lib/offline-indicator';
import { mutationQueue, startMutationQueueReplayOnReconnect } from '../lib/mutation-queue';
import { replaySavedSearchMutation } from '../lib/saved-searches';
import { startModerationDecisionSync } from '../lib/moderation-decisions';
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

  // Keep the OS background-refresh task in step with the user's choice in
  // Settings › Data & Privacy (and with OS-level restrictions).
  useEffect(() => {
    void syncBackgroundRefreshRegistration();
  }, []);

  // Replay queued offline mutations whenever connectivity returns. The queue
  // records replay failures and conflicts instead of dropping them, and the
  // mounted OfflineIndicator links the user to the review screen.
  useEffect(() => {
    mutationQueue.setReplayer(replaySavedSearchMutation);
    const stopReplay = startMutationQueueReplayOnReconnect();
    return () => {
      stopReplay();
      mutationQueue.setReplayer(null);
    };
  }, []);

  // Moderation decisions replay through their own narrow handler so the shared
  // queue executor never has to understand report updates.
  useEffect(() => startModerationDecisionSync(), []);

  return (
    // LocalizationProvider owns theme state too; contexts/ThemeContext's
    // useTheme() reads from it, so every screen shares one palette.
    <LocalizationProvider>
      <EnvironmentProvider>
          <BiometricLockGuard>
            <AuthProvider>
              <DataPreloader />
              <WalletProvider>
                <NotificationsProvider>
                  <DeepLinkProvider>
                    <StartupInteractiveGate>
                    <View style={{ flex: 1 }}>
                      <OfflineIndicator />
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
                    </StartupInteractiveGate>
                  </DeepLinkProvider>
                </NotificationsProvider>
              </WalletProvider>
            </AuthProvider>
          </BiometricLockGuard>
        </EnvironmentProvider>
    </LocalizationProvider>
  );
}
