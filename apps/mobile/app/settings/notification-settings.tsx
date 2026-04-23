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

const DEFAULT_PREFERENCES: NotificationPreferences = {
  priceAlerts: true,
  newsAlerts: true,
  securityAlerts: true,
};

const NOTIFICATION_ROWS: {
  key: keyof NotificationPreferences;
  title: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  {
    key: 'priceAlerts',
    title: 'Price Alerts',
    description: 'Immediate notifications when tracked market prices change meaningfully.',
    icon: 'pulse-outline',
  },
  {
    key: 'newsAlerts',
    title: 'News Alerts',
    description: 'Breaking ecosystem and market headlines relevant to your portfolio.',
    icon: 'newspaper-outline',
  },
  {
    key: 'securityAlerts',
    title: 'Security Alerts',
    description: 'Critical account, phishing, and suspicious-activity notices.',
    icon: 'shield-checkmark-outline',
  },
];

export default function NotificationSettingsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const [preferences, setPreferences] = useState<NotificationPreferences>(DEFAULT_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<keyof NotificationPreferences | null>(null);

  const loadPreferences = useCallback(async () => {
    const response = await usersApi.getProfile();
    if (!response.success) {
      Alert.alert(
        'Could not load preferences',
        response.error?.message ?? 'Try again in a moment.',
      );
      return;
    }

    setPreferences({
      ...DEFAULT_PREFERENCES,
      ...(response.data?.preferences?.notifications ?? {}),
    });
  }, []);

  useEffect(() => {
    const bootstrap = async () => {
      setLoading(true);
      await loadPreferences();
      setLoading(false);
    };

    void bootstrap();
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
        'Could not update preferences',
        response.error?.message ?? 'Your notification settings could not be saved.',
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
          >
            <Ionicons name="arrow-back" size={20} color={colors.text} />
          </TouchableOpacity>
          <View style={styles.headerCopy}>
            <Text style={[styles.title, { color: colors.text }]}>Notification Settings</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              Toggle the specific alerts you want. Each change is pushed to the backend immediately.
            </Text>
          </View>
        </View>

        <View
          style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          {loading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : (
            NOTIFICATION_ROWS.map((row, index) => (
              <View key={row.key}>
                {index > 0 && <View style={[styles.divider, { backgroundColor: colors.border }]} />}
                <View style={styles.preferenceRow}>
                  <View style={styles.preferenceCopy}>
                    <View style={[styles.iconShell, { backgroundColor: colors.card }]}>
                      <Ionicons name={row.icon} size={18} color={colors.accent} />
                    </View>
                    <View style={styles.preferenceTextWrap}>
                      <Text style={[styles.preferenceTitle, { color: colors.text }]}>
                        {row.title}
                      </Text>
                      <Text style={[styles.preferenceDescription, { color: colors.textSecondary }]}>
                        {row.description}
                      </Text>
                    </View>
                  </View>

                  {savingKey === row.key ? (
                    <ActivityIndicator color={colors.accent} />
                  ) : (
                    <Switch
                      value={preferences[row.key]}
                      onValueChange={(value) => void handleToggle(row.key, value)}
                      trackColor={{
                        false: colors.cardBorder,
                        true: colors.accent,
                      }}
                      thumbColor="#ffffff"
                    />
                  )}
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
