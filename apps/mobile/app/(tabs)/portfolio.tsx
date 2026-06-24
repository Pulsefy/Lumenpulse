import React, { useCallback, useEffect, useState } from 'react';
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
import { useRouter } from 'expo-router';
import AccountSwitcher from '../../components/AccountSwitcher';
import { useAuth } from '../../contexts/AuthContext';
import { useTrackedWallet } from '../../contexts/TrackedWalletContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useLocalization } from '../../src/context';
import { portfolioApi, AssetBalance, PortfolioSummary } from '../../lib/api';
import { transactionApi } from '../../lib/transaction';
import { Transaction, TransactionType } from '../../lib/types/transaction';
import { useCachedData } from '../../hooks/useCachedData';
import { CACHE_CONFIGS } from '../../lib/cache';

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

function AssetRow({ asset, colors }: { asset: AssetBalance; colors: any }) {
  const color = assetColor(asset.assetCode);

  return (
    <View style={[styles.assetRow, { borderBottomColor: colors.border }]} accessible>
      <View style={[styles.assetIcon, { backgroundColor: `${color}22` }]} accessible>
        <Text style={{ color }} accessible>
          {asset.assetCode[0]}
        </Text>
      </View>

      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text }} accessible accessibilityRole="header">
          {asset.assetCode}
        </Text>
        <Text style={{ color: colors.textSecondary }} accessible>
          {formatAmount(asset.amount)}
        </Text>
      </View>

      <Text style={{ color: colors.text }} accessible>
        {formatUsd(asset.valueUsd)}
      </Text>
    </View>
  );
}

function RecentTransactionItem({ tx, colors }: { tx: Transaction; colors: any }) {
  return (
    <View style={[styles.assetRow, { borderBottomColor: colors.border }]} accessible>
      <Ionicons
        name={getTransactionIcon(tx.type) as any}
        size={20}
        color={colors.accent}
        accessible
        accessibilityLabel={tx.type}
      />
      <Text style={{ marginLeft: 10, color: colors.text }} accessible>
        {tx.type} • {formatTransactionDate(tx.date)}
      </Text>
    </View>
  );
}

function Header({
  summary,
  colors,
  t,
}: {
  summary: PortfolioSummary;
  colors: any;
  t: (key: string) => string;
}) {
  return (
    <View style={[styles.header, { backgroundColor: colors.surface }]} accessible>
      <Text style={{ color: colors.textSecondary }} accessible>
        {t('portfolio.total_balance')}
      </Text>
      <Text style={[styles.balance, { color: colors.text }]} accessible accessibilityRole="header">
        {formatUsd(summary.totalValueUsd)}
      </Text>
    </View>
  );
}

