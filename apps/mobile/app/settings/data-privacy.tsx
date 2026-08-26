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
import { useLocalization } from '../../src/context';
import { useWatchlist } from '../../contexts/WatchlistContext';
import { storage } from '../../lib/storage';
import {
  type CategorySize,
  type DataCategory,
  clearAll,
  clearApiCache,
  clearContributionDrafts,
  clearSavedNews,
  clearWatchlist,
  formatBytes,
  getAnalyticsOptOut,
  getAllCategorySizes,
  getCrashReportingOptOut,
  setAnalyticsOptOut,
  setCrashReportingOptOut,
} from '../../lib/data-privacy';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map a DataCategory to its i18n label key. */
function categoryLabelKey(category: DataCategory): string {
  return `settings.data_privacy.categories.${category}`;
}

/** Map a DataCategory to the Ionicons icon name to display. */
function categoryIcon(category: DataCategory): string {
  switch (category) {
    case 'api_cache':
      return 'server-outline';
    case 'saved_news':
      return 'newspaper-outline';
    case 'watchlist':
      return 'eye-outline';
    case 'contribution_drafts':
      return 'document-text-outline';
    case 'analytics':
      return 'bar-chart-outline';
    default:
      return 'folder-outline';
  }
}

/** Categories that can be individually cleared. Analytics is opt-out only. */
const CLEARABLE_CATEGORIES: DataCategory[] = [
  'api_cache',
  'saved_news',
  'watchlist',
  'contribution_drafts',
];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface CategoryRowProps {
  size: CategorySize;
  onClear: () => void;
  clearing: boolean;
  colors: ReturnType<typeof useLocalization>['colors'];
  t: (key: string, params?: Record<string, unknown>) => string;
}

