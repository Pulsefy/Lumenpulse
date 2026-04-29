import React, { useCallback, useEffect, useState } from 'react';
import { SafeAreaView, StyleSheet, Text, TouchableOpacity, View, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useLocalization } from '../../src/context';
import { transactionApi } from '../../lib/transaction';
import { Transaction, TransactionType } from '../../lib/types/transaction';
import StandardList from '@/components/StandardList';

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

function TransactionDetailModal({ transaction, visible, onClose, colors, t }: any) {
  if (!transaction) return null;

  return (
    <Modal visible={visible} animationType="slide" accessibilityViewIsModal={true}>
      <View style={[styles.modal, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.text, fontSize: 18 }} accessible accessibilityRole="header">
          {t('transactions.details')}
        </Text>

        <Text style={{ color: colors.textSecondary, marginTop: 16 }} accessible>
          {t('transactions.hash')}
        </Text>
        <Text
          style={{ color: colors.text, fontSize: 12, marginTop: 4 }}
          selectable
          accessible
          accessibilityLabel={transaction.transactionHash}
        >
          {transaction.transactionHash}
        </Text>

        <Text style={{ color: colors.textSecondary, marginTop: 16 }} accessible>
          {t('transactions.type')}
        </Text>
        <Text style={{ color: colors.text, marginTop: 4 }} accessible>
          {transaction.type}
        </Text>

        <Text style={{ color: colors.textSecondary, marginTop: 16 }} accessible>
          {t('transactions.amount')}
        </Text>
        <Text style={{ color: colors.text, marginTop: 4 }} accessible>
          {formatAmount(transaction.amount, transaction.assetCode)}
        </Text>

        <Text style={{ color: colors.textSecondary, marginTop: 16 }} accessible>
          {t('transactions.date')}
        </Text>
        <Text style={{ color: colors.text, marginTop: 4 }} accessible>
          {new Date(transaction.date).toLocaleString()}
        </Text>

        <TouchableOpacity
          onPress={onClose}
          style={[styles.modalButton, { backgroundColor: colors.accent }]}
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
        >
          <Text style={styles.modalButtonText} accessible>{t('common.close')}</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

export default function TransactionHistoryScreen() {
  const { isAuthenticated } = useAuth();
  const { colors } = useTheme();
  const { t } = useLocalization();

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
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

  const handleLoadMore = () => {
    if (nextPage && !isLoading) fetchTransactions(false);
  };

  const handlePress = (tx: Transaction) => {
    setSelectedTransaction(tx);
    setModalVisible(true);
  };

  if (!isAuthenticated) {
    return (
      <View style={styles.center}>
        <Text style={{ color: colors.text }} accessible accessibilityLabel={t('transactions.login_required')}>
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
          <TransactionItem transaction={item} onPress={() => handlePress(item)} colors={colors} t={t} />
        )}
        refreshing={isRefreshing}
        onRefresh={() => fetchTransactions(true)}
        loading={isLoading}
        onEndReached={handleLoadMore}
        error={error}
        onRetry={() => fetchTransactions(true)}
      />

      <TransactionDetailModal
        transaction={selectedTransaction}
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        colors={colors}
        t={t}
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
  modal: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalButton: {
    marginTop: 20,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  modalButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
});
