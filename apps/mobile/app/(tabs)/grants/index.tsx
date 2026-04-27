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
import { useTheme } from '../../../contexts/ThemeContext';
import { grantsApi, GrantRound, roundStatusLabel } from '../../../lib/grants';
import { formatTokenAmount } from '../../../lib/stellar';

function StatusBadge({
  status,
  colors,
}: {
  status: GrantRound['status'];
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  const colorMap: Record<string, string> = {
    ACTIVE: colors.accent,
    PENDING: '#f59e0b',
    ENDED: colors.textSecondary,
    FINALIZED: '#8b5cf6',
    DISTRIBUTED: '#10b981',
  };
  const bg = colorMap[status] ?? colors.textSecondary;
  return (
    <View style={[styles.badge, { backgroundColor: bg + '22' }]}>
      <Text style={[styles.badgeText, { color: bg }]}>{roundStatusLabel(status)}</Text>
    </View>
  );
}

function RoundCard({
  round,
  colors,
  onPress,
}: {
  round: GrantRound;
  colors: ReturnType<typeof useTheme>['colors'];
  onPress: () => void;
}) {
  const endDate = new Date(round.endTime * 1000).toLocaleDateString();

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      <View style={styles.cardHeader}>
        <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={1}>
          {round.name}
        </Text>
        <StatusBadge status={round.status} colors={colors} />
      </View>

      <View style={styles.poolRow}>
        <Ionicons name="wallet-outline" size={16} color={colors.accent} />
        <Text style={[styles.poolLabel, { color: colors.textSecondary }]}>Matching Pool</Text>
        <Text style={[styles.poolAmount, { color: colors.text }]}>
          {formatTokenAmount(round.totalPool)} XLM
        </Text>
      </View>

      <View style={styles.cardFooter}>
        <Ionicons name="calendar-outline" size={13} color={colors.textSecondary} />
        <Text style={[styles.footerText, { color: colors.textSecondary }]}>Ends {endDate}</Text>
        <Ionicons
          name="chevron-forward"
          size={14}
          color={colors.textSecondary}
          style={{ marginLeft: 'auto' }}
        />
      </View>
    </TouchableOpacity>
  );
}

export default function GrantsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const [rounds, setRounds] = useState<GrantRound[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRounds = useCallback(async (refresh = false) => {
    if (refresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError(null);
    try {
      const res = await grantsApi.listRounds();
      if (res.success && res.data) {
        setRounds(res.data);
      } else {
        setError(res.error?.message ?? 'Failed to load rounds.');
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchRounds();
  }, [fetchRounds]);

  if (isLoading && rounds.length === 0) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.accent} />
      </SafeAreaView>
    );
  }

  if (error && rounds.length === 0) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: colors.background, padding: 32 }]}>
        <Ionicons
          name="cloud-offline-outline"
          size={52}
          color={colors.danger}
          style={{ marginBottom: 16 }}
        />
        <Text style={[styles.emptyTitle, { color: colors.text }]}>Couldn&apos;t load rounds</Text>
        <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>{error}</Text>
        <TouchableOpacity
          style={[styles.retryBtn, { backgroundColor: colors.accent }]}
          onPress={() => void fetchRounds()}
        >
          <Text style={styles.retryBtnText}>Retry</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={rounds}
        keyExtractor={(r) => String(r.id)}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => void fetchRounds(true)}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={[styles.heading, { color: colors.text }]}>Grants Rounds</Text>
            <Text style={[styles.subheading, { color: colors.textSecondary }]}>
              Quadratic funding — breadth of support determines matching
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <RoundCard
            round={item}
            colors={colors}
            onPress={() => router.push(`/grants/${item.id}`)}
          />
        )}
        ListEmptyComponent={
          <View style={[styles.center, { paddingVertical: 60 }]}>
            <Ionicons
              name="trophy-outline"
              size={48}
              color={colors.textSecondary}
              style={{ marginBottom: 12 }}
            />
            <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
              No active grant rounds yet.
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { padding: 16, paddingBottom: 40 },
  header: { marginBottom: 20 },
  heading: { fontSize: 24, fontWeight: '800', letterSpacing: -0.5, marginBottom: 4 },
  subheading: { fontSize: 13, lineHeight: 18 },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 18,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  cardTitle: { fontSize: 17, fontWeight: '700', flex: 1, marginRight: 8 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { fontSize: 11, fontWeight: '600' },
  poolRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 14 },
  poolLabel: { fontSize: 13, flex: 1 },
  poolAmount: { fontSize: 15, fontWeight: '700' },
  cardFooter: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  footerText: { fontSize: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '600', marginBottom: 8, textAlign: 'center' },
  emptySubtitle: { fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  retryBtn: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  retryBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
