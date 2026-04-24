import { Stack } from 'expo-router';
import { AuthProvider } from '../contexts/AuthContext';
import { ThemeProvider } from '../contexts/ThemeContext';
import { NotificationsProvider } from '../contexts/NotificationsContext';
import BiometricLockGuard from '../components/BiometricLockGuard';
import ForegroundNotificationBanner from '../components/ForegroundNotificationBanner';

export default function RootLayout() {
  return (
    <ThemeProvider>
      <BiometricLockGuard>
        <AuthProvider>
          <NotificationsProvider>
            <>
              <ForegroundNotificationBanner />
              <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="auth" />
                <Stack.Screen name="notifications" />
                <Stack.Screen name="settings/notification-settings" />
              </Stack>
            </>
          </NotificationsProvider>
        </AuthProvider>
      </BiometricLockGuard>
    </ThemeProvider>
  );
}
