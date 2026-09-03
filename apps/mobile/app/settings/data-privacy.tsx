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
import { useTheme } from '../../contexts/ThemeContext';
import { useLocalization } from '../../src/context';
import { formatBytes } from '../../lib/image-cache';
import {
  LocalDataCategoryId,
  LocalDataInventory,
  clearAllLocalData,
  clearLocalDataCategory,
  getLocalDataInventory,
} from '../../lib/local-data';
import {
  DEFAULT_PRIVACY_PREFERENCES,
  PrivacyPreferences,
  getPrivacyPreferences,
  setAnalyticsEnabled,
  setCrashReportingEnabled,
} from '../../lib/privacy-preferences';

const CATEGORY_ICONS: Record<LocalDataCategoryId, string> = {
  cached_content: 'cloud-download-outline',
  saved_news: 'bookmark-outline',
  watchlists: 'eye-outline',
  image_cache: 'images-outline',
  drafts: 'create-outline',
  diagnostics: 'pulse-outline',
};

/**
 * Settings › Data & Privacy.
 *
 * Lists every category of locally stored data with its current size, clears
 * each one behind a confirmation, and hosts the analytics and crash-reporting
 * opt-out toggles.
 *
 * Clearing never signs the user out and never discards queued offline writes —
 * see lib/local-data.ts for the protected-key rules that guarantee it. When
 * mutations are queued the screen says so explicitly before the user confirms.
 */
