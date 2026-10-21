import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '../../contexts/ThemeContext';
import { useLocalization } from '../../src/context';
import { sessionsApi, UserSession } from '../../lib/api';

function formatWhen(value: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString();
}

/**
 * Settings > Active Sessions.
 *
 * Lists the server-side session registry for the signed-in user and lets them
 * revoke any session. Revocation is enforced by the API immediately.
 */
export default function SessionsScreen() {
  const { colors } = useTheme();
  const { t } = useLocalization();
  const router = useRouter();
  const [sessions, setSessions] = useState<UserSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await sessionsApi.list();
    if (!response.success) {
      Alert.alert(
        t('errors.error'),
        response.error?.message ?? t('settings.sessions.load_failed'),
      );
    } else {
      setSessions(response.data?.sessions ?? []);
    }
    setLoading(false);
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const revoke = (session: UserSession) => {
    Alert.alert(t('settings.sessions.revoke_confirm'), session.deviceInfo ?? '', [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.sessions.revoke'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setBusy(true);
            const response = await sessionsApi.revoke(session.id);
            setBusy(false);
            if (!response.success) {
              Alert.alert(
                t('errors.error'),
                response.error?.message ?? t('settings.sessions.revoke_failed'),
              );
              return;
            }
            setSessions((prev) => prev.filter((s) => s.id !== session.id));
          })();
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityRole="button">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>{t('settings.sessions.title')}</Text>
      </View>
      {loading ? (
        <ActivityIndicator color={colors.accent} style={styles.loader} />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={[styles.description, { color: colors.textSecondary }]}>
            {t('settings.sessions.description')}
          </Text>
          {sessions.length === 0 ? (
            <Text style={{ color: colors.textSecondary }}>{t('settings.sessions.empty')}</Text>
          ) : (
            sessions.map((session) => (
              <View
                key={session.id}
                style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <View style={styles.cardBody}>
                  <Text style={[styles.device, { color: colors.text }]}>
                    {session.deviceInfo || t('settings.sessions.unknown_device')}
                    {session.isCurrent ? ` (${t('settings.sessions.this_device')})` : ''}
                  </Text>
                  <Text style={{ color: colors.textSecondary }}>
                    {session.locationHint || t('settings.sessions.unknown_location')}
                    {session.ipAddress ? ` - ${session.ipAddress}` : ''}
                  </Text>
                  <Text style={{ color: colors.textSecondary }}>
                    {t('settings.sessions.last_seen')}: {formatWhen(session.lastSeenAt)}
                  </Text>
                </View>
                <TouchableOpacity
                  disabled={busy}
                  onPress={() => revoke(session)}
                  accessibilityRole="button"
                  accessibilityLabel={t('settings.sessions.revoke')}
                >
                  <Ionicons name="log-out-outline" size={22} color={colors.danger} />
                </TouchableOpacity>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 16 },
  title: { fontSize: 20, fontWeight: '600' },
  loader: { marginTop: 32 },
  content: { padding: 16, gap: 12 },
  description: { marginBottom: 8 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 12,
  },
  cardBody: { flex: 1, gap: 2 },
  device: { fontSize: 16, fontWeight: '600' },
});
