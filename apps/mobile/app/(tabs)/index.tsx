import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ActivityIndicator } from 'react-native';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import ProtectedRoute from '../../components/ProtectedRoute';
import { healthApi } from '../../lib/api';
import config from '../../lib/config';

export default function HomeScreen() {
  const [healthStatus, setHealthStatus] = useState<string>('Checking...');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    testApiConnection();
  }, []);

  const testApiConnection = async () => {
    console.log('🔌 Testing API connection to:', config.api.baseUrl);
    setIsLoading(true);

    const response = await healthApi.check();

    if (response.success && response.data) {
      console.log('✅ API Health Check Success:', response.data);
      setHealthStatus(`Connected to ${config.api.baseUrl}`);
    } else {
      console.log('❌ API Health Check Failed:', response.error);
      setHealthStatus(`Failed: ${response.error?.message || 'Unknown error'}`);
    }

    setIsLoading(false);
  };
import { useTheme } from '../../contexts/ThemeContext';

export default function HomeScreen() {
  const { colors } = useTheme();

  return (
    <ProtectedRoute>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ExpoStatusBar style={colors.statusBarStyle} />
        <View style={styles.content}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.text }]}>Lumenpulse Mobile</Text>
            <Text style={[styles.subtitle, { color: colors.accent }]}>
              Decentralized Crypto Insights
            </Text>
          </View>

          <View style={styles.comingSoon}>
            <View
              style={[
                styles.glassCard,
                { backgroundColor: colors.card, borderColor: colors.cardBorder },
              ]}
            >
              <Text style={[styles.cardText, { color: colors.text }]}>
                Portfolio &amp; News aggregation coming soon.
              </Text>
            </View>

            {/* API Connection Status */}
            <View style={[styles.glassCard, styles.statusCard]}>
              <Text style={styles.statusLabel}>API Status:</Text>
              {isLoading ? (
                <ActivityIndicator color="#7a85ff" style={styles.loader} />
              ) : (
                <Text style={styles.statusText}>{healthStatus}</Text>
              )}
              <TouchableOpacity
                style={styles.retryButton}
                onPress={testApiConnection}
                disabled={isLoading}
              >
                <Text style={styles.retryButtonText}>Test Connection</Text>
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.button, { backgroundColor: colors.accentSecondary, shadowColor: colors.accentSecondary }]}
          >
            <Text style={styles.buttonText}>Get Started</Text>
          </TouchableOpacity>
        </View>
      </View>
    </ProtectedRoute>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'space-between',
    paddingVertical: 60,
  },
  header: {
    marginTop: 40,
  },
  title: {
    fontSize: 42,
    fontWeight: '800',
    letterSpacing: -1,
  },
  subtitle: {
    fontSize: 18,
    marginTop: 8,
    fontWeight: '500',
  },
  comingSoon: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  glassCard: {
    padding: 24,
    borderRadius: 24,
    borderWidth: 1,
    width: '100%',
  },
  cardText: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
    opacity: 0.8,
  },
  button: {
    height: 56,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '600',
  },
  statusCard: {
    marginTop: 16,
  },
  statusLabel: {
    color: '#db74cf',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  statusText: {
    color: '#ffffff',
    fontSize: 12,
    opacity: 0.8,
    marginBottom: 12,
  },
  loader: {
    marginVertical: 12,
  },
  retryButton: {
    backgroundColor: 'rgba(122, 133, 255, 0.2)',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(122, 133, 255, 0.3)',
    alignSelf: 'center',
  },
  retryButtonText: {
    color: '#7a85ff',
    fontSize: 12,
    fontWeight: '600',
  },
});