export default function DataPrivacyScreen() {
  const { colors } = useTheme();
  const { t } = useLocalization();
  const router = useRouter();

  const [inventory, setInventory] = useState<LocalDataInventory | null>(null);
  const [preferences, setPreferences] = useState<PrivacyPreferences>(DEFAULT_PRIVACY_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const [busyCategory, setBusyCategory] = useState<LocalDataCategoryId | 'all' | null>(null);
  const [savingPreference, setSavingPreference] = useState<'analytics' | 'crash' | null>(null);

  const loadInventory = useCallback(async () => {
    const next = await getLocalDataInventory();
    setInventory(next);
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        const [, storedPreferences] = await Promise.all([loadInventory(), getPrivacyPreferences()]);
        setPreferences(storedPreferences);
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [loadInventory]);

  const confirmAndClear = (id: LocalDataCategoryId, categoryLabel: string) => {
    Alert.alert(
      t('settings.data_privacy.clear_category_title', { category: categoryLabel }),
      t('settings.data_privacy.clear_category_message', { category: categoryLabel }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.confirm'),
          style: 'destructive',
          onPress: async () => {
            setBusyCategory(id);
            try {
              await clearLocalDataCategory(id);
              await loadInventory();
              Alert.alert(
                t('success'),
                t('settings.data_privacy.category_cleared', {
                  category: categoryLabel,
                }),
              );
            } catch {
              Alert.alert(t('errors.error'), t('settings.data_privacy.clear_failed'));
            } finally {
              setBusyCategory(null);
            }
          },
        },
      ],
    );
  };

  const confirmAndClearAll = () => {
    const queued = inventory?.queuedMutationCount ?? 0;
    const message =
      queued > 0
        ? `${t('settings.data_privacy.clear_all_message')}\n\n${t(
            'settings.data_privacy.queued_preserved_warning',
            { count: queued },
          )}`
        : t('settings.data_privacy.clear_all_message');

    Alert.alert(t('settings.data_privacy.clear_all_title'), message, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.confirm'),
        style: 'destructive',
        onPress: async () => {
          setBusyCategory('all');
          try {
            const result = await clearAllLocalData();
            await loadInventory();

            if (result.failed.length > 0) {
              Alert.alert(
                t('errors.error'),
                t('settings.data_privacy.clear_all_partial', {
                  count: result.failed.length,
                }),
              );
              return;
            }

            Alert.alert(t('success'), t('settings.data_privacy.clear_all_success'));
          } catch {
            Alert.alert(t('errors.error'), t('settings.data_privacy.clear_failed'));
          } finally {
            setBusyCategory(null);
          }
        },
      },
    ]);
  };

  const handleAnalyticsToggle = async (nextValue: boolean) => {
    if (savingPreference) return;
    setSavingPreference('analytics');
    try {
      setPreferences(await setAnalyticsEnabled(nextValue));
    } catch {
      Alert.alert(t('errors.error'), t('settings.data_privacy.preference_save_failed'));
    } finally {
      setSavingPreference(null);
    }
  };

  const handleCrashReportingToggle = async (nextValue: boolean) => {
    if (savingPreference) return;
    setSavingPreference('crash');
    try {
      setPreferences(await setCrashReportingEnabled(nextValue));
    } catch {
      Alert.alert(t('errors.error'), t('settings.data_privacy.preference_save_failed'));
    } finally {
      setSavingPreference(null);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text
          style={[styles.headerTitle, { color: colors.text }]}
          accessible
          accessibilityRole="header"
        >
          {t('settings.data_privacy.title')}
        </Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
        <Text style={[styles.intro, { color: colors.textSecondary }]} accessible>
          {t('settings.data_privacy.description')}
        </Text>

        {/* ── Stored data ──────────────────────────────────────────────── */}
        <Text
          style={[styles.sectionTitle, { color: colors.text }]}
          accessible
          accessibilityRole="header"
        >
          {t('settings.data_privacy.stored_data')}
        </Text>

        {loading ? (
          <ActivityIndicator
            style={styles.loader}
            color={colors.accent}
            accessibilityLabel={t('common.loading')}
          />
        ) : (
          <>
            {inventory?.categories.map((category) => {
              const label = t(`settings.data_privacy.categories.${category.id}.title`);
              const isEmpty = category.bytes === 0;
              const isBusy = busyCategory === category.id;

              return (
                <View
                  key={category.id}
                  style={[
                    styles.categoryRow,
                    { backgroundColor: colors.surface, borderColor: colors.cardBorder },
                  ]}
                  accessible
                  accessibilityLabel={`${label}: ${formatBytes(category.bytes)}`}
                >
                  <View style={[styles.categoryIcon, { backgroundColor: colors.card }]}>
                    <Ionicons
                      name={CATEGORY_ICONS[category.id] as any}
                      size={20}
                      color={colors.accent}
                    />
                  </View>

                  <View style={styles.categoryCopy}>
                    <Text style={[styles.categoryTitle, { color: colors.text }]} accessible>
                      {label}
                    </Text>
                    <Text style={[styles.categoryMeta, { color: colors.textSecondary }]} accessible>
                      {t(`settings.data_privacy.categories.${category.id}.description`)}
                    </Text>
                    <Text style={[styles.categorySize, { color: colors.accent }]} accessible>
                      {formatBytes(category.bytes)}
                      {category.entryCount > 0
                        ? ` · ${t('settings.data_privacy.item_count', {
                            count: category.entryCount,
                          })}`
                        : ''}
                    </Text>
                  </View>

                  {isBusy ? (
                    <ActivityIndicator color={colors.accent} />
                  ) : (
                    <TouchableOpacity
                      style={[
                        styles.clearButton,
                        {
                          borderColor: isEmpty ? colors.cardBorder : colors.danger,
                          opacity: isEmpty ? 0.4 : 1,
                        },
                      ]}
                      onPress={() => confirmAndClear(category.id, label)}
                      disabled={isEmpty || busyCategory !== null}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: isEmpty || busyCategory !== null }}
                      accessibilityLabel={t('settings.data_privacy.clear_category_title', {
                        category: label,
                      })}
                    >
                      <Text
                        style={[
                          styles.clearButtonText,
                          { color: isEmpty ? colors.textSecondary : colors.danger },
                        ]}
                      >
                        {t('settings.data_privacy.clear')}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}

            <View style={[styles.totalRow, { borderColor: colors.border }]}>
              <Text style={[styles.totalLabel, { color: colors.textSecondary }]} accessible>
                {t('settings.data_privacy.total_stored')}
              </Text>
              <Text style={[styles.totalValue, { color: colors.text }]} accessible>
                {formatBytes(inventory?.totalBytes ?? 0)}
              </Text>
            </View>

            {(inventory?.queuedMutationCount ?? 0) > 0 && (
              <View
                style={[
                  styles.noticeBox,
                  { backgroundColor: colors.surface, borderColor: colors.warning },
                ]}
                accessible
                accessibilityLabel={t('settings.data_privacy.queued_preserved_warning', {
                  count: inventory?.queuedMutationCount ?? 0,
                })}
              >
                <Ionicons name="sync-outline" size={18} color={colors.warning} />
                <Text style={[styles.noticeText, { color: colors.textSecondary }]}>
                  {t('settings.data_privacy.queued_preserved_warning', {
                    count: inventory?.queuedMutationCount ?? 0,
                  })}
                </Text>
              </View>
            )}

            <TouchableOpacity
              style={[
                styles.clearAllButton,
                {
                  backgroundColor: colors.danger,
                  opacity: busyCategory !== null ? 0.6 : 1,
                },
              ]}
              onPress={confirmAndClearAll}
              disabled={busyCategory !== null}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={t('settings.data_privacy.clear_all_title')}
              accessibilityHint={t('settings.data_privacy.clear_all_hint')}
            >
              {busyCategory === 'all' ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <>
                  <Ionicons
                    name="trash-outline"
                    size={18}
                    color="#ffffff"
                    style={{ marginRight: 8 }}
                  />
                  <Text style={styles.clearAllButtonText} accessible>
                    {t('settings.data_privacy.clear_all_title')}
                  </Text>
                </>
              )}
            </TouchableOpacity>

            <Text style={[styles.footnote, { color: colors.textSecondary }]} accessible>
              {t('settings.data_privacy.clear_all_hint')}
            </Text>
          </>
        )}

        {/* ── Privacy controls ─────────────────────────────────────────── */}
        <Text
          style={[styles.sectionTitle, { color: colors.text }]}
          accessible
          accessibilityRole="header"
        >
          {t('settings.data_privacy.privacy_controls')}
        </Text>

        <View
          style={[
            styles.preferenceCard,
            { backgroundColor: colors.surface, borderColor: colors.cardBorder },
          ]}
        >
          <View style={styles.preferenceRow}>
            <View style={styles.preferenceCopy}>
              <Text style={[styles.categoryTitle, { color: colors.text }]} accessible>
                {t('settings.data_privacy.analytics.title')}
              </Text>
              <Text style={[styles.categoryMeta, { color: colors.textSecondary }]} accessible>
                {t('settings.data_privacy.analytics.description')}
              </Text>
            </View>

            {savingPreference === 'analytics' ? (
              <ActivityIndicator color={colors.accent} />
            ) : (
              <Switch
                value={preferences.analyticsEnabled}
                onValueChange={handleAnalyticsToggle}
                trackColor={{ false: colors.cardBorder, true: colors.accent }}
                thumbColor="#ffffff"
                accessibilityRole="switch"
                accessibilityLabel={t('settings.data_privacy.analytics.title')}
              />
            )}
          </View>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <View style={styles.preferenceRow}>
            <View style={styles.preferenceCopy}>
              <Text style={[styles.categoryTitle, { color: colors.text }]} accessible>
                {t('settings.data_privacy.crash_reporting.title')}
              </Text>
              <Text style={[styles.categoryMeta, { color: colors.textSecondary }]} accessible>
                {t('settings.data_privacy.crash_reporting.description')}
              </Text>
            </View>

            {savingPreference === 'crash' ? (
              <ActivityIndicator color={colors.accent} />
            ) : (
              <Switch
                value={preferences.crashReportingEnabled}
                onValueChange={handleCrashReportingToggle}
                trackColor={{ false: colors.cardBorder, true: colors.accent }}
                thumbColor="#ffffff"
                accessibilityRole="switch"
                accessibilityLabel={t('settings.data_privacy.crash_reporting.title')}
              />
            )}
          </View>
        </View>

        <Text style={[styles.footnote, { color: colors.textSecondary }]} accessible>
          {t('settings.data_privacy.preferences_survive_clear')}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 18, fontWeight: '600' },
  content: { flex: 1 },
  contentInner: { padding: 16, paddingBottom: 48 },
  intro: { fontSize: 14, lineHeight: 20, marginBottom: 20 },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginTop: 12,
    marginBottom: 12,
  },
  loader: { marginVertical: 24 },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  categoryIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryCopy: { flex: 1 },
  categoryTitle: { fontSize: 15, fontWeight: '600', marginBottom: 2 },
  categoryMeta: { fontSize: 12, lineHeight: 17, marginBottom: 4 },
  categorySize: { fontSize: 13, fontWeight: '600' },
  clearButton: {
    minHeight: 36,
    paddingHorizontal: 12,
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
  },
  clearButtonText: { fontSize: 13, fontWeight: '600' },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    marginTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  totalLabel: { fontSize: 14 },
  totalValue: { fontSize: 15, fontWeight: '700' },
  noticeBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
  },
  noticeText: { flex: 1, fontSize: 13, lineHeight: 18 },
  clearAllButton: {
    flexDirection: 'row',
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  clearAllButtonText: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
  footnote: { fontSize: 12, lineHeight: 17, marginTop: 10 },
  preferenceCard: { borderRadius: 12, borderWidth: 1, padding: 14 },
  preferenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  preferenceCopy: { flex: 1 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 14 },
});
