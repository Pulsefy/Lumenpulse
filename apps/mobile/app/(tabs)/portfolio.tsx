import React, { useCallback, useMemo, useState } from 'react';
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
import { useFocusEffect } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useLocalization } from '../../src/context';
import {
  portfolioApi,
  usersApi,
  AssetBalance,
  LinkedStellarAccount,
  PortfolioSummary,
} from '../../lib/api';
import { transactionApi } from '../../lib/transaction';
import { Transaction, TransactionType } from '../../lib/types/transaction';
import { useCachedData } from '../../hooks/useCachedData';
import { CACHE_CONFIGS } from '../../lib/cache';
import { useWalletAutoRefresh } from '../../hooks/useWalletAutoRefresh';
import { storage } from '../../lib/storage';

const truncateKey = (value: string) => `${value.slice(0, 6)}...${value.slice(-6)}`;

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

function AssetRow({ asset, colors, t }: { asset: AssetBalance; colors: any; t: (key: string) => string }) {
  const color = assetColor(asset.assetCode);

  return (
    <View style={[styles.assetRow, { borderBottomColor: colors.border }]} accessible accessibilityRole="listitem">
      <View style={[styles.assetIcon, { backgroundColor: `${color}22` }]} importantForAccessibility="no">
        <Text style={{ color }} importantForAccessibility="no">
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

function RecentTransactionItem({ tx, colors, t }: { tx: Transaction; colors: any; t: (key: string) => string }) {
  return (
    <View style={[styles.assetRow, { borderBottomColor: colors.border }]} accessible accessibilityRole="listitem">
      <Ionicons
        name={getTransactionIcon(tx.type) as any}
        size={20}
        color={colors.accent}
        importantForAccessibility="no"
      />
      <Text style={{ marginLeft: 10, color: colors.text }} accessible>
        {tx.type} • {formatTransactionDate(tx.date)}
      </Text>
    </View>
  );
}

function AccountSwitcher({
  accounts,
  activePublicKey,
  colors,
  onSelect,
}: {
  accounts: LinkedStellarAccount[];
  activePublicKey: string | null;
  colors: any;
  onSelect: (publicKey: string) => void;
}) {
  if (accounts.length === 0) {
    return null;
  }

  return (
    <View style={styles.switcherWrap}>
      <FlatList
        horizontal
        data={accounts}
        keyExtractor={(item) => item.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.switcherContent}
        renderItem={({ item }) => {
          const active = item.publicKey === activePublicKey;
          const label = item.label?.trim() || (item.isPrimary ? 'Primary account' : 'Tracked account');

          return (
            <TouchableOpacity
              style={[
                styles.accountChip,
                {
                  backgroundColor: active ? colors.accent : colors.surface,
                  borderColor: active ? colors.accent : colors.border,
                },
              ]}
              onPress={() => onSelect(item.publicKey)}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${label}, ${truncateKey(item.publicKey)}`}
            >
              <Ionicons
                name={active ? 'radio-button-on' : 'radio-button-off'}
                size={16}
                color={active ? '#ffffff' : colors.textSecondary}
                importantForAccessibility="no"
              />
              <View style={styles.accountChipCopy}>
                <Text style={[styles.accountChipLabel, { color: active ? '#ffffff' : colors.text }]}>
                  {label}
                </Text>
                <Text style={[styles.accountChipKey, { color: active ? '#ffffffcc' : colors.textSecondary }]}>
                  {truncateKey(item.publicKey)}
                </Text>
              </View>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

function Header({
  summary,
  activeAccount,
  colors,
}: {
  summary: PortfolioSummary;
  activeAccount: LinkedStellarAccount | null;
  colors: any;
}) {
  return (
    <View style={[styles.header, { backgroundColor: colors.surface }]} accessible>
      <Text style={{ color: colors.textSecondary }} accessible>
        {activeAccount?.label?.trim() || 'Active wallet'}
      </Text>
      <Text style={[styles.balance, { color: colors.text }]} accessible accessibilityRole="header">
        {formatUsd(summary.totalValueUsd)}
      </Text>
      {activeAccount && (
        <Text style={[styles.activeKey, { color: colors.textSecondary }]} accessible>
          {truncateKey(activeAccount.publicKey)}
        </Text>
      )}
    </View>
  );
}

export default function PortfolioScreen() {
  const { isAuthenticated } = useAuth();
  const { colors } = useTheme();
  const { t } = useLocalization();
  const [accounts, setAccounts] = useState<LinkedStellarAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [activePublicKey, setActivePublicKey] = useState<string | null>(null);
  const [accountsError, setAccountsError] = useState<string | null>(null);

  const sortedAccounts = useMemo(
    () =>
      [...accounts].sort((left, right) => {
        if (left.isPrimary && !right.isPrimary) return -1;
        if (!left.isPrimary && right.isPrimary) return 1;
        return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
      }),
    [accounts],
  );

  const activeAccount = useMemo(
    () => sortedAccounts.find((account) => account.publicKey === activePublicKey) ?? null,
    [activePublicKey, sortedAccounts],
  );

  const loadAccounts = useCallback(async () => {
    setAccountsLoading(true);
    setAccountsError(null);

    try {
      const cachedAccounts = await storage.getLinkedAccountsMetadata();
      if (cachedAccounts.length > 0) {
        setAccounts(cachedAccounts);
      }

      const response = await usersApi.getLinkedAccounts();
      const nextAccounts = response.success ? response.data ?? [] : cachedAccounts;

      if (!response.success && cachedAccounts.length === 0) {
        setAccountsError(response.error?.message ?? t('errors.couldnt_load', { item: 'accounts' }));
      }

      setAccounts(nextAccounts);
      await storage.storeLinkedAccountsMetadata(nextAccounts);

      const savedPublicKey = await storage.getActiveWalletPublicKey();
      const validSaved = nextAccounts.find((account) => account.publicKey === savedPublicKey);
      const nextActivePublicKey =
        validSaved?.publicKey ??
        nextAccounts.find((account) => account.isPrimary)?.publicKey ??
        nextAccounts[0]?.publicKey ??
        null;

      setActivePublicKey(nextActivePublicKey);
      await storage.setActiveWalletPublicKey(nextActivePublicKey);
    } finally {
      setAccountsLoading(false);
    }
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      if (isAuthenticated) {
        void loadAccounts();
      } else {
        setAccounts([]);
        setActivePublicKey(null);
        setAccountsLoading(false);
      }
    }, [isAuthenticated, loadAccounts]),
  );

  const handleSelectAccount = useCallback((publicKey: string) => {
    setActivePublicKey(publicKey);
    void storage.setActiveWalletPublicKey(publicKey);
  }, []);

  const {
    data: summary,
    loading: summaryLoading,
    refresh: refreshSummary,
    isStale: summaryStale,
    error: summaryError,
  } = useCachedData({
    key: `portfolio_summary_${activePublicKey ?? 'none'}`,
    fetcher: async () => {
      if (!activePublicKey) {
        throw new Error('No active wallet selected');
      }
      const response = await portfolioApi.getAccountSummary(activePublicKey);
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
    key: `transactions_${activePublicKey ?? 'none'}_5`,
    fetcher: async () => {
      if (!activePublicKey) {
        throw new Error('No active wallet selected');
      }
      const response = await transactionApi.getForAccount(activePublicKey, 5);
      if (response.transactions) {
        return response.transactions;
      }
      throw new Error(t('errors.couldnt_load', { item: 'transactions' }));
    },
    enabled: isAuthenticated && !!activePublicKey,
    ...CACHE_CONFIGS.TRANSACTIONS,
  });

  const transactions = transactionData || [];
  const loading = accountsLoading || summaryLoading || transactionsLoading;
  const [refreshing, setRefreshing] = useState(false);

  // Background auto-refresh: aligned to TRANSACTIONS TTL (2 min, the shorter
  // of the two) so both portfolio and transactions are refreshed before stale.
  const handleAutoRefresh = useCallback(async () => {
    if (activePublicKey) {
      await Promise.all([refreshSummary(), refreshTransactions()]);
    }
  }, [activePublicKey, refreshSummary, refreshTransactions]);

  useWalletAutoRefresh({
    intervalMs: CACHE_CONFIGS.TRANSACTIONS.ttl,
    onRefresh: handleAutoRefresh,
    enabled: isAuthenticated && !!activePublicKey,
  });

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadAccounts();
      if (activePublicKey) {
        await Promise.all([refreshSummary(), refreshTransactions()]);
      }
    } finally {
      setRefreshing(false);
    }
  }, [activePublicKey, loadAccounts, refreshSummary, refreshTransactions]);

  const isStale = summaryStale || transactionsStale;

  if (!isAuthenticated) {
    return (
      <View style={styles.center} accessible accessibilityLabel={t('portfolio.login_required')}>
        <Text style={{ color: colors.text }} accessible>{t('portfolio.login_required')}</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      {isStale && (
        <View style={[styles.staleIndicator, { backgroundColor: colors.warning + '22' }]} accessible accessibilityRole="alert" accessibilityLabel={t('portfolio.showing_cached')}>
          <Ionicons name="cloud-offline-outline" size={16} color={colors.warning} importantForAccessibility="no" />
          <Text style={[styles.staleText, { color: colors.warning }]} importantForAccessibility="no">
            {t('portfolio.showing_cached')}
          </Text>
        </View>
      )}

      <FlatList
        data={summary?.assets || []}
        keyExtractor={(item) => item.assetCode}
        ListHeaderComponent={
          sortedAccounts.length > 0 || summary || loading ? (
            <>
              <Text style={[styles.title, { color: colors.text }]} accessible accessibilityRole="header">
                {t('portfolio.title')}
              </Text>
              <AccountSwitcher
                accounts={sortedAccounts}
                activePublicKey={activePublicKey}
                colors={colors}
                onSelect={handleSelectAccount}
              />
              {summary ? (
              <Header summary={summary} activeAccount={activeAccount} colors={colors} />
              ) : sortedAccounts.length > 0 ? (
                <View style={[styles.header, styles.headerLoading, { backgroundColor: colors.surface }]}>
                  <ActivityIndicator color={colors.accent} accessibilityLabel={t('common.loading')} />
                </View>
              ) : null}

              {summary && (
                <>
                  <Text style={[styles.section, { color: colors.text }]} accessible accessibilityRole="header">
                    {t('portfolio.recent_transactions')}
                  </Text>

                  {transactions.length === 0 ? (
                    <Text style={[styles.emptyInline, { color: colors.textSecondary }]}>
                      No recent activity for this wallet.
                    </Text>
                  ) : (
                    transactions.map((tx) => (
                      <RecentTransactionItem key={tx.id} tx={tx} colors={colors} t={t} />
                    ))
                  )}
                </>
              )}
            </>
          ) : null
        }
        renderItem={({ item }) => <AssetRow asset={item} colors={colors} t={t} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} accessibilityLabel="Pull to refresh portfolio" />}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.center} accessible accessibilityLabel={t('portfolio.no_assets')}>
              <Ionicons
                name={sortedAccounts.length === 0 ? 'wallet-outline' : 'file-tray-outline'}
                size={28}
                color={colors.textSecondary}
                importantForAccessibility="no"
              />
              <Text style={[styles.emptyTitle, { color: colors.text }]} accessible>
                {sortedAccounts.length === 0 ? 'No tracked wallets' : t('portfolio.no_assets')}
              </Text>
              <Text style={[styles.emptyDescription, { color: colors.textSecondary }]} accessible>
                {accountsError ??
                  summaryError?.message ??
                  (sortedAccounts.length === 0
                    ? 'Add a wallet from Manage Accounts to track balances and activity.'
                    : 'This wallet has no balances yet. Pull to refresh after funding it.')}
              </Text>
            </View>
          ) : null
        }
        ListFooterComponent={loading ? <ActivityIndicator style={{ margin: 20 }} accessibilityLabel={t('common.loading')} /> : null}
        onEndReached={() => {
          if (!loading) console.log('pagination');
        }}
        onEndReachedThreshold={0.5}
        initialNumToRender={10}
        windowSize={5}
        removeClippedSubviews
        accessibilityLabel={t('portfolio.title')}
        accessibilityRole="list"
        accessibilityHint={t('portfolio.total_balance')}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 26, fontWeight: '700', margin: 20 },
  section: { margin: 20, fontWeight: '600' },
  switcherWrap: {
    marginBottom: 16,
  },
  switcherContent: {
    paddingHorizontal: 16,
    gap: 10,
  },
  accountChip: {
    minWidth: 178,
    maxWidth: 220,
    minHeight: 64,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  accountChipCopy: {
    flex: 1,
    minWidth: 0,
  },
  accountChipLabel: {
    fontSize: 14,
    fontWeight: '700',
  },
  accountChipKey: {
    fontSize: 12,
    marginTop: 3,
  },
  header: {
    marginHorizontal: 16,
    padding: 20,
    borderRadius: 12,
  },
  headerLoading: {
    minHeight: 116,
    justifyContent: 'center',
  },
  balance: { fontSize: 32, fontWeight: '800' },
  activeKey: {
    fontSize: 12,
    marginTop: 6,
  },
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
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginTop: 12,
  },
  emptyDescription: {
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
    paddingHorizontal: 32,
    textAlign: 'center',
  },
  emptyInline: {
    fontSize: 13,
    marginHorizontal: 20,
    marginBottom: 8,
  },
});
