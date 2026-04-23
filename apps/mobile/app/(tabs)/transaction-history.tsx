import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Modal,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { transactionApi } from '../../lib/transaction';
import { Transaction, TransactionType, TransactionStatus } from '../../lib/types/transaction';
import StandardList from "@/components/StandardList";

/* ================= Helpers ================= */

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

/* ================= Components ================= */

function TransactionItem({
  transaction,
  onPress,
  colors,
}: {
  transaction: Transaction;
  onPress: () => void;
  colors: any;
}) {
  return (
    <TouchableOpacity
      style={[styles.item, { borderBottomColor: colors.border }]}
      onPress={onPress}
    >
      <Ionicons
        name={getTransactionIcon(transaction.type) as any}
        size={22}
        color={colors.accent}
      />

      <View style={{ flex: 1, marginLeft: 10 }}>
        <Text style={{ color: colors.text }}>
          {transaction.type}
        </Text>
        <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
          {formatDate(transaction.date)}
        </Text>
      </View>

      <Text style={{ color: colors.text }}>
        {formatAmount(transaction.amount, transaction.assetCode)}
      </Text>
    </TouchableOpacity>
  );
}

function TransactionDetailModal({
  transaction,
  visible,
  onClose,
  colors,
}: any) {
  if (!transaction) return null;

  return (
    <Modal visible={visible} animationType="slide">
      <View style={[styles.modal, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.text, fontSize: 18 }}>
          Transaction Details
        </Text>

        <Text style={{ color: colors.textSecondary }}>
          {transaction.transactionHash}
        </Text>

        <TouchableOpacity onPress={onClose}>
          <Text style={{ color: colors.accent }}>Close</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

/* ================= Screen ================= */

export default function TransactionHistoryScreen() {
  const { isAuthenticated } = useAuth();
  const { colors } = useTheme();
  const router = useRouter();

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [nextPage, setNextPage] = useState<string | undefined>();

  const fetchTransactions = useCallback(async (refresh = false) => {
    refresh ? setIsRefreshing(true) : setIsLoading(true);
    setError(null);

    try {
      const res = await transactionApi.getHistory(20, refresh ? undefined : nextPage);

      if (refresh) {
        setTransactions(res.transactions);
      } else {
        setTransactions(prev => [...prev, ...res.transactions]);
      }

      setNextPage(res.nextPage);
    } catch {
      setError("Failed to load transactions");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [nextPage]);

  useEffect(() => {
    if (isAuthenticated) fetchTransactions(true);
  }, [isAuthenticated]);

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
        <Text>Please login</Text>
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
          />
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
      />
    </SafeAreaView>
  );
}

/* ================= Styles ================= */

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },

  item: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
  },

  modal: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
});