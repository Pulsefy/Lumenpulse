import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  SafeAreaView,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '../../contexts/ThemeContext';
import { useLocalization } from '../../src/context';
import { useDataPreloader } from '../../components/DataPreloader';
import { cache } from '../../lib/cache';
import { imageCache, formatBytes, ImageCacheStats } from '../../lib/image-cache';

export default function CacheSettingsScreen() {
  const { colors } = useTheme();
  const { t } = useLocalization();
  const router = useRouter();
  const { preloadData, clearCache } = useDataPreloader();
  const [loading, setLoading] = useState(false);
  const [imgStats, setImgStats] = useState<ImageCacheStats | null>(null);

  const loadImageStats = useCallback(async () => {
    try {
      const stats = await imageCache.getStats();
      setImgStats(stats);
    } catch {
      // Non-fatal — stats are informational only.
    }
  }, []);

  useEffect(() => {
    void loadImageStats();
  }, [loadImageStats]);

  const handleClearCache = () => {
    Alert.alert(t('settings.cache.clear_cache'), t('settings.cache.clear_cache_message'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.confirm'),
        style: 'destructive',
        onPress: async () => {
          setLoading(true);
          try {
            await clearCache();
            await imageCache.clearAll();
            await loadImageStats();
            Alert.alert(t('success'), t('settings.cache.cleared_successfully'));
          } catch {
            Alert.alert(t('errors.error'), t('settings.cache.clear_failed'));
          } finally {
            setLoading(false);
          }
        },
      },
    ]);
  };

  const handleClearImageCache = () => {
    Alert.alert(
      t('settings.cache.clear_image_cache'),
      t('settings.cache.clear_image_cache_message'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.confirm'),
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            try {
              await imageCache.clearAll();
              await loadImageStats();
              Alert.alert(t('success'), t('settings.cache.image_cache_cleared'));
            } catch {
              Alert.alert(t('errors.error'), t('settings.cache.clear_failed'));
            } finally {
              setLoading(false);
            }
          },
        },
      ],
    );
  };

  const handlePreloadData = async () => {
    setLoading(true);
    try {
      await preloadData();
      Alert.alert(t('success'), t('settings.cache.preloaded_successfully'));
    } catch {
      Alert.alert(t('errors.error'), t('settings.cache.preload_failed'));
    } finally {
      setLoading(false);
    }
  };

  const SettingItem = ({
    icon,
    title,
    subtitle,
    onPress,
    destructive = false,
  }: {
    icon: string;
    title: string;
    subtitle: string;
    onPress: () => void;
    destructive?: boolean;
  }) => (
    <TouchableOpacity
      style={[styles.settingItem, { backgroundColor: colors.surface }]}
      onPress={onPress}
      disabled={loading}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={subtitle}
    >
      <View style={styles.settingIcon}>
        <Ionicons
          name={icon as any}
          size={24}
          color={destructive ? colors.danger : colors.accent}
        />
      </View>
      <View style={styles.settingContent}>
        <Text style={[styles.settingTitle, { color: colors.text }]} accessible>
          {title}
        </Text>
        <Text style={[styles.settingSubtitle, { color: colors.textSecondary }]} accessible>
          {subtitle}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
    </TouchableOpacity>
  );

  // Percentage bar fill, capped at 100 %
  const imgUsagePct =
    imgStats && imgStats.maxBytes > 0
      ? Math.min((imgStats.totalBytes / imgStats.maxBytes) * 100, 100)
      : 0;

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
          {t('settings.cache.title')}
        </Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={styles.content}>
        {/* ── Data management ─────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text
            style={[styles.sectionTitle, { color: colors.text }]}
            accessible
            accessibilityRole="header"
          >
            {t('settings.cache.data_management')}
          </Text>
          <Text style={[styles.sectionDescription, { color: colors.textSecondary }]} accessible>
            {t('settings.cache.data_management_desc')}
          </Text>
        </View>

        <SettingItem
          icon="download-outline"
          title={t('settings.cache.preload_data')}
          subtitle={t('settings.cache.preload_data_desc')}
          onPress={handlePreloadData}
        />

        <SettingItem
          icon="trash-outline"
          title={t('settings.cache.clear_cache')}
          subtitle={t('settings.cache.clear_cache_desc')}
          onPress={handleClearCache}
          destructive
        />

        {/* ── Image cache ──────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text
            style={[styles.sectionTitle, { color: colors.text }]}
            accessible
            accessibilityRole="header"
          >
            {t('settings.cache.image_cache')}
          </Text>
          <Text style={[styles.sectionDescription, { color: colors.textSecondary }]} accessible>
            {t('settings.cache.image_cache_desc')}
          </Text>
        </View>

        {imgStats !== null && (
          <View
            style={[styles.statsBox, { backgroundColor: colors.surface }]}
            accessible
            accessibilityLabel={`Image cache: ${formatBytes(imgStats.totalBytes)} of ${formatBytes(imgStats.maxBytes)} used, ${imgStats.entryCount} images`}
          >
            {/* Usage bar */}
            <View style={styles.statsRow}>
              <Text style={[styles.statsLabel, { color: colors.textSecondary }]}>
                {t('settings.cache.image_cache_used')}
              </Text>
              <Text style={[styles.statsValue, { color: colors.text }]}>
                {formatBytes(imgStats.totalBytes)} / {formatBytes(imgStats.maxBytes)}
              </Text>
            </View>

            <View style={[styles.usageTrack, { backgroundColor: colors.border }]}>
              <View
                style={[
                  styles.usageFill,
                  {
                    width: `${imgUsagePct}%` as any,
                    backgroundColor:
                      imgUsagePct > 85 ? colors.danger : colors.accent,
                  },
                ]}
                accessibilityRole="progressbar"
                accessibilityValue={{ min: 0, max: 100, now: Math.round(imgUsagePct) }}
              />
            </View>

            <View style={[styles.statsRow, { marginTop: 8 }]}>
              <Text style={[styles.statsLabel, { color: colors.textSecondary }]}>
                {t('settings.cache.image_cache_count')}
              </Text>
              <Text style={[styles.statsValue, { color: colors.text }]}>
                {imgStats.entryCount} {imgStats.entryCount === 1 ? 'image' : 'images'}
              </Text>
            </View>

            <View style={styles.statsRow}>
              <Text style={[styles.statsLabel, { color: colors.textSecondary }]}>
                {t('settings.cache.image_cache_limit')}
              </Text>
              <Text style={[styles.statsValue, { color: colors.text }]}>
                {formatBytes(imgStats.maxBytes)} (LRU eviction)
              </Text>
            </View>
          </View>
        )}

        <SettingItem
          icon="images-outline"
          title={t('settings.cache.clear_image_cache')}
          subtitle={t('settings.cache.clear_image_cache_desc')}
          onPress={handleClearImageCache}
          destructive
        />

        {/* ── How caching works ────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text
            style={[styles.sectionTitle, { color: colors.text }]}
            accessible
            accessibilityRole="header"
          >
            {t('settings.cache.how_caching_works')}
          </Text>
          <View style={[styles.infoBox, { backgroundColor: colors.surface }]} accessible>
            <Text style={[styles.infoText, { color: colors.textSecondary }]}>
              {t('settings.cache.caching_info')}
            </Text>
          </View>
        </View>

        {/* ── Network status ───────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text
            style={[styles.sectionTitle, { color: colors.text }]}
            accessible
            accessibilityRole="header"
          >
            {t('settings.cache.cache_status')}
          </Text>
          <View style={[styles.statusBox, { backgroundColor: colors.surface }]} accessible>
            <View style={styles.statusItem}>
              <Ionicons
                name={cache.isOnlineStatus() ? 'wifi' : 'wifi-outline'}
                size={20}
                color={cache.isOnlineStatus() ? colors.success : colors.danger}
              />
              <Text style={[styles.statusText, { color: colors.text }]} accessible>
                {cache.isOnlineStatus() ? t('settings.cache.online') : t('settings.cache.offline')}
              </Text>
            </View>
          </View>
        </View>
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
  section: { paddingHorizontal: 16, paddingVertical: 16 },
  sectionTitle: { fontSize: 20, fontWeight: '700', marginBottom: 8 },
  sectionDescription: { fontSize: 14, lineHeight: 20 },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 12,
  },
  settingIcon: { marginRight: 12 },
  settingContent: { flex: 1 },
  settingTitle: { fontSize: 16, fontWeight: '600', marginBottom: 2 },
  settingSubtitle: { fontSize: 14 },

  // Image cache stats card
  statsBox: {
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 16,
    borderRadius: 12,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  statsLabel: { fontSize: 13 },
  statsValue: { fontSize: 13, fontWeight: '600' },
  usageTrack: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    marginVertical: 8,
  },
  usageFill: {
    height: '100%',
    borderRadius: 3,
  },

  infoBox: { padding: 16, borderRadius: 12, marginTop: 8 },
  infoText: { fontSize: 14, lineHeight: 20 },
  statusBox: { padding: 16, borderRadius: 12, marginTop: 8 },
  statusItem: { flexDirection: 'row', alignItems: 'center' },
  statusText: { fontSize: 16, fontWeight: '500', marginLeft: 8 },
});
