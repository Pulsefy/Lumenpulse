import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useTheme } from '../../../contexts/ThemeContext';
import {
  grantsApi,
  RoundSummary,
  ProjectQf,
  matchShare,
  roundStatusLabel,
  formatPoolAmount,
} from '../../../lib/grants';
import { formatTokenAmount } from '../../../lib/stellar';

// ── Sub-components ────────────────────────────────────────────────────────────

function InfoRow({ label, value, colors }: { label: string; value: string; colors: ReturnType<typeof useTheme>['colors'] }) {
  return (
    <View style={[styles.infoRow, { borderColor: colors.border }]}>
      <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: colors.text }]}>{value}</Text>
    </View>
  );
}

function QfBar({ share, colors }: { share: number; colors: ReturnType<typeof useTheme>['colors'] }) {
  return (
    <View style={styles.qfTrack}>
      <View style={[styles.qfFill, { width: `${share}%`, backgroundColor: colors.accent }]} />
    </View>
  );
}

function ProjectRow({
  item,
  rank,
  poolBalance,
  colors,
}: {
  item: ProjectQf;
  rank: number;
  poolBalance: string;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  const share = matchShare(item.estimatedMatch, poolBalance);
  const rankColors = ['#f59e0b', '#9ca3af', '#b45309'];
  const rankColor = rankColors[rank] ?? colors.textSecondary;

  return (
    <View style={[styles.projectCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
      <View style={styles.projectHeader}>
        <View style={[styles.rankBadge, { backgroundColor: rankColor + '22' }]}>
          <Text style={[styles.rankText, { color: rankColor }]}>#{rank + 1}</Text>
        </View>
        <Text style={[styles.projectId, { color: colors.text }]}>Project #{item.projectId}</Text>
        <Text style={[styles.matchAmount, { color: colors.accent }]}>
          ~{formatTokenAmount(item.estimatedMatch)} XLM
        </Text>
      </View>

      <QfBar share={share} colors={colors} />

      <View style={styles.projectStats}>
        <View style={styles.statItem}>
          <Text style={[styles.statVal, { color: colors.text }]}>{item.contributorCount}</Text>
          <Text style={[styles.statLbl, { color: colors.textSecondary }]}>contributors</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={[styles.statVal, { color: colors.text }]}>
            {formatTokenAmount(item.totalContributions)} XLM
          </Text>
          <Text style={[styles.statLbl, { color: colors.textSecondary }]}>contributed</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={[styles.statVal, { color: colors.text }]}>{share.toFixed(1)}%</Text>
          <Text style={[styles.statLbl, { color: colors.textSecondary }]}>of pool</Text>
        </View>
      </View>
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function GrantRoundDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const roundId = parseInt(id ?? '0', 10);

  const [summary, setSummary] = useState<RoundSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSummary = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await grantsApi.getRoundSummary(roundId);
      if (res.success && res.data) {
        setSummary(res.data);
      } else {
        setError(res.error?.message ?? 'Round not found.');
      }
    } catch {
      setError('Failed to load round details.');
    } finally {
      setIsLoading(false);
    }
  }, [roundId]);

  useEffect(() => { void fetchSummary(); }, [fetchSummary]);

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.accent} />
      </SafeAreaView>
    );
  }

  if (error || !summary) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: colors.background, padding: 32 }]}>
        <Ionicons name="alert-circle-outline" size={52} color={colors.danger} style={{ marginBottom: 16 }} />
        <Text style={[styles.errorText, { color: colors.text }]}>{error ?? 'Round not found.'}</Text>
        <TouchableOpacity
          style={[styles.retryBtn, { backgroundColor: colors.accent }]}
          onPress={() => void fetchSummary()}
        >
          <Text style={styles.retryBtnText}>Retry</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const { round, poolBalance, projects } = summary;
  const endDate = new Date(round.endTime * 1000).toLocaleDateString();
  const startDate = new Date(round.startTime * 1000).toLocaleDateString();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Header */}
        <Text style={[styles.title, { color: colors.text }]}>{round.name}</Text>
        <View style={[styles.statusChip, { backgroundColor: colors.accent + '22' }]}>
          <Text style={[styles.statusText, { color: colors.accent }]}>
            {roundStatusLabel(round.status)}
          </Text>
        </View>

        {/* Pool card */}
        <View style={[styles.poolCard, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
          <Text style={[styles.poolLabel, { color: colors.textSecondary }]}>Matching Pool</Text>
          <Text style={[styles.poolValue, { color: colors.text }]}>
            {formatTokenAmount(poolBalance)} XLM
          </Text>
          <Text style={[styles.poolSub, { color: colors.textSecondary }]}>
            Distributed proportionally via quadratic funding
          </Text>
        </View>

        {/* Round info */}
        <InfoRow label="Start" value={startDate} colors={colors} />
        <InfoRow label="End" value={endDate} colors={colors} />
        <InfoRow label="Eligible projects" value={String(projects.length)} colors={colors} />

        {/* QF explanation */}
        <View style={[styles.infoBox, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <Ionicons name="information-circle-outline" size={18} color={colors.accent} />
          <Text style={[styles.infoBoxText, { color: colors.textSecondary }]}>
            Quadratic funding rewards projects with broad community support. A project with 100
            contributors of $1 each receives more matching than one with a single $100 donor.
          </Text>
        </View>

        {/* Project allocations */}
        <Text style={[styles.sectionTitle, { color: colors.text }]}>
          Estimated Allocations
        </Text>

        {projects.length === 0 ? (
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            No eligible projects yet.
          </Text>
        ) : (
          projects.map((p, idx) => (
            <ProjectRow
              key={p.projectId}
              item={p}
              rank={idx}
              poolBalance={poolBalance}
              colors={colors}
            />
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: { padding: 20, paddingBottom: 60 },

  title: { fontSize: 26, fontWeight: '800', letterSpacing: -0.5, marginBottom: 10 },
  statusChip: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, marginBottom: 20 },
  statusText: { fontSize: 12, fontWeight: '700' },

  poolCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 20,
    marginBottom: 20,
    alignItems: 'center',
  },
  poolLabel: { fontSize: 13, marginBottom: 6 },
  poolValue: { fontSize: 32, fontWeight: '800', letterSpacing: -1, marginBottom: 6 },
  poolSub: { fontSize: 12, textAlign: 'center', lineHeight: 16 },

  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  infoLabel: { fontSize: 14 },
  infoValue: { fontSize: 14, fontWeight: '600' },

  infoBox: {
    flexDirection: 'row',
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    gap: 10,
    marginTop: 16,
    marginBottom: 24,
    alignItems: 'flex-start',
  },
  infoBoxText: { flex: 1, fontSize: 12, lineHeight: 18 },

  sectionTitle: { fontSize: 18, fontWeight: '700', marginBottom: 14 },
  emptyText: { fontSize: 14, textAlign: 'center', paddingVertical: 20 },

  projectCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
  },
  projectHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 8 },
  rankBadge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  rankText: { fontSize: 11, fontWeight: '700' },
  projectId: { flex: 1, fontSize: 15, fontWeight: '600' },
  matchAmount: { fontSize: 15, fontWeight: '700' },

  qfTrack: { height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden', marginBottom: 12 },
  qfFill: { height: '100%', borderRadius: 4 },

  projectStats: { flexDirection: 'row', justifyContent: 'space-between' },
  statItem: { alignItems: 'center' },
  statVal: { fontSize: 14, fontWeight: '700' },
  statLbl: { fontSize: 11, marginTop: 2 },

  errorText: { fontSize: 17, fontWeight: '600', textAlign: 'center', marginBottom: 16 },
  retryBtn: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  retryBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
