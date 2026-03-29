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
  Modal,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { transactionApi } from '../../lib/transaction';
import { Transaction, TransactionType, TransactionStatus } from '../../lib/types/transaction';

// Helper functions
function formatAmount(amount: string, assetCode: string): string {
  const num = parseFloat(amount);
  if (isNaN(num)) return '0';
  const formatted = num.toLocaleString('en-US', { 
    maximumFractionDigits: assetCode === 'XLM' ? 7 : 2 
  });
  return `${formatted} ${assetCode}`;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
  return date.toLocaleDateString();
}

function getTransactionIcon(type: TransactionType): string {
  switch (type) {
    case TransactionType.PAYMENT:
      return 'send-outline';
    case TransactionType.SWAP:
      return 'swap-horizontal-outline';
    case TransactionType.TRUSTLINE:
      return 'shield-checkmark-outline';
    case TransactionType.CREATE_ACCOUNT:
      return 'person-add-outline';
    case TransactionType.ACCOUNT_MERGE:
      return 'merge-outline';
    default:
      return 'document-text-outline';
  }
}

function getTransactionColor(type: TransactionType, colors: any): string {
  switch (type) {
    case TransactionType.PAYMENT:
      return colors.accent;
    case TransactionType.SWAP:
      return '#f7b731';
    case TransactionType.TRUSTLINE:
      return '#4ecdc4';
    default:
      return colors.textSecondary;
  }
}

