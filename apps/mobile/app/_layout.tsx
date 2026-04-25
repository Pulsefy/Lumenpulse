import { Stack } from 'expo-router';
import { AuthProvider } from '../contexts/AuthContext';
import { ThemeProvider } from '../contexts/ThemeContext';
import { NotificationsProvider } from '../contexts/NotificationsContext';
import BiometricLockGuard from '../components/BiometricLockGuard';

export default function RootLayout() {
  return (
    <ThemeProvider>
      <BiometricLockGuard>
        <AuthProvider>
          <NotificationsProvider>
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="auth" />
            </Stack>
          </NotificationsProvider>
        </AuthProvider>
      </BiometricLockGuard>
    </ThemeProvider>
  );
}
