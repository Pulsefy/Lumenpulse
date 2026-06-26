import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { NotificationPreferences, usersApi } from '../../lib/api';
import { useTheme } from '../../contexts/ThemeContext';
import { useLocalization } from '../../src/context';

const DEFAULT_PREFERENCES: NotificationPreferences = {
  priceAlerts: true,
  newsAlerts: true,
  securityAlerts: true,
};

interface NotificationRow {
  key: keyof NotificationPreferences;
  title: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
}

export default function NotificationSettingsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useLocalization();
  const [preferences, setPreferences] = useState<NotificationPreferences>(DEFAULT_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<keyof NotificationPreferences | null>(null);

  const NOTIFICATION_ROWS: NotificationRow[] = [
    {
      key: 'priceAlerts',
      title: t('settings.notification_settings.price_alerts'),
      description: t('settings.notification_settings.price_alerts_desc'),
      icon: 'pulse-outline',
    },
    {
      key: 'newsAlerts',
      title: t('settings.notification_settings.news_alerts'),
      description: t('settings.notification_settings.news_alerts_desc'),
      icon: 'newspaper-outline',
    },
    {
      key: 'securityAlerts',
      title: t('settings.notification_settings.security_alerts'),
      description: t('settings.notification_settings.security_alerts_desc'),
      icon: 'shield-checkmark-outline',
    },
  ];

  const loadPreferences = useCallback(async () => {
    const response = await usersApi.getProfile();
    if (!response.success) {
      Alert.alert(
        t('errors.error'),
        response.error?.message ?? t('errors.couldnt_load', { item: 'preferences' }),
      );
      return;
    }

    setPreferences({
      ...DEFAULT_PREFERENCES,
      ...(response.data?.preferences?.notifications ?? {}),
    });
  }, [t]);

  useEffect(() => {
    const bootstrap = async () => {
      setLoading(true);
      await loadPreferences();
      setLoading(false);
    };

    bootstrap();
  }, [loadPreferences]);

  const handleToggle = async (key: keyof NotificationPreferences, nextValue: boolean) => {
    const previous = preferences;
    const nextPreferences = { ...preferences, [key]: nextValue };

    setPreferences(nextPreferences);
    setSavingKey(key);

    const response = await usersApi.updateProfile({
      preferences: {
        notifications: nextPreferences,
      },
    });

    setSavingKey(null);

    if (!response.success) {
      setPreferences(previous);
      Alert.alert(
        t('errors.error'),
        response.error?.message ?? t('errors.could_not_update', { item: 'preferences' }),
      );
      return;
    }

    setPreferences({
      ...DEFAULT_PREFERENCES,
      ...(response.data?.preferences?.notifications ?? nextPreferences),
    });
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <TouchableOpacity
            style={[styles.headerButton, { backgroundColor: colors.card }]}
            onPress={() => router.back()}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
            accessibilityHint="Go back to previous screen"
          >
            <Ionicons name="arrow-back" size={20} color={colors.text} />
          </TouchableOpacity>
          <View style={styles.headerCopy}>
            <Text style={[styles.title, { color: colors.text }]} accessible accessibilityRole="header">
              {t('settings.notification_settings.title')}
            </Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]} accessible>
              {t('settings.notification_settings.description')}
            </Text>
          </View>
        </View>

        <View
          style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
          accessible
          accessibilityLabel={t('settings.notification_settings.title')}
        >
          {loading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={colors.accent} accessibilityLabel={t('common.loading')} />
            </View>
          ) : (
            NOTIFICATION_ROWS.map((row, index) => (
              <View key={row.key}>
                {index > 0 && (
                  <View style={[styles.divider, { backgroundColor: colors.border }]} accessible={false} />
                )}
                <View style={styles.preferenceRow}>
                  <View style={styles.preferenceCopy}>
                    <View style={[styles.iconShell, { backgroundColor: colors.card }]} accessible>
                      <Ionicons name={row.icon} size={18} color={colors.accent} />
                    </View>
                    <View style={styles.preferenceTextWrap}>
                      <Text style={[styles.preferenceTitle, { color: colors.text }]} accessible>
                        {row.title}
                      </Text>
                      <Text style={[styles.preferenceDescription, { color: colors.textSecondary }]} accessible>
                        {row.description}
                      </Text>
                    </View>
                  </View>

                  <Switch
                    value={preferences[row.key]}
                    onValueChange={(value) => void handleToggle(row.key, value)}
                    trackColor={{
                      false: colors.cardBorder,
                      true: colors.accent,
                    }}
                    thumbColor="#ffffff"
                    accessibilityLabel={row.title}
                    accessibilityRole="switch"
                    accessibilityState={{ checked: preferences[row.key] }}
                  />
                </View>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 24,
    paddingBottom: 40,
    gap: 16,
  },
  header: {
    flexDirection: 'row',
    gap: 16,
    alignItems: 'flex-start',
  },
  headerButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCopy: {
    flex: 1,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
  },
  card: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 18,
  },
  loadingWrap: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 16,
  },
  preferenceRow: {
    flexDirection: 'row',
    gap: 14,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  preferenceCopy: {
    flex: 1,
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  iconShell: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  preferenceTextWrap: {
    flex: 1,
  },
  preferenceTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
  },
  preferenceDescription: {
    fontSize: 13,
    lineHeight: 18,
  },
});