function TransactionDetailModal({ 
  transaction, 
  visible, 
  onClose,
  colors 
}: { 
  transaction: Transaction | null; 
  visible: boolean; 
  onClose: () => void;
  colors: any;
}) {
  if (!transaction) return null;

  return (
    <Modal
      animationType="slide"
      transparent={true}
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Transaction Details</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          
          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={styles.detailRow}>
              <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Type</Text>
              <Text style={[styles.detailValue, { color: colors.text }]}>
                {transaction.type.toUpperCase()}
              </Text>
            </View>
            
            <View style={styles.detailRow}>
              <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Amount</Text>
              <Text style={[styles.detailValue, { color: colors.text }]}>
                {formatAmount(transaction.amount, transaction.assetCode)}
              </Text>
            </View>
            
            <View style={styles.detailRow}>
              <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>From</Text>
              <Text style={[styles.detailValue, { color: colors.text, fontSize: 12 }]}>
                {transaction.from}
              </Text>
            </View>
            
            <View style={styles.detailRow}>
              <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>To</Text>
              <Text style={[styles.detailValue, { color: colors.text, fontSize: 12 }]}>
                {transaction.to}
              </Text>
            </View>
            
            <View style={styles.detailRow}>
              <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Date</Text>
              <Text style={[styles.detailValue, { color: colors.text }]}>
                {new Date(transaction.date).toLocaleString()}
              </Text>
            </View>
            
            <View style={styles.detailRow}>
              <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Status</Text>
              <Text style={[
                styles.detailValue, 
                { color: transaction.status === TransactionStatus.SUCCESS ? '#4ecdc4' : '#ff6b6b' }
              ]}>
                {transaction.status.toUpperCase()}
              </Text>
            </View>
            
            <View style={styles.detailRow}>
              <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Transaction Hash</Text>
              <Text style={[styles.detailValue, { color: colors.text, fontSize: 11, fontFamily: 'monospace' }]}>
                {transaction.transactionHash}
              </Text>
            </View>
            
            {transaction.memo && (
              <View style={styles.detailRow}>
                <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Memo</Text>
                <Text style={[styles.detailValue, { color: colors.text }]}>
                  {transaction.memo}
                </Text>
              </View>
            )}
            
            {transaction.fee && (
              <View style={styles.detailRow}>
                <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Fee</Text>
                <Text style={[styles.detailValue, { color: colors.text }]}>
                  {parseFloat(transaction.fee) / 1000000} XLM
                </Text>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function TransactionItem({ 
  transaction, 
  onPress, 
  colors 
}: { 
  transaction: Transaction; 
  onPress: () => void;
  colors: any;
}) {
  const icon = getTransactionIcon(transaction.type);
  const iconColor = getTransactionColor(transaction.type, colors);
  const isReceived = transaction.to === transaction.from ? false : true; // Simplified logic
  
  return (
    <TouchableOpacity 
      style={[styles.transactionItem, { borderBottomColor: colors.border }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[styles.iconContainer, { backgroundColor: `${iconColor}22` }]}>
        <Ionicons name={icon as any} size={24} color={iconColor} />
      </View>
      
      <View style={styles.transactionInfo}>
        <Text style={[styles.transactionType, { color: colors.text }]}>
          {transaction.type.toUpperCase()}
        </Text>
        <Text style={[styles.transactionDate, { color: colors.textSecondary }]}>
          {formatDate(transaction.date)}
        </Text>
      </View>
      
      <View style={styles.transactionRight}>
        <Text style={[
          styles.transactionAmount, 
          { color: isReceived ? '#4ecdc4' : colors.text }
        ]}>
          {isReceived ? '+' : '-'}{formatAmount(transaction.amount, transaction.assetCode)}
        </Text>
        <View style={[
          styles.statusBadge,
          { 
            backgroundColor: transaction.status === TransactionStatus.SUCCESS 
              ? '#4ecdc422' 
              : '#ff6b6b22'
          }
        ]}>
          <Text style={[
            styles.statusText,
            { color: transaction.status === TransactionStatus.SUCCESS ? '#4ecdc4' : '#ff6b6b' }
          ]}>
            {transaction.status === TransactionStatus.SUCCESS ? '✓' : '✗'}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function TransactionHistoryScreen() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
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
    if (refresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError(null);

    try {
      const response = await transactionApi.getHistory(50, refresh ? undefined : nextPage);
      
      if (refresh) {
        setTransactions(response.transactions);
      } else {
        setTransactions(prev => [...prev, ...response.transactions]);
      }
      setNextPage(response.nextPage);
    } catch (err) {
      setError('Failed to load transactions');
      console.error(err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [nextPage]);

  useEffect(() => {
    if (isAuthenticated) {
      fetchTransactions(true);
    }
  }, [isAuthenticated]);

  const handleLoadMore = () => {
    if (nextPage && !isLoading && !isRefreshing) {
      fetchTransactions(false);
    }
  };

  const handleTransactionPress = (transaction: Transaction) => {
    setSelectedTransaction(transaction);
    setModalVisible(true);
  };

  // Auth loading state
  if (authLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  // Not authenticated
  if (!isAuthenticated) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background, padding: 32 }]}>
        <Ionicons name="lock-closed-outline" size={56} color={colors.accent} style={{ marginBottom: 20 }} />
        <Text style={[styles.emptyTitle, { color: colors.text }]}>Sign in to view transactions</Text>
        <TouchableOpacity
          style={[styles.ctaButton, { backgroundColor: colors.accent }]}
          onPress={() => router.push('/auth/login')}
          activeOpacity={0.8}
        >
          <Text style={styles.ctaButtonText}>Log In</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={transactions}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => fetchTransactions(true)}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
        ListHeaderComponent={
          <>
            <Text style={[styles.screenTitle, { color: colors.text }]}>Transaction History</Text>
            {error && (
              <View style={[styles.errorContainer, { backgroundColor: colors.danger + '22' }]}>
                <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>
                <TouchableOpacity onPress={() => fetchTransactions(true)}>
                  <Text style={[styles.retryText, { color: colors.accent }]}>Retry</Text>
                </TouchableOpacity>
              </View>
            )}
            {transactions.length === 0 && !isLoading && !error && (
              <View style={[styles.center, { paddingVertical: 60 }]}>
                <Ionicons name="receipt-outline" size={56} color={colors.textSecondary} />
                <Text style={[styles.emptyText, { color: colors.textSecondary, marginTop: 12 }]}>
                  No transactions found
                </Text>
              </View>
            )}
          </>
        }
        renderItem={({ item }) => (
          <TransactionItem 
            transaction={item} 
            onPress={() => handleTransactionPress(item)}
            colors={colors}
          />
        )}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          isLoading && !isRefreshing ? (
            <ActivityIndicator color={colors.accent} style={styles.footerLoader} />
          ) : null
        }
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    paddingBottom: 40,
  },
  screenTitle: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginHorizontal: 20,
    marginTop: 20,
    marginBottom: 16,
  },
  transactionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  transactionInfo: {
    flex: 1,
  },
  transactionType: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  transactionDate: {
    fontSize: 12,
  },
  transactionRight: {
    alignItems: 'flex-end',
  },
  transactionAmount: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 6,
  },
  statusBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusText: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  emptyText: {
    fontSize: 16,
    textAlign: 'center',
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  footerLoader: {
    marginTop: 20,
    marginBottom: 40,
  },
  ctaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 14,
    marginTop: 20,
  },
  ctaButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  errorContainer: {
    marginHorizontal: 20,
    marginBottom: 16,
    padding: 12,
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  errorText: {
    fontSize: 14,
    flex: 1,
  },
  retryText: {
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 12,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  detailRow: {
    marginBottom: 16,
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  detailValue: {
    fontSize: 14,
  },
});
