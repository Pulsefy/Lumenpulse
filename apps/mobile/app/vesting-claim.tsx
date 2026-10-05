import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '../contexts/ThemeContext';
import { getDefaultWalletAdapter } from '../lib/wallet/registry';
import { requestClaimEnvelope } from '../lib/vesting-claim-envelope';
import {
  ClaimSource,
  TreasuryStream,
  VestingSchedule,
  VestingStateSummary,
  claim,
  claimReceiptRoute,
  describeMilestoneCondition,
  formatClaimAmountWithAsset,
  summarizeTreasury,
  summarizeVesting,
  toUnixSeconds,
  treasuryApi,
  vestedFraction,
  vestingApi,
  vestingEndsAt,
  vestingStateLabel,
} from '../lib/vesting';

/**
 * VestingClaimScreen (issue #1409)
 *
 * Shows the vesting schedule (or treasury stream) for the connected wallet and
 * claims what is currently unlocked.
 *
 * Route params:
 *   beneficiary – Stellar address of the beneficiary
 *   source      – 'vesting' (default) | 'treasury'
 *
 * Reached from the portfolio tab. The claim itself requires biometric step-up
 * and is signed by the wallet adapter; on success (or a wallet-reported
 * rejection/failure) the result routes to the existing transaction receipt
 * screen.
 */
