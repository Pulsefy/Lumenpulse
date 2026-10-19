import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { useLocalization } from '../../src/context';
import { useWatchlist } from '../../contexts/WatchlistContext';
import { WatchlistItem } from '../../lib/watchlist';

function assetColor(symbol: string): string {
  const palette = ['#db74cf', '#7a85ff', '#4ecdc4', '#f7b731', '#ff6b6b', '#a29bfe', '#fd79a8', '#00b894'];
  let hash = 0;
  for (let i = 0; i < symbol.length; i++) hash = symbol.charCodeAt(i) + ((hash << 5) - hash);
  return palette[Math.abs(hash) % palette.length];
}

function formatPrice(usd: number | null | undefined): string {
  if (usd == null) return '\u2014';
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

function WatchlistItemRow({
  item,
  colors,
  t,
  onRemove,
  isRolledBack,
}: {
  item: WatchlistItem;
  colors: any;
  t: (key: string, params?: any) => string;
  onRemove: (item: WatchlistItem) => void;
  isRolledBack: boolean;
}) {
  const color = assetColor(item.symbol);

  return (
    <View
      style={[styles.itemRow, { borderBottomColor: colors.border }]}
      accessible
      accessibilityRole="button"
      accessibilityLabel={`${item.name || item.symbol}`}
    >
      <View style={[styles.itemIcon, { backgroundColor: `${color}22` }]}>
        <Text style={[styles.itemIconText, { color }]}>{item.symbol.charAt(0)}</Text>
      </View>

      <View style={styles.itemMeta}>
        <Text style={[styles.itemSymbol, { color: colors.text }]} numberOfLines={1}>
          {item.symbol}
        </Text>
        {item.name && (
          <Text style={[styles.itemName, { color: colors.textSecondary }]} numberOfLines={1}>
            {item.name}
          </Text>
        )}
      </View>

      {item.notes && (
        <Text style={[styles.itemNotes, { color: colors.textSecondary }]} numberOfLines={1}>
          {item.notes}
        </Text>
      )}

      {isRolledBack && (
        <Ionicons name="refresh-outline" size={16} color={colors.warning} style={{ marginRight: 8 }} />
      )}

      <TouchableOpacity
        onPress={() => onRemove(item)}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        style={styles.removeButton}
        accessibilityRole="button"
        accessibilityLabel={t('watchlist.remove')}
      >
        <Ionicons name="trash-outline" size={18} color={colors.danger} />
      </TouchableOpacity>
    </View>
  );
}

export default function WatchlistScreen() {
  const { colors } = useTheme();
  const { t } = useLocalization();
  const { items, isLoading, error, refresh, toggleItem, syncState, isInWatchlist } = useWatchlist();
  const [refreshing, setRefreshing] = useState(false);
  const [removingSymbol, setRemovingSymbol] = useState<string | null>(null);

  const sortedItems = useMemo(
    () => [...items].sort((a, b) => a.sortOrder - b.sortOrder),
    [items],
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  };

  const handleRemove = async (item: WatchlistItem) => {
    setRemovingSymbol(item.symbol);
    try {
      await toggleItem({
        symbol: item.symbol,
        type: item.type,
        name: item.name || undefined,
        assetIssuer: item.assetIssuer || undefined,
      });
    } finally {
      setRemovingSymbol(null);
    }
  };

  const hasConflict = syncState.conflictSymbols.length > 0;
  const hasRollback = syncState.rollbackSymbols.length > 0;
  const hasPending = syncState.pendingCount > 0;

  if (isLoading && items.length === 0) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.center, { flex: 1 }]}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={sortedItems}
        keyExtractor={(item) => `${item.symbol}_${item.type}_${item.id}`}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            accessibilityLabel={t('common.refresh')}
          />
        }
        ListHeaderComponent={
          <>
            <Text
              style={[styles.screenTitle, { color: colors.text }]}
              accessible
              accessibilityRole="header"
            >
              {t('watchlist.title')}
            </Text>

            {hasConflict && (
              <View
                style={[styles.banner, { backgroundColor: colors.danger + '22' }]}
                accessible
                accessibilityRole="alert"
              >
                <Ionicons name="warning-outline" size={16} color={colors.danger} />
                <Text style={[styles.bannerText, { color: colors.danger }]}>
                  {t('watchlist.conflict_banner')}
                </Text>
              </View>
            )}

            {hasRollback && (
              <View
                style={[styles.banner, { backgroundColor: colors.warning + '22' }]}
                accessible
                accessibilityRole="alert"
              >
                <Ionicons name="refresh-outline" size={16} color={colors.warning} />
                <Text style={[styles.bannerText, { color: colors.warning }]}>
                  {t('watchlist.rollback_banner')}
                </Text>
              </View>
            )}

            {hasPending && (
              <View
                style={[styles.banner, { backgroundColor: colors.warning + '22' }]}
                accessible
                accessibilityRole="alert"
              >
                <Ionicons name="sync-outline" size={16} color={colors.warning} />
                <Text style={[styles.bannerText, { color: colors.warning }]}>
                  {t('watchlist.syncing_banner')}
                </Text>
              </View>
            )}

            {syncState.lastSyncedAt && (
              <Text style={[styles.syncMeta, { color: colors.textSecondary }]}>
                {t('watchlist.last_synced', {
                  time: new Date(syncState.lastSyncedAt).toLocaleTimeString(),
                })}
              </Text>
            )}
          </>
        }
        ListEmptyComponent={
          !isLoading ? (
            <View style={[styles.center, { paddingVertical: 60 }]}>
              <Ionicons
                name="star-outline"
                size={48}
                color={colors.textSecondary}
                style={{ marginBottom: 12 }}
              />
              <Text
                style={[styles.emptyTitle, { color: colors.text }]}
                accessibilityRole="header"
              >
                {t('watchlist.empty_title')}
              </Text>
              <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
                {t('watchlist.empty_subtitle')}
              </Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <WatchlistItemRow
            item={item}
            colors={colors}
            t={t}
            onRemove={handleRemove}
            isRolledBack={syncState.rollbackSymbols.includes(item.symbol)}
          />
        )}
        accessibilityLabel={t('watchlist.title')}
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
    marginBottom: 8,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 8,
    gap: 6,
  },
  bannerText: { fontSize: 13, fontWeight: '500', flex: 1 },
  syncMeta: { fontSize: 11, marginHorizontal: 20, marginBottom: 12 },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  itemIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  itemIconText: { fontSize: 18, fontWeight: '700' },
  itemMeta: { flex: 1, marginRight: 8 },
  itemSymbol: { fontSize: 16, fontWeight: '700', marginBottom: 2 },
  itemName: { fontSize: 13 },
  itemNotes: { fontSize: 12, maxWidth: 100, marginRight: 8 },
  removeButton: { padding: 4 },
  emptyTitle: { fontSize: 18, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 32,
  },
});
