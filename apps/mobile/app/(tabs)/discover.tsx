import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '../../contexts/ThemeContext';
import { useLocalization } from '../../src/context';
import { stellarApi, StellarAsset } from '../../lib/api';
import { CachedApi } from '../../lib/cached-api';
import { resolveDeepLink } from '../../lib/deep-links';
import {
  SIGNAL_CATEGORY_LABELS,
  SIGNAL_SEVERITY_LABELS,
  UserSignal,
  formatSignalAge,
  isSignalStale,
  signalDeepLink,
  signalKey,
  signalSubjectLabel,
  sortSignalsByStrength,
} from '../../lib/signals';
import { useCachedData } from '../../hooks/useCachedData';
import { CACHE_CONFIGS } from '../../lib/cache';
import { useWatchlist } from '../../contexts/WatchlistContext';
import { WatchlistItemType } from '../../lib/watchlist';

const MOCK_ASSETS: StellarAsset[] = [
  { code: 'XLM', name: 'Stellar Lumens', issuer: null, priceUsd: 0.1051, change24h: 1.23 },
  {
    code: 'USDC',
    name: 'USD Coin',
    issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    priceUsd: 1.0,
    change24h: 0.01,
  },
  {
    code: 'BTC',
    name: 'Bitcoin (Wrapped)',
    issuer: 'GDXTJEK4JZNSTNQAWA53RZNS2GIKTDRPEUWDXELFMKU52XNECNVDVXDI',
    priceUsd: 67241,
    change24h: -0.88,
  },
  {
    code: 'ETH',
    name: 'Ethereum (Wrapped)',
    issuer: 'GBDEVU63Y6NTHJQQZIKVTC23NWLQKCKZZZ6AANA8APE6SLTD4XL7VCB',
    priceUsd: 3502,
    change24h: 2.14,
  },
  {
    code: 'AQUA',
    name: 'Aquarius',
    issuer: 'GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA',
    priceUsd: 0.0007,
    change24h: -3.4,
  },
  {
    code: 'yXLM',
    name: 'Yield XLM',
    issuer: 'GARDNV3Q7YGT4AKSDF25LT32YSCCW4EV22Y2TV3I2PU2MMXJTEDL5T55',
    priceUsd: 0.1062,
    change24h: 1.15,
  },
  {
    code: 'SHX',
    name: 'Stronghold',
    issuer: 'GDSTRSHXHGJ7ZIVRBXEYE5Q74XUVCUSEKEBR7UCHEUUEK72N7I7KJ6JH',
    priceUsd: 0.0081,
    change24h: 5.6,
  },
  {
    code: 'LOBSTR',
    name: 'Lobstr Token',
    issuer: 'GCKU3YNEBAA7CR5W5BPNNQKBRMKZD5ZFKX3QHAKJ273HJHZM4HPEZ8NB',
    priceUsd: 0.032,
    change24h: -1.7,
  },
  {
    code: 'SSLX',
    name: 'StellarX',
    issuer: 'GBSTRUSD7IRX73RQZBL3RQUH6KS3O4NYFY3QCALDLZD77XMZOPWAVTUK',
    priceUsd: 0.0028,
    change24h: 0.45,
  },
  {
    code: 'REPO',
    name: 'Repo Token',
    issuer: 'GCZNF24HPMYTV6NOEHI7Q5RJFFUI23JKUKY3H3XTQAFBQIBOHD5OXG3',
    priceUsd: 0.0055,
    change24h: -0.2,
  },
];

function formatPrice(usd: number): string {
  if (usd >= 1) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(usd);
  }
  return `$${usd.toPrecision(4)}`;
}

function assetColor(code: string): string {
  const palette = ['#db74cf', '#7a85ff', '#4ecdc4', '#f7b731', '#ff6b6b', '#a29bfe'];
  let hash = 0;
  for (let i = 0; i < code.length; i++) hash = code.charCodeAt(i) + ((hash << 5) - hash);
  return palette[Math.abs(hash) % palette.length];
}

type ThemeColors = ReturnType<typeof useTheme>['colors'];