export default function PortfolioScreen() {
  const { isAuthenticated } = useAuth();
  const { colors } = useTheme();
  const { t } = useLocalization();
  const router = useRouter();
  const {
    linkedAccounts,
    activeAccount,
    activePublicKey,
    isLoading: walletsLoading,
    isSwitching,
    switchAccount,
    refreshAccounts,
  } = useTrackedWallet();

  const accountCacheKey = activePublicKey ?? 'none';

  const {
    data: summary,
    loading: summaryLoading,
    refresh: refreshSummary,
    isStale: summaryStale,
  } = useCachedData({
    key: `portfolio_summary_${accountCacheKey}`,
    fetcher: async () => {
      const response = await portfolioApi.getSummary();
      if (response.success && response.data) {
        return response.data;
      }
      throw new Error(response.error?.message || t('errors.couldnt_load', { item: 'portfolio' }));
    },
    enabled: isAuthenticated && !!activePublicKey,
    ...CACHE_CONFIGS.PORTFOLIO,
  });

  const {
    data: transactionData,
    loading: transactionsLoading,
    refresh: refreshTransactions,
    isStale: transactionsStale,
  } = useCachedData({
    key: `transactions_${accountCacheKey}_5`,
    fetcher: async () => {
      if (!activePublicKey) {
        return [];
      }

      const response = await transactionApi.getForAccount(activePublicKey, 5);
      return response.transactions ?? [];
    },
    enabled: isAuthenticated && !!activePublicKey,
    ...CACHE_CONFIGS.TRANSACTIONS,
  });

  const transactions = transactionData || [];
  const loading = walletsLoading || (summaryLoading && transactionsLoading);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (activePublicKey) {
      void refreshSummary();
      void refreshTransactions();
    }
  }, [activePublicKey, refreshSummary, refreshTransactions]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (activePublicKey) {
        try {
          await portfolioApi.createSnapshot();
        } catch {
          // Non-fatal: summary fetch below still returns the latest stored snapshot.
        }
      }
      await Promise.all([refreshAccounts(), refreshSummary(), refreshTransactions()]);
    } finally {
      setRefreshing(false);
    }
  }, [activePublicKey, refreshAccounts, refreshSummary, refreshTransactions]);

  const isStale = summaryStale || transactionsStale;

  if (!isAuthenticated) {
    return (
      <View style={styles.center} accessible accessibilityLabel={t('portfolio.login_required')}>
        <Text style={{ color: colors.text }} accessible>
          {t('portfolio.login_required')}
        </Text>
      </View>
    );
  }

  const hasLinkedAccounts = linkedAccounts.length > 0;
  const showPortfolioData = hasLinkedAccounts && !!activePublicKey;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      {isStale && showPortfolioData && (
        <View
          style={[styles.staleIndicator, { backgroundColor: colors.warning + '22' }]}
          accessible
        >
          <Ionicons name="cloud-offline-outline" size={16} color={colors.warning} />
          <Text style={[styles.staleText, { color: colors.warning }]} accessible>
            {t('portfolio.showing_cached')}
          </Text>
        </View>
      )}

      <FlatList
        data={showPortfolioData ? summary?.assets || [] : []}
        keyExtractor={(item, index) => `${item.assetCode}-${index}`}
        ListHeaderComponent={
          <>
            <Text
              style={[styles.title, { color: colors.text }]}
              accessible
              accessibilityRole="header"
            >
              {t('portfolio.title')}
            </Text>

            <AccountSwitcher
              accounts={linkedAccounts}
              activeAccount={activeAccount}
              isLoading={walletsLoading}
              isSwitching={isSwitching}
              onSelectAccount={switchAccount}
            />

            {!hasLinkedAccounts && !walletsLoading ? (
              <View style={styles.centerSection} accessible>
                <TouchableOpacity
                  style={[styles.linkButton, { backgroundColor: colors.accent }]}
                  onPress={() => router.push('/settings/manage-accounts')}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel={t('portfolio.link_account')}
                >
                  <Ionicons name="link-outline" size={16} color="#ffffff" />
                  <Text style={styles.linkButtonText}>{t('portfolio.link_account')}</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {showPortfolioData && summary ? (
              <>
                <Header summary={summary} colors={colors} t={t} />
                <Text
                  style={[styles.section, { color: colors.text }]}
                  accessible
                  accessibilityRole="header"
                >
                  {t('portfolio.recent_transactions')}
                </Text>
                {transactions.length === 0 && !transactionsLoading ? (
                  <View style={styles.emptyActivity} accessible>
                    <Ionicons name="time-outline" size={20} color={colors.textSecondary} />
                    <Text style={{ color: colors.textSecondary }} accessible>
                      {t('portfolio.no_activity')}
                    </Text>
                  </View>
                ) : (
                  transactions.map((tx) => (
                    <RecentTransactionItem key={tx.id} tx={tx} colors={colors} />
                  ))
                )}
              </>
            ) : null}
          </>
        }
        renderItem={({ item }) => <AssetRow asset={item} colors={colors} />}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            accessibilityLabel="Pull to refresh portfolio"
          />
        }
        ListEmptyComponent={
          showPortfolioData && !loading ? (
            <View style={styles.centerSection} accessible accessibilityLabel="Portfolio empty">
              <Ionicons name="wallet-outline" size={40} color={colors.textSecondary} />
              <Text style={{ color: colors.text }} accessible>
                {t('portfolio.no_assets')}
              </Text>
              <Text style={{ color: colors.textSecondary, textAlign: 'center' }} accessible>
                {t('portfolio.no_assets_hint')}
              </Text>
            </View>
          ) : null
        }
        ListFooterComponent={
          loading ? (
            <ActivityIndicator style={{ margin: 20 }} accessibilityLabel={t('common.loading')} />
          ) : null
        }
        accessibilityLabel={t('portfolio.title')}
        accessibilityRole="list"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  centerSection: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 28,
    gap: 8,
  },
  title: { fontSize: 26, fontWeight: '700', margin: 20, marginBottom: 8 },
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
  emptyActivity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  linkButton: {
    minHeight: 42,
    borderRadius: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  linkButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
});
