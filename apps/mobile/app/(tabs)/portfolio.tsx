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
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { portfolioApi, AssetBalance, PortfolioSummary } from '../../lib/api';

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
  // Show up to 6 decimal places but trim trailing zeros
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

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function PortfolioScreen() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { colors } = useTheme();
  const router = useRouter();

  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSummary = useCallback(async (triggeredByRefresh = false) => {
    if (triggeredByRefresh) {
      setIsRefreshing(true);
      // Trigger a live Stellar snapshot first so we get fresh balances
      try {
        const { portfolioApi: pa } = await import('../../lib/api');
        await pa.createSnapshot();
      } catch {
        // Non-fatal — summary fetch below will still return the latest stored snapshot
      }
    } else {
      setIsLoading(true);
    }
    setError(null);

    try {
      const { portfolioApi: pa } = await import('../../lib/api');
      const response = await pa.getSummary();
      if (response.success && response.data) {
        setSummary(response.data);
      } else {
        setError(response.error?.message ?? 'Failed to load portfolio.');
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
      void fetchSummary(false);
    }
  }, [isAuthenticated, fetchSummary]);

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
          onPress={() => void fetchSummary(false)}
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

  // ── Populated portfolio ─────────────────────────────────────────────────────
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={summary?.assets ?? []}
        keyExtractor={(item, index) => `${item.assetCode}-${index}`}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => void fetchSummary(true)}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
        ListHeaderComponent={
          <>
            <Text style={[styles.screenTitle, { color: colors.text }]}>Portfolio</Text>
            {summary && <TotalBalanceHeader summary={summary} colors={colors} />}
            {summary && summary.assets.length > 0 && (
              <View style={[styles.assetsSectionHeader, { borderBottomColor: colors.border }]}>
                <Text style={[styles.assetsSectionLabel, { color: colors.textSecondary }]}>Assets</Text>
                <Text style={[styles.assetsSectionLabel, { color: colors.textSecondary }]}>Value</Text>
              </View>
            )}
          </>
        }
        ListEmptyComponent={
          !isLoading ? (
            <View style={[styles.center, { paddingVertical: 40 }]}>
              <Ionicons name="wallet-outline" size={48} color={colors.textSecondary} style={{ marginBottom: 12 }} />
              <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
                No assets found in this account.
              </Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => <AssetRow asset={item} colors={colors} />}
        ItemSeparatorComponent={() => null}
      />
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

  /* Asset list section header */
  assetsSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  assetsSectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
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
    marginBottom: 28,
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