function AssetItem({
  asset,
  colors,
  t,
}: {
  asset: StellarAsset;
  colors: ThemeColors;
  t: (key: string) => string;
}) {
  const color = assetColor(asset.code);
  const isPositive = asset.change24h >= 0;
  const changeColor = isPositive ? '#27ae60' : '#e74c3c';
  const { isInWatchlist, toggleItem } = useWatchlist();
  const inWatchlist = isInWatchlist(asset.code, WatchlistItemType.ASSET);

  const handleToggleWatchlist = useCallback(() => {
    toggleItem({
      symbol: asset.code,
      name: asset.name,
      type: WatchlistItemType.ASSET,
      assetIssuer: asset.issuer ?? undefined,
      imageUrl: asset.iconUrl ?? undefined,
    });
  }, [asset, toggleItem]);

  return (
    <View
      testID={`asset-item-${asset.code}`}
      style={[styles.assetItem, { borderBottomColor: colors.border }]}
      accessible
      accessibilityLabel={`${asset.code} ${asset.name}, ${t('discover.price')} ${formatPrice(asset.priceUsd)}, ${t('discover.change_24h')} ${isPositive ? '+' : ''}${asset.change24h.toFixed(2)}%`}
      accessibilityRole="button"
      accessibilityHint={t('discover.asset_hint')}
    >
      <TouchableOpacity
        onPress={handleToggleWatchlist}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        style={styles.watchlistToggle}
        accessibilityRole="switch"
        accessibilityState={{ checked: inWatchlist }}
        accessibilityLabel={inWatchlist ? t('discover.remove_from_watchlist') : t('discover.add_to_watchlist')}
      >
        <Ionicons
          name={inWatchlist ? 'star' : 'star-outline'}
          size={22}
          color={inWatchlist ? '#f7b731' : colors.textSecondary}
        />
      </TouchableOpacity>

      <View style={[styles.assetIcon, { backgroundColor: `${color}22` }]} accessible>
        <Text style={[styles.assetIconText, { color }]}>{asset.code.charAt(0)}</Text>
      </View>

      <View style={styles.assetMeta}>
        <Text style={[styles.assetCode, { color: colors.text }]} numberOfLines={1} accessible>
          {asset.code}
        </Text>
        <Text
          style={[styles.assetName, { color: colors.textSecondary }]}
          numberOfLines={1}
          accessible
        >
          {asset.name}
        </Text>
      </View>

      <View style={styles.assetPricing}>
        <Text style={[styles.assetPrice, { color: colors.text }]} accessible>
          {formatPrice(asset.priceUsd)}
        </Text>
        <View
          style={[styles.changeBadge, { backgroundColor: `${changeColor}22` }]}
          accessible
          accessibilityLabel={`${t('discover.change_24h')}: ${isPositive ? '+' : ''}${asset.change24h.toFixed(2)}%`}
        >
          <Ionicons
            name={isPositive ? 'trending-up' : 'trending-down'}
            size={11}
            color={changeColor}
            style={{ marginRight: 3 }}
          />
          <Text style={[styles.changeText, { color: changeColor }]} accessible>
            {isPositive ? '+' : ''}
            {asset.change24h.toFixed(2)}%
          </Text>
        </View>
      </View>
    </View>
  );
}

/** Badge colour for a signal's strength. */
function severityColor(severity: UserSignal['severity'], colors: ThemeColors): string {
  switch (severity) {
    case 'high':
      return colors.danger;
    case 'medium':
      return colors.warning;
    default:
      return colors.textSecondary;
  }
}

interface SignalRowProps {
  signal: UserSignal;
  colors: ThemeColors;
  feedStale: boolean;
  feedAge: string;
  onPress: (signal: UserSignal) => void;
}

/**
 * One market signal. It shows the signal's type (category), the subject it is
 * about and its strength, then routes through the deep link route table when
 * tapped so a renamed route cannot silently produce a dead tap.
 */
