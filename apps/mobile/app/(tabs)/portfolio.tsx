import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';

export default function Portfolio() {
  const { isAuthenticated, isLoading } = useAuth();
  const { colors } = useTheme();
  const router = useRouter();

  if (isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  if (!isAuthenticated) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background, padding: 20 }]}>
        <Text style={[styles.message, { color: colors.text }]}>
          Please login to view your portfolio.
        </Text>
        <TouchableOpacity
          style={[styles.loginButton, { backgroundColor: colors.accentSecondary }]}
          onPress={() => router.push('/auth/login')}
        >
          <Text style={styles.loginButtonText}>Go to Login</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.center, { backgroundColor: colors.background }]}>
      <Text style={[styles.heading, { color: colors.text }]}>
        Portfolio coming soon 🚀
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  message: {
    fontSize: 18,
    marginBottom: 20,
    textAlign: 'center',
  },
  heading: {
    fontSize: 22,
    fontWeight: 'bold',
  },
  loginButton: {
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
  },
  loginButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
});