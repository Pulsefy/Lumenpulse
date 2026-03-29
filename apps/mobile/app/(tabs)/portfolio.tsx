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
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { portfolioApi, AssetBalance, PortfolioSummary } from '../../lib/api';
import { transactionApi } from '../../lib/transaction';
import { Transaction, TransactionType, TransactionStatus } from '../../lib/types/transaction';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatUsd(value: string | number): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '$0.00';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

function formatAmount(amount: string): string {
  const num = parseFloat(amount);
  if (isNaN(num)) return '0';
  return num.toLocaleString('en-US', { maximumFractionDigits: 6 });
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  return date.toLocaleDateString();
}

function formatTransactionDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString();
}

function formatTransactionAmount(amount: string, assetCode: string): string {
  const num = parseFloat(amount);
  if (isNaN(num)) return '0';
  return `${num.toLocaleString()} ${assetCode}`;
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

// Returns a stable accent color for an asset code
function assetColor(code: string): string {
  const palette = ['#db74cf', '#7a85ff', '#4ecdc4', '#f7b731', '#ff6b6b', '#a29bfe'];
  let hash = 0;
  for (let i = 0; i < code.length; i++) hash = code.charCodeAt(i) + ((hash << 5) - hash);
  return palette[Math.abs(hash) % palette.length];
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TotalBalanceHeader({
  summary,
  colors,
}: {
  summary: PortfolioSummary;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  return (
    <View style={[styles.headerCard, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
      <Text style={[styles.headerLabel, { color: colors.textSecondary }]}>Total Balance</Text>
      <Text style={[styles.headerBalance, { color: colors.text }]}>
        {formatUsd(summary.totalValueUsd)}
      </Text>
      {summary.lastUpdated && (
        <View style={styles.updatedRow}>
          <Ionicons name="time-outline" size={12} color={colors.textSecondary} />
          <Text style={[styles.updatedText, { color: colors.textSecondary }]}>
            {' '}Updated {formatRelativeTime(summary.lastUpdated)}
          </Text>
        </View>
      )}
    </View>
  );
}

function AssetRow({
  asset,
  colors,
}: {
  asset: AssetBalance;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  const color = assetColor(asset.assetCode);
  return (
    <View style={[styles.assetRow, { borderBottomColor: colors.border }]}>
      <View style={[styles.assetIcon, { backgroundColor: `${color}22` }]}>
        <Text style={[styles.assetIconText, { color }]}>
          {asset.assetCode.charAt(0)}
        </Text>
      </View>
      <View style={styles.assetInfo}>
        <Text style={[styles.assetCode, { color: colors.text }]}>{asset.assetCode}</Text>
        <Text style={[styles.assetAmount, { color: colors.textSecondary }]}>
          {formatAmount(asset.amount)} {asset.assetCode}
        </Text>
      </View>
      <View style={styles.assetValue}>
        <Text style={[styles.assetUsd, { color: colors.text }]}>
          {formatUsd(asset.valueUsd)}
        </Text>
      </View>
    </View>
  );
}

function RecentTransactionItem({
  transaction,
  onPress,
  colors,
}: {
  transaction: Transaction;
  onPress: () => void;
  colors: any;
}) {
  const icon = getTransactionIcon(transaction.type);
  const iconColor = getTransactionColor(transaction.type, colors);
  const isReceived = transaction.to.includes(transaction.from) ? false : true;
  
  return (
    <TouchableOpacity 
      style={[styles.recentTransactionItem, { borderBottomColor: colors.border }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[styles.recentIconContainer, { backgroundColor: `${iconColor}22` }]}>
        <Ionicons name={icon as any} size={20} color={iconColor} />
      </View>
      
      <View style={styles.recentTransactionInfo}>
        <Text style={[styles.recentTransactionType, { color: colors.text }]}>
          {transaction.type.charAt(0).toUpperCase() + transaction.type.slice(1)}
        </Text>
        <Text style={[styles.recentTransactionDate, { color: colors.textSecondary }]}>
          {formatTransactionDate(transaction.date)}
        </Text>
      </View>
      
      <View style={styles.recentTransactionRight}>
        <Text style={[
          styles.recentTransactionAmount,
          { color: isReceived ? '#4ecdc4' : colors.text }
        ]}>
          {isReceived ? '+' : '-'}{formatTransactionAmount(transaction.amount, transaction.assetCode)}
        </Text>
        <View style={[
          styles.recentStatusBadge,
          { 
            backgroundColor: transaction.status === TransactionStatus.SUCCESS 
              ? '#4ecdc422' 
              : '#ff6b6b22'
          }
        ]}>
          <Text style={[
            styles.recentStatusText,
            { color: transaction.status === TransactionStatus.SUCCESS ? '#4ecdc4' : '#ff6b6b' }
          ]}>
            {transaction.status === TransactionStatus.SUCCESS ? '✓' : '✗'}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function PortfolioScreen() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { colors } = useTheme();
  const router = useRouter();

  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [recentTransactions, setRecentTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (triggeredByRefresh = false) => {
    if (triggeredByRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError(null);

    try {
      // Fetch portfolio summary
      const { portfolioApi: pa } = await import('../../lib/api');
      const portfolioResponse = await pa.getSummary();
      if (portfolioResponse.success && portfolioResponse.data) {
        setSummary(portfolioResponse.data);
      } else {
        setError(portfolioResponse.error?.message ?? 'Failed to load portfolio.');
      }

      // Fetch recent transactions (last 5)
      try {
        const transactionsResponse = await transactionApi.getHistory(5);
        if (transactionsResponse.transactions) {
          setRecentTransactions(transactionsResponse.transactions.slice(0, 5));
        }
      } catch (txError) {
        console.log('Failed to fetch transactions:', txError);
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      void fetchData(false);
    }
  }, [isAuthenticated, fetchData]);

  const handleViewAllTransactions = () => {
    router.push('/(tabs)/transaction-history');
  };

  const handleTransactionPress = (transaction: Transaction) => {
    // Navigate to transaction detail or show modal
    router.push({
      pathname: '/(tabs)/transaction-history',
      params: { transactionId: transaction.id }
    });
  };

  // ── Auth loading ────────────────────────────────────────────────────────────
  if (authLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  // ── Not authenticated ───────────────────────────────────────────────────────
  if (!isAuthenticated) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background, padding: 32 }]}>
        <Ionicons name="lock-closed-outline" size={56} color={colors.accent} style={{ marginBottom: 20 }} />
        <Text style={[styles.emptyTitle, { color: colors.text }]}>Sign in to view your portfolio</Text>
        <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
          Track your Stellar assets and total balance in one place.
        </Text>
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

  // ── Data loading (first load) ───────────────────────────────────────────────
  if (isLoading && !summary) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={[styles.screenTitle, { color: colors.text }]}>Portfolio</Text>
        <View style={[styles.headerCard, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
          <View style={[styles.skeleton, { width: 120, height: 16, marginBottom: 12, backgroundColor: colors.border }]} />
          <View style={[styles.skeleton, { width: 180, height: 36, marginBottom: 8, backgroundColor: colors.border }]} />
          <View style={[styles.skeleton, { width: 100, height: 12, backgroundColor: colors.border }]} />
        </View>
        {[1, 2, 3].map((i) => (
          <View
            key={i}
            style={[styles.assetRow, { borderBottomColor: colors.border }]}
          >
            <View style={[styles.skeleton, { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.border }]} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <View style={[styles.skeleton, { width: 60, height: 14, marginBottom: 6, backgroundColor: colors.border }]} />
              <View style={[styles.skeleton, { width: 100, height: 12, backgroundColor: colors.border }]} />
            </View>
            <View style={[styles.skeleton, { width: 70, height: 18, backgroundColor: colors.border }]} />
          </View>
        ))}
      </SafeAreaView>
    );
  }

  // ── Error state ─────────────────────────────────────────────────────────────
  if (error && !summary) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background, padding: 32 }]}>
        <Ionicons name="cloud-offline-outline" size={56} color={colors.danger} style={{ marginBottom: 20 }} />
        <Text style={[styles.emptyTitle, { color: colors.text }]}>Couldn't load portfolio</Text>
        <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>{error}</Text>
        <TouchableOpacity
          style={[styles.ctaButton, { backgroundColor: colors.accent }]}
          onPress={() => void fetchData(false)}
          activeOpacity={0.8}
        >
          <Text style={styles.ctaButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── No linked account ───────────────────────────────────────────────────────
  if (summary && !summary.hasLinkedAccount) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={[styles.screenTitle, { color: colors.text }]}>Portfolio</Text>
        <View style={[styles.center, { flex: 1, padding: 32 }]}>
          <Ionicons name="briefcase-outline" size={56} color={colors.accent} style={{ marginBottom: 20 }} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No linked accounts</Text>
          <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
            Link a Stellar account to start tracking your assets and balances in real time.
          </Text>
          <TouchableOpacity
            style={[styles.ctaButton, { backgroundColor: colors.accent }]}
            onPress={() => router.push('/settings')}
            activeOpacity={0.8}
          >
            <Ionicons name="link-outline" size={18} color="#fff" style={{ marginRight: 6 }} />
            <Text style={styles.ctaButtonText}>Link an Account</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Populated portfolio with recent transactions ─────────────────────────────
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => void fetchData(true)}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.screenTitle, { color: colors.text }]}>Portfolio</Text>
        
        {summary && <TotalBalanceHeader summary={summary} colors={colors} />}
        
        {/* Assets Section */}
        {summary && summary.assets.length > 0 && (
          <>
            <View style={[styles.sectionHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Assets</Text>
            </View>
            {summary.assets.map((asset, index) => (
              <AssetRow key={`${asset.assetCode}-${index}`} asset={asset} colors={colors} />
            ))}
          </>
        )}

        {/* Recent Transactions Section */}
        {recentTransactions.length > 0 && (
          <>
            <View style={[styles.sectionHeader, { borderBottomColor: colors.border, marginTop: 24 }]}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Recent Transactions</Text>
              <TouchableOpacity onPress={handleViewAllTransactions}>
                <Text style={[styles.viewAllText, { color: colors.accent }]}>View All</Text>
              </TouchableOpacity>
            </View>
            {recentTransactions.map((transaction) => (
              <RecentTransactionItem
                key={transaction.id}
                transaction={transaction}
                onPress={() => handleTransactionPress(transaction)}
                colors={colors}
              />
            ))}
          </>
        )}

        {/* No transactions placeholder */}
        {recentTransactions.length === 0 && !isLoading && summary?.hasLinkedAccount && (
          <View style={[styles.center, { paddingVertical: 40 }]}>
            <Ionicons name="receipt-outline" size={48} color={colors.textSecondary} style={{ marginBottom: 12 }} />
            <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
              No transactions yet
            </Text>
            <Text style={[styles.emptySubSubtitle, { color: colors.textSecondary }]}>
              Your transactions will appear here
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  screenTitle: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginHorizontal: 20,
    marginTop: 20,
    marginBottom: 16,
  },

  /* Total balance card */
  headerCard: {
    marginHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  headerLabel: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  headerBalance: {
    fontSize: 38,
    fontWeight: '800',
    letterSpacing: -1,
    marginBottom: 10,
  },
  updatedRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  updatedText: {
    fontSize: 12,
  },

  /* Section Header */
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  viewAllText: {
    fontSize: 14,
    fontWeight: '600',
  },

  /* Asset row */
  assetRow: {
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
  assetIconText: {
    fontSize: 18,
    fontWeight: '700',
  },
  assetInfo: {
    flex: 1,
  },
  assetCode: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 2,
  },
  assetAmount: {
    fontSize: 13,
  },
  assetValue: {
    alignItems: 'flex-end',
  },
  assetUsd: {
    fontSize: 15,
    fontWeight: '600',
  },

  /* Recent Transaction Styles */
  recentTransactionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  recentIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  recentTransactionInfo: {
    flex: 1,
  },
  recentTransactionType: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  recentTransactionDate: {
    fontSize: 11,
  },
  recentTransactionRight: {
    alignItems: 'flex-end',
  },
  recentTransactionAmount: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 4,
  },
  recentStatusBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  recentStatusText: {
    fontSize: 10,
    fontWeight: 'bold',
  },

  /* Empty / error states */
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 12,
    paddingHorizontal: 12,
  },
  emptySubSubtitle: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 12,
  },
  ctaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 5,
  },
  ctaButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },

  /* Loading skeleton */
  skeleton: {
    borderRadius: 6,
    opacity: 0.4,
  },
});