export default function VestingClaimScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{
    beneficiary?: string;
    source?: string;
    contractId?: string;
  }>();

  const beneficiary = params.beneficiary ?? '';
  const contractId = params.contractId ?? '';
  const source: ClaimSource = params.source === 'treasury' ? 'treasury' : 'vesting';

  const [schedule, setSchedule] = useState<VestingSchedule | null>(null);
  const [stream, setStream] = useState<TreasuryStream | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);

  const load = useCallback(async () => {
    if (!beneficiary) {
      setError('No beneficiary address was provided.');
      return;
    }

    if (source === 'treasury') {
      const response = await treasuryApi.getStream(beneficiary);
      if (response.success && response.data) {
        setStream(response.data);
        setError(null);
      } else {
        setError(response.error?.message ?? 'No treasury stream found for this account.');
      }
      return;
    }

    const response = await vestingApi.getSchedule(beneficiary);
    if (response.success && response.data) {
      setSchedule(response.data);
      setError(null);
    } else {
      setError(response.error?.message ?? 'No vesting schedule found for this account.');
    }
  }, [beneficiary, source]);

  useEffect(() => {
    let active = true;
    (async () => {
      await load();
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [load]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const summary: VestingStateSummary | null = useMemo(() => {
    if (source === 'treasury') {
      return stream ? summarizeTreasury(stream, toUnixSeconds(new Date())) : null;
    }
    return schedule ? summarizeVesting(schedule, toUnixSeconds(new Date())) : null;
  }, [schedule, stream, source]);

  const amountLabel = summary ? formatClaimAmountWithAsset(summary.claimable) : '';
  const milestone = source === 'vesting' && schedule ? describeMilestoneCondition(schedule) : null;

  const handleClaim = useCallback(async () => {
    if (!summary?.canClaim || !beneficiary) return;

    if (!contractId) {
      Alert.alert('Claim unavailable', 'The contract address for this schedule was not provided.');
      return;
    }

    setClaiming(true);
    try {
      const adapter = await getDefaultWalletAdapter();
      const outcome = await claim({
        source,
        beneficiary,
        contractId,
        amountLabel,
        adapter,
        buildClaimXdr: requestClaimEnvelope,
      });

      const route = claimReceiptRoute(outcome, { source, amountLabel });

      if (!route) {
        // The step-up was declined: nothing was signed and there is no receipt.
        Alert.alert('Claim cancelled', 'The claim was not signed.');
        return;
      }

      if (outcome.kind === 'success' || outcome.kind === 'pending') {
        await load();
      }
      router.push(route);
    } finally {
      setClaiming(false);
    }
  }, [amountLabel, beneficiary, contractId, load, router, source, summary]);

  const range = source === 'treasury' ? stream : schedule;
  const progress = range ? Math.round(vestedFraction(range, toUnixSeconds(new Date())) * 100) : 0;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/portfolio'))}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]} accessibilityRole="header">
          {source === 'treasury' ? 'Treasury stream' : 'Vesting'}
        </Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            accessibilityLabel={
              source === 'treasury' ? 'Pull to refresh treasury stream' : 'Pull to refresh vesting schedule'
            }
          />
        }
      >
        {loading ? (
          <ActivityIndicator color={colors.accent} size="large" accessibilityLabel="Loading schedule" />
        ) : error ? (
          <View style={styles.center} accessible accessibilityRole="alert">
            <Ionicons name="cloud-offline-outline" size={48} color={colors.danger} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              Could not load this schedule
            </Text>
            <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>{error}</Text>
            <TouchableOpacity
              style={[styles.primaryButton, { backgroundColor: colors.accent }]}
              onPress={handleRefresh}
              accessibilityRole="button"
              accessibilityLabel="Retry"
            >
              <Text style={styles.primaryButtonText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {/* Claimable hero */}
            <View
              style={[
                styles.hero,
                {
                  backgroundColor: (summary?.canClaim ? colors.success : colors.surface) + '15',
                  borderColor: (summary?.canClaim ? colors.success : colors.border) + '40',
                },
              ]}
              accessible
              accessibilityLabel={
                summary?.canClaim
                  ? `${amountLabel} is claimable`
                  : `Nothing is claimable. ${summary?.reason ?? ''}`
              }
            >
              <Text style={[styles.heroLabel, { color: colors.textSecondary }]}>
                Currently claimable
              </Text>
              <Text
                style={[
                  styles.heroAmount,
                  { color: summary?.canClaim ? colors.success : colors.text },
                ]}
              >
                {summary ? formatClaimAmountWithAsset(summary.claimable) : '—'}
              </Text>
              {summary && (
                <View style={[styles.badge, { backgroundColor: colors.surface }]}>
                  <Text style={[styles.badgeText, { color: colors.textSecondary }]}>
                    {vestingStateLabel(summary.state)}
                  </Text>
                </View>
              )}
            </View>

            {/* Why nothing is claimable */}
            {summary?.reason ? (
              <View
                style={[styles.notice, { backgroundColor: colors.warning + '22' }]}
                accessible
                accessibilityRole="alert"
              >
                <Text style={[styles.noticeText, { color: colors.warning }]}>{summary.reason}</Text>
              </View>
            ) : null}

            {/* Milestone gate */}
            {milestone ? (
              <View
                style={[styles.notice, { backgroundColor: colors.accent + '22' }]}
                accessible
                accessibilityLabel={milestone}
              >
                <Text style={[styles.noticeText, { color: colors.accent }]}>{milestone}</Text>
              </View>
            ) : null}

            {/* Schedule detail */}
            {range && (
              <View
                style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
              >
                <Row
                  label="Total allocated"
                  value={formatClaimAmountWithAsset(range.totalAmount)}
                  colors={colors}
                />
                <Row
                  label="Claimed so far"
                  value={formatClaimAmountWithAsset(range.claimedAmount)}
                  colors={colors}
                />
                <Row
                  label="Remaining"
                  value={formatClaimAmountWithAsset(range.remainingAmount)}
                  colors={colors}
                />
                <Row
                  label={source === 'treasury' ? 'Unlocked' : 'Unlocked so far'}
                  value={`${progress}%`}
                  colors={colors}
                />
                <Row label="Vesting ends" value={formatDate(vestingEndsAt(range))} colors={colors} last />
              </View>
            )}

            <TouchableOpacity
              style={[
                styles.primaryButton,
                {
                  backgroundColor: summary?.canClaim ? colors.accent : colors.surface,
                  opacity: claiming ? 0.6 : 1,
                },
              ]}
              onPress={handleClaim}
              disabled={!summary?.canClaim || claiming}
              accessibilityRole="button"
              accessibilityState={{ disabled: !summary?.canClaim || claiming }}
              accessibilityLabel={
                summary?.canClaim ? `Claim ${amountLabel}` : 'Claiming is not available yet'
              }
            >
              <Text
                style={[
                  styles.primaryButtonText,
                  { color: summary?.canClaim ? '#ffffff' : colors.textSecondary },
                ]}
              >
                {claiming ? 'Claiming…' : summary?.canClaim ? `Claim ${amountLabel}` : 'Nothing to claim'}
              </Text>
            </TouchableOpacity>

            <Text style={[styles.footnote, { color: colors.textSecondary }]}>
              Claiming requires biometric confirmation and is signed by your wallet.
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

type ThemeColors = ReturnType<typeof useTheme>['colors'];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

function Row({
  label,
  value,
  colors,
  last,
}: {
  label: string;
  value: string;
  colors: ThemeColors;
  last?: boolean;
}) {
  return (
    <View
      style={[styles.row, { borderBottomColor: colors.border }, last && styles.rowLast]}
    >
      <Text style={[styles.rowLabel, { color: colors.textSecondary }]}>{label}</Text>
      <Text style={[styles.rowValue, { color: colors.text }]} selectable>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 17, fontWeight: '600' },
  content: { padding: 20, gap: 16, paddingBottom: 48 },
  center: { alignItems: 'center', gap: 8, paddingVertical: 48 },
  hero: { alignItems: 'center', borderRadius: 20, borderWidth: 1, paddingVertical: 28, gap: 10 },
  heroLabel: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.6 },
  heroAmount: { fontSize: 34, fontWeight: '800', letterSpacing: -1 },
  badge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontSize: 12, fontWeight: '700' },
  notice: { borderRadius: 12, padding: 12 },
  noticeText: { fontSize: 13, lineHeight: 19, fontWeight: '500' },
  emptyTitle: { fontSize: 18, fontWeight: '700', textAlign: 'center' },
  emptySubtitle: { fontSize: 14, textAlign: 'center', lineHeight: 20, paddingHorizontal: 16 },
  card: { borderRadius: 16, borderWidth: 1, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLast: { borderBottomWidth: 0 },
  rowLabel: { fontSize: 13, flex: 1 },
  rowValue: { fontSize: 14, fontWeight: '500', flex: 1.4, textAlign: 'right' },
  primaryButton: {
    height: 52,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  primaryButtonText: { fontSize: 16, fontWeight: '700' },
  footnote: { fontSize: 12, textAlign: 'center' },
});
