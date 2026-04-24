import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { portfolioApi, AssetBalance, PortfolioSummary } from '../../lib/api';
import { transactionApi } from '../../lib/transaction';
import { Transaction, TransactionType } from '../../lib/types/transaction';
import { useCachedData } from '../../hooks/useCachedData';
import { CACHE_CONFIGS } from '../../lib/cache';

/* ================= Helpers ================= */

function formatUsd(value: string | number): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '$0.00';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(num);
}

function formatAmount(amount: string): string {
  const num = parseFloat(amount);
  if (isNaN(num)) return '0';
  return num.toLocaleString('en-US', { maximumFractionDigits: 6 });
}

function formatTransactionDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return `${diff} days ago`;
  return date.toLocaleDateString();
}

function getTransactionIcon(type: TransactionType): string {
  switch (type) {
    case TransactionType.PAYMENT:
      return 'send-outline';
    case TransactionType.SWAP:
      return 'swap-horizontal-outline';
    default:
      return 'document-text-outline';
  }
}

function assetColor(code: string): string {
  const palette = ['#db74cf', '#7a85ff', '#4ecdc4', '#f7b731', '#ff6b6b'];
  let hash = 0;
  for (let i = 0; i < code.length; i++) hash = code.charCodeAt(i) + ((hash << 5) - hash);
  return palette[Math.abs(hash) % palette.length];
}

/* ================= Components ================= */

function AssetRow({ asset, colors }: { asset: AssetBalance; colors: any }) {
  const color = assetColor(asset.assetCode);

  return (
    <View style={[styles.assetRow, { borderBottomColor: colors.border }]}>
      <View style={[styles.assetIcon, { backgroundColor: `${color}22` }]}>
        <Text style={{ color }}>{asset.assetCode[0]}</Text>
      </View>

      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text }}>{asset.assetCode}</Text>
        <Text style={{ color: colors.textSecondary }}>{formatAmount(asset.amount)}</Text>
      </View>

      <Text style={{ color: colors.text }}>{formatUsd(asset.valueUsd)}</Text>
    </View>
  );
}

function RecentTransactionItem({ tx, colors }: { tx: Transaction; colors: any }) {
  return (
    <View style={[styles.assetRow, { borderBottomColor: colors.border }]}>
      <Ionicons name={getTransactionIcon(tx.type) as any} size={20} color={colors.accent} />
      <Text style={{ marginLeft: 10, color: colors.text }}>
        {tx.type} • {formatTransactionDate(tx.date)}
      </Text>
    </View>
  );
}

function Header({ summary, colors }: { summary: PortfolioSummary; colors: any }) {
  return (
    <View style={[styles.header, { backgroundColor: colors.surface }]}>
      <Text style={{ color: colors.textSecondary }}>Total Balance</Text>
      <Text style={[styles.balance, { color: colors.text }]}>
        {formatUsd(summary.totalValueUsd)}
      </Text>
    </View>
  );
}

/* ================= Screen ================= */

export default function PortfolioScreen() {
  const { isAuthenticated } = useAuth();
  const { colors } = useTheme();

  // Use cached data for portfolio summary
  const {
    data: summary,
    loading: summaryLoading,
    refresh: refreshSummary,
    isStale: summaryStale,
  } = useCachedData({
    key: `portfolio_summary_default`,
    fetcher: async () => {
      const response = await portfolioApi.getSummary();
      if (response.success && response.data) {
        return response.data;
      }
      throw new Error(response.error?.message || 'Failed to fetch portfolio');
    },
    enabled: isAuthenticated,
    ...CACHE_CONFIGS.PORTFOLIO,
  });

  // Use cached data for transactions
  const {
    data: transactionData,
    loading: transactionsLoading,
    refresh: refreshTransactions,
    isStale: transactionsStale,
  } = useCachedData({
    key: `transactions_default_5`,
    fetcher: async () => {
      const response = await transactionApi.getHistory(5);
      if (response.transactions) {
        return response.transactions;
      }
      throw new Error('Failed to fetch transactions');
    },
    enabled: isAuthenticated,
    ...CACHE_CONFIGS.TRANSACTIONS,
  });

  const transactions = transactionData || [];
  const loading = summaryLoading && transactionsLoading;
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([refreshSummary(), refreshTransactions()]);
    } finally {
      setRefreshing(false);
    }
  }, [refreshSummary, refreshTransactions]);

  // Show stale data indicator
  const isStale = summaryStale || transactionsStale;

  //if (!isAuthenticated) {
  //return (
  //<View style={styles.center}>
  //<Text>Login required</Text>
  //</View>
  //);
  //}

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Stale data indicator */}
      {isStale && (
        <View style={[styles.staleIndicator, { backgroundColor: colors.warning + '22' }]}>
          <Ionicons name="cloud-offline-outline" size={16} color={colors.warning} />
          <Text style={[styles.staleText, { color: colors.warning }]}>
            Showing cached data - Pull to refresh
          </Text>
        </View>
      )}

      <FlatList
        data={summary?.assets || []}
        keyExtractor={(item) => item.assetCode}
        ListHeaderComponent={
          summary && (
            <>
              <Text style={[styles.title, { color: colors.text }]}>Portfolio</Text>
              <Header summary={summary} colors={colors} />

              <Text style={[styles.section, { color: colors.text }]}>Recent Transactions</Text>

              {transactions.map((tx) => (
                <RecentTransactionItem key={tx.id} tx={tx} colors={colors} />
              ))}
            </>
          )
        }
        renderItem={({ item }) => <AssetRow asset={item} colors={colors} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.center}>
              <Text>No assets</Text>
            </View>
          ) : null
        }
        ListFooterComponent={loading ? <ActivityIndicator style={{ margin: 20 }} /> : null}
        onEndReached={() => {
          if (!loading) console.log('pagination');
        }}
        onEndReachedThreshold={0.5}
        initialNumToRender={10}
        windowSize={5}
        removeClippedSubviews
      />
    </SafeAreaView>
  );
}

/* ================= Styles ================= */

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 26, fontWeight: '700', margin: 20 },
  section: { margin: 20, fontWeight: '600' },

  header: {
    marginHorizontal: 16,
    padding: 20,
    borderRadius: 12,
  },
  balance: { fontSize: 32, fontWeight: '800' },

  assetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
  },

  assetIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },

  staleIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 8,
  },
  staleText: {
    fontSize: 12,
    fontWeight: '500',
    marginLeft: 6,
  },
});
