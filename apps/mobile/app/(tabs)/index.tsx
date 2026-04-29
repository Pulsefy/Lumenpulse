import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ActivityIndicator } from 'react-native';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import ProtectedRoute from '../../components/ProtectedRoute';
import { healthApi } from '../../lib/api';
import { config } from '../../lib/config';
import { useRouter } from 'expo-router';
import { useLocalization } from '../../src/context';
import { Ionicons } from '@expo/vector-icons';
import { useNotifications } from '../../contexts/NotificationsContext';

export default function HomeScreen() {
  const router = useRouter();
  const { colors } = useLocalization();
  const { t } = useLocalization();
  const { unreadCount } = useNotifications();
  const [healthStatus, setHealthStatus] = useState<string>(t('common.loading'));
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    testApiConnection();
  }, []);

  const testApiConnection = async () => {
    setIsLoading(true);
    const response = await healthApi.check();
    if (response.success && response.data) {
      setHealthStatus(`${t('home.connected_to')} ${config.api.baseUrl}`);
    } else {
      setHealthStatus(`${t('home.failed')}: ${response.error?.message || t('errors.something_went_wrong')}`);
    }
    setIsLoading(false);
  };

  return (
    <ProtectedRoute>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ExpoStatusBar style={colors.statusBarStyle} />
        <View style={styles.content}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.text }]} accessible accessibilityRole="header">
              Lumenpulse Mobile
            </Text>
            <Text style={[styles.subtitle, { color: colors.accent }]} accessible>
              Decentralized Crypto Insights
            </Text>

            <TouchableOpacity
              style={styles.bellButton}
              onPress={() => router.push('/notifications')}
              accessibilityLabel={
                unreadCount > 0
                  ? `${t('notifications.title')}, ${unreadCount} ${t('notifications.title')}`
                  : t('notifications.title')
              }
              accessibilityState={{ unread: unreadCount > 0 }}
              accessibilityRole="button"
            >
              <Ionicons name="notifications-outline" size={28} color={colors.accent} />
              {unreadCount > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.comingSoon}>
            <View
              style={[
                styles.glassCard,
                { backgroundColor: colors.card, borderColor: colors.cardBorder },
              ]}
            >
              <Text style={[styles.cardText, { color: colors.text }]} accessible>
                {t('home.coming_soon')}
              </Text>
            </View>

            <View style={[styles.glassCard, styles.statusCard]}>
              <Text style={styles.statusLabel} accessible>
                {t('home.api_status')}
              </Text>
              {isLoading ? (
                <ActivityIndicator color="#7a85ff" style={styles.loader} accessibilityLabel={t('common.loading')} />
              ) : (
                <Text style={styles.statusText} accessible>
                  {healthStatus}
                </Text>
              )}
              <TouchableOpacity
                style={styles.retryButton}
                onPress={testApiConnection}
                disabled={isLoading}
                accessibilityRole="button"
                accessibilityLabel={t('common.retry')}
                accessibilityHint={t('home.test_connection')}
              >
                <Text style={styles.retryButtonText} accessible>{t('home.test_connection')}</Text>
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity
            style={[
              styles.button,
              { backgroundColor: colors.accentSecondary, shadowColor: colors.accentSecondary },
            ]}
            accessibilityRole="button"
            accessibilityLabel={t('home.get_started')}
            accessibilityHint="Navigate to main features"
          >
            <Text style={styles.buttonText} accessible>{t('home.get_started')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </ProtectedRoute>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'space-between',
    paddingVertical: 60,
  },
  header: { marginTop: 40 },
  title: { fontSize: 42, fontWeight: '800', letterSpacing: -1 },
  subtitle: { fontSize: 18, marginTop: 8, fontWeight: '500' },
  bellButton: { position: 'absolute', right: 0, top: 0, padding: 4 },
  badge: {
    position: 'absolute',
    top: 0,
    right: 0,
    backgroundColor: '#ff4757',
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  badgeText: { color: '#ffffff', fontSize: 10, fontWeight: '700', lineHeight: 13 },
  comingSoon: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  glassCard: { padding: 24, borderRadius: 24, borderWidth: 1, width: '100%' },
  cardText: { fontSize: 16, textAlign: 'center', lineHeight: 24, opacity: 0.8 },
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
  buttonText: { color: '#ffffff', fontSize: 18, fontWeight: '600' },
  statusCard: { marginTop: 16 },
  statusLabel: { color: '#db74cf', fontSize: 14, fontWeight: '600', marginBottom: 8 },
  statusText: { color: '#ffffff', fontSize: 12, opacity: 0.8, marginBottom: 12 },
  loader: { marginVertical: 12 },
  retryButton: {
    backgroundColor: 'rgba(122, 133, 255, 0.2)',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(122, 133, 255, 0.3)',
    alignSelf: 'center',
  },
  retryButtonText: { color: '#7a85ff', fontSize: 12, fontWeight: '600' },
});
