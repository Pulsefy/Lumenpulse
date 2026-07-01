import React, { useCallback, useEffect, useState } from 'react';
import { SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useLocalization } from '../../src/context';
import { transactionApi } from '../../lib/transaction';
import { Transaction, TransactionType, TransactionStatus } from '../../lib/types/transaction';
import StandardList from '@/components/StandardList';
import { CACHE_CONFIGS } from '../../lib/cache';
import { useWalletAutoRefresh } from '../../hooks/useWalletAutoRefresh';

function formatAmount(amount: string, assetCode: string): string {
  const num = parseFloat(amount);
  if (isNaN(num)) return '0';
  return `${num.toLocaleString()} ${assetCode}`;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = Math.floor((now.getTime() - date.getTime()) / 60000);

  if (diff < 60) return `${diff}m ago`;
  if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
  return date.toLocaleDateString();
}

function getTransactionIcon(type: TransactionType): string {
  switch (type) {
    case TransactionType.PAYMENT:
      return 'send-outline';
    case TransactionType.SWAP:
      return 'swap-horizontal-outline';
    case TransactionType.TRUSTLINE:
      return 'link-outline';
    case TransactionType.CREATE_ACCOUNT:
      return 'person-add-outline';
    case TransactionType.ACCOUNT_MERGE:
      return 'git-merge-outline';
    case TransactionType.INFLATION:
      return 'cash-outline';
    default:
      return 'document-text-outline';
  }
}

function TransactionItem({
  transaction,
  onPress,
  colors,
  t,
}: {
  transaction: Transaction;
  onPress: () => void;
  colors: any;
  t: (key: string) => string;
}) {
  return (
    <TouchableOpacity
      style={[styles.item, { borderBottomColor: colors.border }]}
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={`${transaction.type} • ${formatDate(transaction.date)} • ${formatAmount(transaction.amount, transaction.assetCode)}`}
      accessibilityHint={t('transactions.details_hint')}
    >
      <Ionicons
        name={getTransactionIcon(transaction.type) as any}
        size={22}
        color={colors.accent}
        accessible
        accessibilityLabel={transaction.type}
      />

      <View style={{ flex: 1, marginLeft: 10 }}>
        <Text style={{ color: colors.text }} accessible accessibilityRole="header">
          {transaction.type}
        </Text>
        <Text style={{ color: colors.textSecondary, fontSize: 12 }} accessible>
          {formatDate(transaction.date)}
        </Text>
      </View>

      <Text style={{ color: colors.text, fontWeight: '600' }} accessible>
        {formatAmount(transaction.amount, transaction.assetCode)}
      </Text>
    </TouchableOpacity>
  );
}

export default function TransactionHistoryScreen() {
  const { isAuthenticated } = useAuth();
  const { colors } = useTheme();
  const { t } = useLocalization();
  const router = useRouter();

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextPage, setNextPage] = useState<string | undefined>();

  const fetchTransactions = useCallback(
    async (refresh = false) => {
      if (refresh) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setError(null);

      try {
        const res = await transactionApi.getHistory(20, refresh ? undefined : nextPage);

        if (refresh) {
          setTransactions(res.transactions);
        } else {
          setTransactions((prev) => [...prev, ...res.transactions]);
        }

        setNextPage(res.nextPage);
      } catch {
        setError(t('errors.couldnt_load', { item: 'transactions' }));
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [nextPage, t],
  );

  useEffect(() => {
    if (isAuthenticated) fetchTransactions(true);
  }, [isAuthenticated, fetchTransactions]);

  // Background auto-refresh: aligned to TRANSACTIONS TTL (2 min).
  // fetchTransactions(true) is already error-safe and swallows network failures.
  const handleAutoRefresh = useCallback(() => fetchTransactions(true), [fetchTransactions]);

  useWalletAutoRefresh({
    intervalMs: CACHE_CONFIGS.TRANSACTIONS.ttl,
    onRefresh: handleAutoRefresh,
    enabled: isAuthenticated,
  });

  const handleLoadMore = () => {
    if (nextPage && !isLoading) fetchTransactions(false);
  };

  const handlePress = (tx: Transaction) => {
    router.push({
      pathname: '/transaction-receipt',
      params: {
        txHash: tx.transactionHash,
        status:
          tx.status === TransactionStatus.SUCCESS
            ? 'success'
            : tx.status === TransactionStatus.FAILED
              ? 'failed'
              : 'pending',
        timestamp: tx.date,
        amount: formatAmount(tx.amount, tx.assetCode),
        txType: tx.type,
      },
    });
  };

  if (!isAuthenticated) {
    return (
      <View style={styles.center}>
        <Text
          style={{ color: colors.text }}
          accessible
          accessibilityLabel={t('transactions.login_required')}
        >
          {t('transactions.login_required')}
        </Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <StandardList
        data={transactions}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TransactionItem
            transaction={item}
            onPress={() => handlePress(item)}
            colors={colors}
            t={t}
          />
        )}
        refreshing={isRefreshing}
        onRefresh={() => fetchTransactions(true)}
        loading={isLoading}
        onEndReached={handleLoadMore}
        error={error}
        onRetry={() => fetchTransactions(true)}
        ListEmptyComponent={
          <View style={{ padding: 16, alignItems: 'center' }}>
            <Text style={{ color: colors.textSecondary }}>
              {t('transactions.empty') || 'No recent transactions.'}
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
  },
});
