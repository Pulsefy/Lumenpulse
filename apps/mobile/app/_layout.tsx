import { Stack } from 'expo-router';
import { AuthProvider } from '../contexts/AuthContext';
import { NotificationsProvider } from '../contexts/NotificationsContext';
import BiometricLockGuard from '../components/BiometricLockGuard';
import { LocalizationProvider } from '../src/context';

export default function RootLayout() {
  return (
    <LocalizationProvider>
      <BiometricLockGuard>
        <AuthProvider>
          <NotificationsProvider>
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
          </NotificationsProvider>
        </AuthProvider>
      </BiometricLockGuard>
    </LocalizationProvider>
  );
}