function SignalRow({ signal, colors, feedStale, feedAge, onPress }: SignalRowProps) {
  const strengthColor = severityColor(signal.severity, colors);

  return (
    <TouchableOpacity
      testID={`signal-item-${signal.category}-${signal.severity}`}
      style={[styles.signalItem, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}
      onPress={() => onPress(signal)}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={`${SIGNAL_CATEGORY_LABELS[signal.category]} signal about ${signalSubjectLabel(
        signal,
      )}, ${SIGNAL_SEVERITY_LABELS[signal.severity]} strength. ${signal.title}`}
      accessibilityHint="Opens the screen this signal is about"
    >
      <View style={styles.signalHeader}>
        <View style={[styles.signalCategoryBadge, { backgroundColor: `${colors.accent}22` }]}>
          <Text style={[styles.signalCategoryText, { color: colors.accent }]}>
            {SIGNAL_CATEGORY_LABELS[signal.category]}
          </Text>
        </View>
        <View style={[styles.signalCategoryBadge, { backgroundColor: `${strengthColor}22` }]}>
          <Text style={[styles.signalCategoryText, { color: strengthColor }]}>
            {SIGNAL_SEVERITY_LABELS[signal.severity]}
          </Text>
        </View>
        <Text style={[styles.signalSubject, { color: colors.textSecondary }]} numberOfLines={1}>
          {signalSubjectLabel(signal)}
        </Text>
      </View>

      <Text style={[styles.signalTitle, { color: colors.text }]}>{signal.title}</Text>
      <Text style={[styles.signalDetail, { color: colors.textSecondary }]}>{signal.detail}</Text>

      <Text style={[styles.signalAge, { color: feedStale ? colors.warning : colors.textSecondary }]}>
        {feedStale ? `Stale · ${feedAge}` : feedAge}
      </Text>
    </TouchableOpacity>
  );
}

export default function AssetDiscoveryScreen() {
  const { colors } = useTheme();
  const { t } = useLocalization();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [signals, setSignals] = useState<UserSignal[]>([]);
  const [signalsGeneratedAt, setSignalsGeneratedAt] = useState<string | null>(null);
  const [signalsStale, setSignalsStale] = useState(false);

  /**
   * Latest computed signals for the signed-in user, read through
   * `CachedApi.getSignals()` so the section still renders offline.
   */
  const loadSignals = useCallback(async () => {
    const response = await CachedApi.getSignals();
    if (response.success && response.data) {
      setSignals(sortSignalsByStrength(response.data.signals));
      setSignalsGeneratedAt(response.data.generatedAt);
      setSignalsStale(Boolean(response.isStale));
      return;
    }
    setSignals([]);
    setSignalsGeneratedAt(null);
    setSignalsStale(false);
  }, []);

  useEffect(() => {
    void loadSignals();
  }, [loadSignals]);

  const {
    data: assetsData,
    loading: isLoading,
    error: apiError,
    refresh,
    isStale,
  } = useCachedData({
    key: 'stellar_assets',
    fetcher: async () => {
      const response = await stellarApi.getAssets();
      if (response.success && response.data?.assets?.length) {
        return response.data.assets;
      }
      return MOCK_ASSETS;
    },
    ...CACHE_CONFIGS.ASSETS,
  });

  const error = apiError?.message || null;

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([refresh(), loadSignals()]);
    } finally {
      setRefreshing(false);
    }
  };

  /** Routes a tapped signal through the route table to a real screen. */
  const handleSignalPress = useCallback(
    (signal: UserSignal) => {
      const resolved = resolveDeepLink(signalDeepLink(signal));
      if (!resolved.routeKey) return;
      router.push(resolved.route as never);
    },
    [router],
  );

  const signalAge = formatSignalAge(signalsGeneratedAt);
  const signalsAreStale = signalsStale || isSignalStale(signalsGeneratedAt);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const assetsList = assetsData || [];
    if (!q) return assetsList;
    return assetsList.filter(
      (a) => a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q),
    );
  }, [assetsData, query]);

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <Text
          style={[styles.screenTitle, { color: colors.text }]}
          accessible
          accessibilityRole="header"
        >
          {t('discover.title')}
        </Text>
        <View style={[styles.center, { flex: 1 }]}>
          <ActivityIndicator
            color={colors.accent}
            size="large"
            accessible
            accessibilityLabel={t('common.loading')}
          />
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <Text
          style={[styles.screenTitle, { color: colors.text }]}
          accessible
          accessibilityRole="header"
        >
          {t('discover.title')}
        </Text>
        <View style={[styles.center, { flex: 1, padding: 32 }]}>
          <Ionicons
            name="cloud-offline-outline"
            size={56}
            color={colors.danger}
            style={{ marginBottom: 16 }}
            accessible
            accessibilityLabel={t('errors.couldnt_load', { item: 'assets' })}
          />
          <Text
            style={[styles.emptyTitle, { color: colors.text }]}
            accessible
            accessibilityRole="header"
          >
            {t('errors.couldnt_load', { item: 'assets' })}
          </Text>
          <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]} accessible>
            {error}
          </Text>
          <TouchableOpacity
            style={[styles.retryButton, { backgroundColor: colors.accent }]}
            onPress={handleRefresh}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={t('common.retry')}
          >
            <Text style={styles.retryText} accessible>
              {t('common.retry')}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={filtered}
        keyExtractor={(item) => `${item.code}-${item.issuer ?? 'native'}`}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            accessibilityLabel="Pull to refresh assets"
          />
        }
        ListHeaderComponent={
          <>
            <Text
              style={[styles.screenTitle, { color: colors.text }]}
              accessible
              accessibilityRole="header"
            >
              {t('discover.title')}
            </Text>

            {isStale && (
              <View
                style={[styles.staleIndicator, { backgroundColor: colors.warning + '22' }]}
                accessible
                accessibilityLabel={t('discover.showing_cached')}
              >
                <Ionicons name="cloud-offline-outline" size={16} color={colors.warning} />
                <Text style={[styles.staleText, { color: colors.warning }]} accessible>
                  {t('discover.showing_cached')}
                </Text>
              </View>
            )}

            {signals.length > 0 && (
              <View style={styles.signalsSection} accessibilityRole="list">
                <View style={styles.signalsHeader}>
                  <Text
                    style={[styles.signalsTitle, { color: colors.text }]}
                    accessible
                    accessibilityRole="header"
                  >
                    Market signals
                  </Text>
                  <Text
                    style={[
                      styles.signalsAge,
                      { color: signalsAreStale ? colors.warning : colors.textSecondary },
                    ]}
                    accessible
                  >
                    {signalsAreStale ? `Stale · ${signalAge}` : signalAge}
                  </Text>
                </View>
                {signals.map((signal, index) => (
                  <SignalRow
                    key={signalKey(signal, index)}
                    signal={signal}
                    colors={colors}
                    feedStale={signalsAreStale}
                    feedAge={signalAge}
                    onPress={handleSignalPress}
                  />
                ))}
              </View>
            )}

            <View
              style={[
                styles.searchContainer,
                { backgroundColor: colors.surface, borderColor: colors.cardBorder },
              ]}
              accessible
              accessibilityLabel={t('discover.search_label')}
            >
              <Ionicons
                name="search-outline"
                size={18}
                color={colors.textSecondary}
                style={styles.searchIcon}
              />
              <TextInput
                testID="asset-search-input"
                style={[styles.searchInput, { color: colors.text }]}
                placeholder={t('discover.search_placeholder')}
                placeholderTextColor={colors.textSecondary}
                value={query}
                onChangeText={setQuery}
                autoCapitalize="none"
                autoCorrect={false}
                clearButtonMode="while-editing"
                accessibilityLabel={t('discover.search_label')}
                accessibilityRole="search"
              />
              {query.length > 0 && (
                <TouchableOpacity
                  onPress={() => setQuery('')}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel={t('common.clear')}
                >
                  <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
                </TouchableOpacity>
              )}
            </View>

            <View style={[styles.columnHeader, { borderBottomColor: colors.border }]} accessible>
              <Text style={[styles.columnLabel, { color: colors.textSecondary }]} accessible>
                {t('discover.asset')}
              </Text>
              <Text style={[styles.columnLabel, { color: colors.textSecondary }]} accessible>
                {t('discover.price')} / 24h
              </Text>
            </View>
          </>
        }
        ListEmptyComponent={
          <View
            style={[styles.center, { paddingVertical: 60 }]}
            accessible
            accessibilityLabel="No results"
          >
            <Ionicons
              name="search-outline"
              size={48}
              color={colors.textSecondary}
              style={{ marginBottom: 12 }}
              accessible
              accessibilityLabel={t('discover.title')}
            />
            <Text
              style={[styles.emptyTitle, { color: colors.text }]}
              accessible
              accessibilityRole="header"
            >
              {t('discover.no_results')}
            </Text>
            <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]} accessible>
              {t('discover.try_search')}
            </Text>
          </View>
        }
        renderItem={({ item }) => <AssetItem asset={item} colors={colors} t={t} />}
        accessibilityLabel={t('discover.title')}
        accessibilityRole="list"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { justifyContent: 'center', alignItems: 'center' },
  listContent: { paddingBottom: 40 },
  screenTitle: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginHorizontal: 20,
    marginTop: 20,
    marginBottom: 16,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    height: 48,
  },
  searchIcon: { marginRight: 8 },
  searchInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 0,
  },
  columnHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  columnLabel: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  assetItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  watchlistToggle: { paddingRight: 10, paddingLeft: 4 },
  assetIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  assetIconText: { fontSize: 18, fontWeight: '700' },
  assetMeta: { flex: 1, marginRight: 8 },
  assetCode: { fontSize: 16, fontWeight: '700', marginBottom: 2 },
  assetName: { fontSize: 13 },
  assetPricing: { alignItems: 'flex-end' },
  assetPrice: { fontSize: 15, fontWeight: '600', marginBottom: 4 },
  changeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  changeText: { fontSize: 11, fontWeight: '700' },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
    paddingHorizontal: 16,
  },
  retryButton: {
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 12,
  },
  retryText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
  staleIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 8,
  },
  staleText: {
    fontSize: 12,
    fontWeight: '500',
    marginLeft: 6,
  },
  signalsSection: {
    paddingHorizontal: 16,
    marginBottom: 20,
    gap: 10,
  },
  signalsHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  signalsTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  signalsAge: {
    fontSize: 12,
    fontWeight: '500',
  },
  signalItem: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 6,
  },
  signalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  signalCategoryBadge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  signalCategoryText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  signalSubject: {
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 'auto',
    maxWidth: 110,
  },
  signalTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  signalDetail: {
    fontSize: 13,
    lineHeight: 18,
  },
  signalAge: {
    fontSize: 11,
    fontWeight: '600',
  },
});