function CategoryRow({ size, onClear, clearing, colors, t }: CategoryRowProps) {
  const isClearable = CLEARABLE_CATEGORIES.includes(size.category);
  const sizeLabel = size.computed ? formatBytes(size.bytes) : t('common.unknown');

  return (
    <View
      style={[styles.categoryRow, { borderColor: colors.border }]}
      accessible
      accessibilityLabel={`${t(categoryLabelKey(size.category))}, ${sizeLabel}`}
    >
      <View style={[styles.categoryIconShell, { backgroundColor: colors.card }]}>
        <Ionicons name={categoryIcon(size.category) as any} size={20} color={colors.accent} />
      </View>

      <View style={styles.categoryTextWrap}>
        <Text style={[styles.categoryName, { color: colors.text }]}>
          {t(categoryLabelKey(size.category))}
        </Text>
        <View style={[styles.sizeBadge, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <Text style={[styles.sizeBadgeText, { color: colors.textSecondary }]}>{sizeLabel}</Text>
        </View>
      </View>

      {isClearable && (
        clearing ? (
          <ActivityIndicator size="small" color={colors.accent} accessibilityLabel={t('common.loading')} />
        ) : (
          <TouchableOpacity
            onPress={onClear}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={t('settings.data_privacy.clear_category', {
              name: t(categoryLabelKey(size.category)),
            })}
            style={[styles.clearButton, { borderColor: colors.danger }]}
          >
            <Ionicons name="trash-outline" size={15} color={colors.danger} />
            <Text style={[styles.clearButtonText, { color: colors.danger }]}>
              {t('settings.data_privacy.clear')}
            </Text>
          </TouchableOpacity>
        )
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function DataPrivacyScreen() {
  const { colors, t } = useLocalization();
  const router = useRouter();
  const { clearWatchlist: clearWatchlistContext } = useWatchlist();

  // --- state -----------------------------------------------------------------
  const [sizes, setSizes] = useState<CategorySize[]>([]);
  const [sizesLoading, setSizesLoading] = useState(true);
  const [clearingCategory, setClearingCategory] = useState<DataCategory | null>(null);
  const [clearingAll, setClearingAll] = useState(false);
  const [analyticsOptOut, setAnalyticsOptOutState] = useState(false);
  const [crashOptOut, setCrashOptOutState] = useState(false);
  const [togglingAnalytics, setTogglingAnalytics] = useState(false);
  const [togglingCrash, setTogglingCrash] = useState(false);

  // --- load initial data -----------------------------------------------------
  const loadSizes = useCallback(async () => {
    setSizesLoading(true);
    try {
      const result = await getAllCategorySizes();
      setSizes(result);
    } finally {
      setSizesLoading(false);
    }
  }, []);

  const loadPreferences = useCallback(async () => {
    const [analytics, crash] = await Promise.all([
      getAnalyticsOptOut(),
      getCrashReportingOptOut(),
    ]);
    setAnalyticsOptOutState(analytics);
    setCrashOptOutState(crash);
  }, []);

  useEffect(() => {
    loadSizes();
    loadPreferences();
  }, [loadSizes, loadPreferences]);

  // --- userId helper (needed for watchlist and clearAll) ---------------------
  const getUserId = useCallback(async () => {
    try {
      const meta = await storage.getWalletMetadata();
      return meta.activePublicKey ?? undefined;
    } catch {
      return undefined;
    }
  }, []);

  // --- individual clear handlers ---------------------------------------------
  const handleClearCategory = useCallback(
    (category: DataCategory) => {
      const categoryName = t(categoryLabelKey(category));

      Alert.alert(
        t('settings.data_privacy.confirm_clear_title'),
        t('settings.data_privacy.confirm_clear_message', { name: categoryName }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('settings.data_privacy.clear'),
            style: 'destructive',
            onPress: async () => {
              setClearingCategory(category);
              try {
                const userId = await getUserId();
                switch (category) {
                  case 'api_cache':
                    await clearApiCache();
                    break;
                  case 'saved_news':
                    await clearSavedNews();
                    break;
                  case 'watchlist':
                    await clearWatchlist(userId);
                    // Also reset the in-memory watchlist context so the UI
                    // reflects the empty state immediately.
                    await clearWatchlistContext();
                    break;
                  case 'contribution_drafts':
                    await clearContributionDrafts();
                    break;
                }
                await loadSizes();
              } catch {
                Alert.alert(
                  t('errors.something_went_wrong'),
                  t('settings.data_privacy.clear_failed'),
                );
              } finally {
                setClearingCategory(null);
              }
            },
          },
        ],
      );
    },
    [t, getUserId, clearWatchlistContext, loadSizes],
  );

  // --- clear-all handler -----------------------------------------------------
  const handleClearAll = useCallback(() => {
    Alert.alert(
      t('settings.data_privacy.confirm_clear_all_title'),
      t('settings.data_privacy.confirm_clear_all_message'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settings.data_privacy.clear_all'),
          style: 'destructive',
          onPress: async () => {
            setClearingAll(true);
            try {
              const userId = await getUserId();
              const result = await clearAll(userId);

              // Sync in-memory watchlist context with what was cleared on disk.
              if (result.cleared.includes('watchlist')) {
                await clearWatchlistContext();
              }

              if (result.clearedWithPendingMutations) {
                // Some mutations may not have synced — warn the user.
                Alert.alert(
                  t('settings.data_privacy.cleared_with_pending_title'),
                  t('settings.data_privacy.cleared_with_pending_message'),
                );
              } else if (result.failed.length > 0) {
                Alert.alert(
                  t('settings.data_privacy.clear_partial_title'),
                  t('settings.data_privacy.clear_partial_message'),
                );
              } else {
                Alert.alert(
                  t('common.success'),
                  t('settings.data_privacy.clear_all_success'),
                );
              }

              await loadSizes();
            } catch {
              Alert.alert(
                t('errors.something_went_wrong'),
                t('settings.data_privacy.clear_failed'),
              );
            } finally {
              setClearingAll(false);
            }
          },
        },
      ],
    );
  }, [t, getUserId, clearWatchlistContext, loadSizes]);

  // --- toggle handlers -------------------------------------------------------
  const handleAnalyticsToggle = useCallback(
    async (value: boolean) => {
      setTogglingAnalytics(true);
      try {
        await setAnalyticsOptOut(value);
        setAnalyticsOptOutState(value);
      } finally {
        setTogglingAnalytics(false);
      }
    },
    [],
  );

  const handleCrashToggle = useCallback(
    async (value: boolean) => {
      setTogglingCrash(true);
      try {
        await setCrashReportingOptOut(value);
        setCrashOptOutState(value);
      } finally {
        setTogglingCrash(false);
      }
    },
    [],
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
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
        {/* Spacer to keep title centred */}
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Stored Data section ────────────────────────────────────────── */}
        <View
          style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}
          accessible
          accessibilityLabel={t('settings.data_privacy.stored_data_section')}
        >
          <View style={styles.sectionHeader}>
            <Ionicons name="folder-open-outline" size={20} color={colors.accent} />
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              {t('settings.data_privacy.stored_data_section')}
            </Text>
          </View>

          <Text style={[styles.sectionDesc, { color: colors.textSecondary }]}>
            {t('settings.data_privacy.stored_data_desc')}
          </Text>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          {sizesLoading ? (
            <ActivityIndicator
              color={colors.accent}
              style={{ marginVertical: 16 }}
              accessibilityLabel={t('common.loading')}
            />
          ) : (
            sizes.map((size, index) => (
              <React.Fragment key={size.category}>
                {index > 0 && (
                  <View style={[styles.divider, { backgroundColor: colors.border }]} />
                )}
                <CategoryRow
                  size={size}
                  onClear={() => handleClearCategory(size.category)}
                  clearing={clearingCategory === size.category}
                  colors={colors}
                  t={t}
                />
              </React.Fragment>
            ))
          )}
        </View>

        {/* ── Clear All button ───────────────────────────────────────────── */}
        <TouchableOpacity
          style={[
            styles.clearAllButton,
            {
              backgroundColor: colors.surface,
              borderColor: colors.danger,
              opacity: clearingAll ? 0.6 : 1,
            },
          ]}
          onPress={handleClearAll}
          disabled={clearingAll || sizesLoading}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel={t('settings.data_privacy.clear_all')}
          accessibilityHint={t('settings.data_privacy.clear_all_hint')}
        >
          {clearingAll ? (
            <ActivityIndicator size="small" color={colors.danger} />
          ) : (
            <Ionicons name="trash-outline" size={20} color={colors.danger} />
          )}
          <Text style={[styles.clearAllText, { color: colors.danger }]}>
            {t('settings.data_privacy.clear_all')}
          </Text>
        </TouchableOpacity>

        <Text style={[styles.clearAllCaption, { color: colors.textSecondary }]}>
          {t('settings.data_privacy.clear_all_caption')}
        </Text>

        {/* ── Analytics & Crash Reporting section ────────────────────────── */}
        <View
          style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}
          accessible
          accessibilityLabel={t('settings.data_privacy.privacy_section')}
        >
          <View style={styles.sectionHeader}>
            <Ionicons name="shield-checkmark-outline" size={20} color={colors.accent} />
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              {t('settings.data_privacy.privacy_section')}
            </Text>
          </View>

          {/* Analytics opt-out */}
          <View style={styles.toggleRow}>
            <View style={styles.toggleTextWrap}>
              <Text style={[styles.toggleTitle, { color: colors.text }]}>
                {t('settings.data_privacy.analytics_opt_out')}
              </Text>
              <Text style={[styles.toggleDesc, { color: colors.textSecondary }]}>
                {t('settings.data_privacy.analytics_opt_out_desc')}
              </Text>
            </View>
            {togglingAnalytics ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : (
              <Switch
                value={analyticsOptOut}
                onValueChange={handleAnalyticsToggle}
                trackColor={{ false: colors.cardBorder, true: colors.accent }}
                thumbColor="#ffffff"
                accessibilityLabel={t('settings.data_privacy.analytics_opt_out')}
                accessibilityRole="switch"
              />
            )}
          </View>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          {/* Crash-reporting opt-out */}
          <View style={styles.toggleRow}>
            <View style={styles.toggleTextWrap}>
              <Text style={[styles.toggleTitle, { color: colors.text }]}>
                {t('settings.data_privacy.crash_opt_out')}
              </Text>
              <Text style={[styles.toggleDesc, { color: colors.textSecondary }]}>
                {t('settings.data_privacy.crash_opt_out_desc')}
              </Text>
            </View>
            {togglingCrash ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : (
              <Switch
                value={crashOptOut}
                onValueChange={handleCrashToggle}
                trackColor={{ false: colors.cardBorder, true: colors.accent }}
                thumbColor="#ffffff"
                accessibilityLabel={t('settings.data_privacy.crash_opt_out')}
                accessibilityRole="switch"
              />
            )}
          </View>
        </View>

        {/* ── Info note ─────────────────────────────────────────────────── */}
        <View
          style={[styles.infoBox, { backgroundColor: colors.surface, borderColor: colors.border }]}
          accessible
          accessibilityLabel={t('settings.data_privacy.auth_note')}
        >
          <Ionicons name="information-circle-outline" size={18} color={colors.textSecondary} style={{ marginTop: 1 }} />
          <Text style={[styles.infoText, { color: colors.textSecondary }]}>
            {t('settings.data_privacy.auth_note')}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 48,
  },
  section: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  sectionDesc: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 8,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 12,
  },
  // Category row
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 4,
  },
  categoryIconShell: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  categoryTextWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  categoryName: {
    fontSize: 15,
    fontWeight: '500',
  },
  sizeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
  },
  sizeBadgeText: {
    fontSize: 12,
    fontWeight: '500',
  },
  clearButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    flexShrink: 0,
  },
  clearButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
  // Clear-all button
  clearAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 52,
    borderRadius: 16,
    borderWidth: 1.5,
    marginBottom: 8,
  },
  clearAllText: {
    fontSize: 16,
    fontWeight: '700',
  },
  clearAllCaption: {
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'center',
    marginBottom: 16,
    paddingHorizontal: 8,
  },
  // Toggle rows
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 4,
  },
  toggleTextWrap: {
    flex: 1,
  },
  toggleTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 4,
  },
  toggleDesc: {
    fontSize: 13,
    lineHeight: 18,
  },
  // Info note
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  infoText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
  },
});
