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
import { useLocalization } from '../../../src/context';
import {
  grantsApi,
  RoundSummary,
  ProjectQf,
  matchShare,
  roundStatusLabel,
} from '../../../lib/grants';
import { formatTokenAmount } from '../../../lib/stellar';

function InfoRow({
  label,
  value,
  colors,
}: {
  label: string;
  value: string;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  return (
    <View style={[styles.infoRow, { borderColor: colors.border }]} accessible>
      <Text style={[styles.infoLabel, { color: colors.textSecondary }]} accessible>
        {label}
      </Text>
      <Text style={[styles.infoValue, { color: colors.text }]} accessible>
        {value}
      </Text>
    </View>
  );
}

function QfBar({ share, colors }: { share: number; colors: ReturnType<typeof useTheme>['colors'] }) {
  return (
    <View style={styles.qfTrack} accessible accessibilityLabel={`${share.toFixed(1)}% of pool`}>
      <View
        style={[styles.qfFill, { width: `${share}%`, backgroundColor: colors.accent }]}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: share }}
      />
    </View>
  );
}

function ProjectRow({
  item,
  rank,
  poolBalance,
  colors,
  t,
}: {
  item: ProjectQf;
  rank: number;
  poolBalance: string;
  colors: ReturnType<typeof useTheme>['colors'];
  t: (key: string) => string;
}) {
  const share = matchShare(item.estimatedMatch, poolBalance);
  const rankColors = ['#f59e0b', '#9ca3af', '#b45309'];
  const rankColor = rankColors[rank] ?? colors.textSecondary;

  return (
    <View
      style={[styles.projectCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
      accessible
      accessibilityLabel={`${t('grants.project')} ${item.projectId}, ${item.contributorCount} ${t('grants.contributors')}, ${formatTokenAmount(item.totalContributions)} XLM contributed`}
    >
      <View style={styles.projectHeader}>
        <View style={[styles.rankBadge, { backgroundColor: rankColor + '22' }]} accessible>
          <Text style={[styles.rankText, { color: rankColor }]} accessible>
            #{rank + 1}
          </Text>
        </View>
        <Text style={[styles.projectId, { color: colors.text }]} accessible accessibilityRole="header">
          {t('grants.project')} #{item.projectId}
        </Text>
        <Text style={[styles.matchAmount, { color: colors.accent }]} accessible>
          ~{formatTokenAmount(item.estimatedMatch)} XLM
        </Text>
      </View>

      <QfBar share={share} colors={colors} />

      <View style={styles.projectStats}>
        <View style={styles.statItem}>
          <Text style={[styles.statVal, { color: colors.text }]} accessible>
            {item.contributorCount}
          </Text>
          <Text style={[styles.statLbl, { color: colors.textSecondary }]} accessible>
            {t('grants.contributors')}
          </Text>
        </View>
        <View style={styles.statItem}>
          <Text style={[styles.statVal, { color: colors.text }]} accessible>
            {formatTokenAmount(item.totalContributions)} XLM
          </Text>
          <Text style={[styles.statLbl, { color: colors.textSecondary }]} accessible>
            {t('grants.contributed')}
          </Text>
        </View>
        <View style={styles.statItem}>
          <Text style={[styles.statVal, { color: colors.text }]} accessible>
            {share.toFixed(1)}%
          </Text>
          <Text style={[styles.statLbl, { color: colors.textSecondary }]} accessible>
            {t('grants.of_pool')}
          </Text>
        </View>
      </View>
    </View>
  );
}

export default function GrantRoundDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const { t } = useLocalization();
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
        setError(res.error?.message ?? t('errors.couldnt_load', { item: 'round' }));
      }
    } catch {
      setError(t('errors.something_went_wrong'));
    } finally {
      setIsLoading(false);
    }
  }, [roundId, t]);

  useEffect(() => {
    void fetchSummary();
  }, [fetchSummary]);

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator
          size="large"
          color={colors.accent}
          accessible
          accessibilityLabel={t('common.loading')}
        />
      </SafeAreaView>
    );
  }

  if (error || !summary) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: colors.background, padding: 32 }]}>
        <Ionicons
          name="alert-circle-outline"
          size={52}
          color={colors.danger}
          style={{ marginBottom: 16 }}
          accessible
          accessibilityLabel={t('errors.error')}
        />
        <Text style={[styles.errorText, { color: colors.text }]} accessible accessibilityRole="alert">
          {error ?? t('errors.couldnt_load', { item: 'round' })}
        </Text>
        <TouchableOpacity
          style={[styles.retryBtn, { backgroundColor: colors.accent }]}
          onPress={() => void fetchSummary()}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={t('common.retry')}
        >
          <Text style={styles.retryBtnText} accessible>{t('common.retry')}</Text>
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
        <Text style={[styles.title, { color: colors.text }]} accessible accessibilityRole="header">
          {round.name}
        </Text>
        <View style={[styles.statusChip, { backgroundColor: colors.accent + '22' }]} accessible>
          <Text style={[styles.statusText, { color: colors.accent }]} accessible>
            {roundStatusLabel(round.status, t)}
          </Text>
        </View>

        <View
          style={[
            styles.poolCard,
            { backgroundColor: colors.surface, borderColor: colors.cardBorder },
          ]}
          accessible
          accessibilityLabel={`${t('grants.matching_pool')}: ${formatTokenAmount(poolBalance)} XLM`}
        >
          <Text style={[styles.poolLabel, { color: colors.textSecondary }]} accessible>
            {t('grants.matching_pool')}
          </Text>
          <Text style={[styles.poolValue, { color: colors.text }]} accessible>
            {formatTokenAmount(poolBalance)} XLM
          </Text>
          <Text style={[styles.poolSub, { color: colors.textSecondary }]} accessible>
            {t('grants.qf_explanation')}
          </Text>
        </View>

        <InfoRow label={t('grants.start')} value={startDate} colors={colors} />
        <InfoRow label={t('grants.end')} value={endDate} colors={colors} />
        <InfoRow label={t('grant_detail.eligible_projects')} value={String(projects.length)} colors={colors} />

        <View
          style={[styles.infoBox, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
          accessible
        >
          <Ionicons name="information-circle-outline" size={18} color={colors.accent} />
          <Text style={[styles.infoBoxText, { color: colors.textSecondary }]} accessible>
            {t('grants.qf_explanation')}
          </Text>
        </View>

        <Text style={[styles.sectionTitle, { color: colors.text }]} accessible accessibilityRole="header">
          {t('grant_detail.estimated_allocations')}
        </Text>

        {projects.length === 0 ? (
          <Text style={[styles.emptyText, { color: colors.textSecondary }]} accessible>
            {t('grants.no_rounds')}
          </Text>
        ) : (
          projects.map((p, idx) => (
            <ProjectRow
              key={p.projectId}
              item={p}
              rank={idx}
              poolBalance={poolBalance}
              colors={colors}
              t={t}
            />
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

    } catch {
      setError(t('errors.something_went_wrong'));
    } finally {
      setIsLoading(false);
    }
  }, [roundId, t]);

  useEffect(() => {
    void fetchSummary();
  }, [fetchSummary]);

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator
          size="large"
          color={colors.accent}
          accessible
          accessibilityLabel={t('common.loading')}
        />
      </SafeAreaView>
    );
  }

  if (error || !summary) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: colors.background, padding: 32 }]}>
        <Ionicons
          name="alert-circle-outline"
          size={52}
          color={colors.danger}
          style={{ marginBottom: 16 }}
          accessible
          accessibilityLabel={t('errors.error')}
        />
        <Text style={[styles.errorText, { color: colors.text }]} accessible accessibilityRole="alert">
          {error ?? t('errors.couldnt_load', { item: 'round' })}
        </Text>
        <TouchableOpacity
          style={[styles.retryBtn, { backgroundColor: colors.accent }]}
          onPress={() => void fetchSummary()}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={t('common.retry')}
        >
          <Text style={styles.retryBtnText} accessible>{t('common.retry')}</Text>
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
        <Text style={[styles.title, { color: colors.text }]} accessible accessibilityRole="header">
          {round.name}
        </Text>
        <View style={[styles.statusChip, { backgroundColor: colors.accent + '22' }]} accessible>
          <Text style={[styles.statusText, { color: colors.accent }]} accessible>
            {roundStatusLabel(round.status, t)}
          </Text>
        </View>

        {/* Pool card */}
        <View
          style={[
            styles.poolCard,
            { backgroundColor: colors.surface, borderColor: colors.cardBorder },
          ]}
          accessible
          accessibilityLabel={`${t('grants.matching_pool')}: ${formatTokenAmount(poolBalance)} XLM`}
        >
          <Text style={[styles.poolLabel, { color: colors.textSecondary }]} accessible>
            {t('grants.matching_pool')}
          </Text>
          <Text style={[styles.poolValue, { color: colors.text }]} accessible>
            {formatTokenAmount(poolBalance)} XLM
          </Text>
          <Text style={[styles.poolSub, { color: colors.textSecondary }]} accessible>
            {t('grants.qf_explanation')}
          </Text>
        </View>

        {/* Round info */}
        <InfoRow label={t('grants.start')} value={startDate} colors={colors} />
        <InfoRow label={t('grants.end')} value={endDate} colors={colors} />
        <InfoRow label={t('grant_detail.eligible_projects')} value={String(projects.length)} colors={colors} />

        {/* QF explanation */}
        <View
          style={[styles.infoBox, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
          accessible
        >
          <Ionicons name="information-circle-outline" size={18} color={colors.accent} />
          <Text style={[styles.infoBoxText, { color: colors.textSecondary }]} accessible>
            {t('grants.qf_explanation')}
          </Text>
        </View>

        {/* Project allocations */}
        <Text style={[styles.sectionTitle, { color: colors.text }]} accessible accessibilityRole="header">
          {t('grant_detail.estimated_allocations')}
        </Text>

        {projects.length === 0 ? (
          <Text style={[styles.emptyText, { color: colors.textSecondary }]} accessible>
            {t('grants.no_projects')}
          </Text>
        ) : (
          projects.map((p, idx) => (
            <ProjectRow
              key={p.projectId}
              item={p}
              rank={idx}
              poolBalance={poolBalance}
              colors={colors}
              t={t}
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
  statusChip: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    marginBottom: 20,
  },
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
  qfTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
    marginBottom: 12,
  },
  qfFill: { height: '100%', borderRadius: 4 },
  projectStats: { flexDirection: 'row', justifyContent: 'space-between' },
  statItem: { alignItems: 'center' },
  statVal: { fontSize: 14, fontWeight: '700' },
  statLbl: { fontSize: 11, marginTop: 2 },
  errorText: { fontSize: 17, fontWeight: '600', textAlign: 'center', marginBottom: 16 },
  retryBtn: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  retryBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
