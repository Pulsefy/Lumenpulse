/* eslint-disable prettier/prettier */
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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { stellarApi, StellarAsset } from '../../lib/api';

// ─── Mock fallback data (used when API is unavailable) ───────────────────────
// These are popular Stellar network assets. Replace with live data once
// GET /stellar/assets is deployed on the backend.

const MOCK_ASSETS: StellarAsset[] = [
  { code: 'XLM',  name: 'Stellar Lumens',    issuer: null,                                                               priceUsd: 0.1051, change24h: 1.23  },
  { code: 'USDC', name: 'USD Coin',           issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN', priceUsd: 1.0000, change24h: 0.01  },
  { code: 'BTC',  name: 'Bitcoin (Wrapped)',  issuer: 'GDXTJEK4JZNSTNQAWA53RZNS2GIKTDRPEUWDXELFMKU52XNECNVDVXDI', priceUsd: 67241, change24h: -0.88 },
  { code: 'ETH',  name: 'Ethereum (Wrapped)', issuer: 'GBDEVU63Y6NTHJQQZIKVTC23NWLQKCKZZZ6AANA8APE6SLTD4XL7VCB', priceUsd: 3502,  change24h: 2.14  },
  { code: 'AQUA', name: 'Aquarius',           issuer: 'GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA', priceUsd: 0.0007, change24h: -3.40 },
  { code: 'yXLM', name: 'Yield XLM',          issuer: 'GARDNV3Q7YGT4AKSDF25LT32YSCCW4EV22Y2TV3I2PU2MMXJTEDL5T55', priceUsd: 0.1062, change24h: 1.15  },
  { code: 'SHX',  name: 'Stronghold',         issuer: 'GDSTRSHXHGJ7ZIVRBXEYE5Q74XUVCUSEKEBR7UCHEUUEK72N7I7KJ6JH', priceUsd: 0.0081, change24h: 5.60  },
  { code: 'LOBSTR',name:'Lobstr Token',        issuer: 'GCKU3YNEBAA7CR5W5BPNNQKBRMKZD5ZFKX3QHAKJ273HJHZM4HPEZ8NB', priceUsd: 0.0320, change24h: -1.70 },
  { code: 'SSLX', name: 'StellarX',           issuer: 'GBSTRUSD7IRX73RQZBL3RQUH6KS3O4NYFY3QCALDLZD77XMZOPWAVTUK', priceUsd: 0.0028, change24h: 0.45  },
  { code: 'REPO', name: 'Repo Token',          issuer: 'GCZNF24HPMYTV6NOEHI7Q5RJFFUI23JKUKY3H3XTQAFBQIBOHD5OXG3',  priceUsd: 0.0055, change24h: -0.20 },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatPrice(usd: number): string {
  if (usd >= 1) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(usd);
  }
  // Small prices: show up to 6 significant digits
  return `$${usd.toPrecision(4)}`;
}

function assetColor(code: string): string {
  const palette = ['#db74cf', '#7a85ff', '#4ecdc4', '#f7b731', '#ff6b6b', '#a29bfe'];
  let hash = 0;
  for (let i = 0; i < code.length; i++) hash = code.charCodeAt(i) + ((hash << 5) - hash);
  return palette[Math.abs(hash) % palette.length];
}

// ─── Sub-components ───────────────────────────────────────────────────────────

type ThemeColors = ReturnType<typeof useTheme>['colors'];

function AssetItem({ asset, colors }: { asset: StellarAsset; colors: ThemeColors }) {
  const color = assetColor(asset.code);
  const isPositive = asset.change24h >= 0;
  const changeColor = isPositive ? '#27ae60' : '#e74c3c';

  return (
    <View
      testID={`asset-item-${asset.code}`}
      style={[styles.assetItem, { borderBottomColor: colors.border }]}
    >
      {/* Icon */}
      <View style={[styles.assetIcon, { backgroundColor: `${color}22` }]}>
        <Text style={[styles.assetIconText, { color }]}>{asset.code.charAt(0)}</Text>
      </View>

      {/* Name & code */}
      <View style={styles.assetMeta}>
        <Text style={[styles.assetCode, { color: colors.text }]} numberOfLines={1}>
          {asset.code}
        </Text>
        <Text style={[styles.assetName, { color: colors.textSecondary }]} numberOfLines={1}>
          {asset.name}
        </Text>
      </View>

      {/* Price & 24h change */}
      <View style={styles.assetPricing}>
        <Text style={[styles.assetPrice, { color: colors.text }]}>{formatPrice(asset.priceUsd)}</Text>
        <View style={[styles.changeBadge, { backgroundColor: `${changeColor}22` }]}>
          <Ionicons
            name={isPositive ? 'trending-up' : 'trending-down'}
            size={11}
            color={changeColor}
            style={{ marginRight: 3 }}
          />
          <Text style={[styles.changeText, { color: changeColor }]}>
            {isPositive ? '+' : ''}{asset.change24h.toFixed(2)}%
          </Text>
        </View>
      </View>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function AssetDiscoveryScreen() {
  const { colors } = useTheme();

  const [assets, setAssets] = useState<StellarAsset[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const fetchAssets = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    const response = await stellarApi.getAssets();
    if (response.success && response.data?.assets?.length) {
      setAssets(response.data.assets);
    } else {
      // Gracefully fall back to mock data so the UI is always useful
      setAssets(MOCK_ASSETS);
    }

    setIsLoading(false);
  }, []);

  useEffect(() => {
    void fetchAssets();
  }, [fetchAssets]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return assets;
    return assets.filter(
      (a) =>
        a.code.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q),
    );
  }, [assets, query]);

  // ── Loading ───────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={[styles.screenTitle, { color: colors.text }]}>Discover</Text>
        <View style={[styles.center, { flex: 1 }]}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={[styles.screenTitle, { color: colors.text }]}>Discover</Text>
        <View style={[styles.center, { flex: 1, padding: 32 }]}>
          <Ionicons name="cloud-offline-outline" size={56} color={colors.danger} style={{ marginBottom: 16 }} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>Couldn't load assets</Text>
          <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>{error}</Text>
          <TouchableOpacity
            style={[styles.retryButton, { backgroundColor: colors.accent }]}
            onPress={() => void fetchAssets()}
            activeOpacity={0.8}
          >
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Main ──────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={filtered}
        keyExtractor={(item) => `${item.code}-${item.issuer ?? 'native'}`}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <>
            <Text style={[styles.screenTitle, { color: colors.text }]}>Discover</Text>

            {/* Search Bar */}
            <View
              style={[
                styles.searchContainer,
                { backgroundColor: colors.surface, borderColor: colors.cardBorder },
              ]}
            >
              <Ionicons name="search-outline" size={18} color={colors.textSecondary} style={styles.searchIcon} />
              <TextInput
                testID="asset-search-input"
                style={[styles.searchInput, { color: colors.text }]}
                placeholder="Search by name or code…"
                placeholderTextColor={colors.textSecondary}
                value={query}
                onChangeText={setQuery}
                autoCapitalize="none"
                autoCorrect={false}
                clearButtonMode="while-editing"
              />
              {query.length > 0 && (
                <TouchableOpacity onPress={() => setQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
                </TouchableOpacity>
              )}
            </View>

            {/* Column labels */}
            <View style={[styles.columnHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.columnLabel, { color: colors.textSecondary }]}>Asset</Text>
              <Text style={[styles.columnLabel, { color: colors.textSecondary }]}>Price / 24h</Text>
            </View>
          </>
        }
        ListEmptyComponent={
          <View style={[styles.center, { paddingVertical: 60 }]}>
            <Ionicons name="search-outline" size={48} color={colors.textSecondary} style={{ marginBottom: 12 }} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No results</Text>
            <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
              Try searching for "USDC" or "XLM"
            </Text>
          </View>
        }
        renderItem={({ item }) => <AssetItem asset={item} colors={colors} />}
      />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

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

  /* Search */
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

  /* Column header */
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

  /* Asset row */
  assetItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
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

  /* Empty / error */
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
});
