import React, { useCallback, useEffect, useState } from 'react';
import {
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
import { useLocalization } from '../../../src/context';
import { CrowdfundProject, OnChainStatus } from '../../../lib/crowdfund';
import { computeFundingProgress, formatTokenAmount } from '../../../lib/stellar';
import { CachedApi } from '../../../lib/cached-api';

// ── On-chain status chip ───────────────────────────────────────────────────

const STATUS_META: Record<
  OnChainStatus,
  {
    label: string;
    icon: React.ComponentProps<typeof Ionicons>['name'];
    colorKey: 'success' | 'warning' | 'danger' | 'accent' | 'textSecondary';
  }
> = {
  ACTIVE: { label: 'Active', icon: 'radio-button-on-outline', colorKey: 'success' },
  PAUSED: { label: 'Paused', icon: 'pause-circle-outline', colorKey: 'warning' },
  COMPLETED: { label: 'Completed', icon: 'checkmark-circle-outline', colorKey: 'accent' },
  CANCELLED: { label: 'Cancelled', icon: 'close-circle-outline', colorKey: 'danger' },
  PENDING: { label: 'Pending', icon: 'time-outline', colorKey: 'textSecondary' },
};

function OnChainBadge({
  status,
  colors,
}: {
  status: OnChainStatus;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  const meta = STATUS_META[status] ?? STATUS_META.PENDING;
  const color = colors[meta.colorKey] as string;

  return (
    <View
      style={[styles.badge, { backgroundColor: color + '22', borderColor: color + '44' }]}
      accessible
      accessibilityLabel={`On-chain status: ${meta.label}`}
    >
      <Ionicons name={meta.icon} size={11} color={color} />
      <Text style={[styles.badgeText, { color }]}>{meta.label}</Text>
    </View>
  );
}

// ── Progress bar ───────────────────────────────────────────────────────────

function ProgressBar({ progress, accentColor }: { progress: number; accentColor: string }) {
  return (
    <View style={styles.progressTrack} accessible accessibilityLabel={`${progress}% funded`}>
      <View
        style={[
          styles.progressFill,
          { width: `${Math.min(progress, 100)}%`, backgroundColor: accentColor },
        ]}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: progress }}
      />
    </View>
  );
}

// ── Project card ───────────────────────────────────────────────────────────

function ProjectCard({
  project,
  colors,
  onPress,
}: {
  project: CrowdfundProject;
  colors: ReturnType<typeof useTheme>['colors'];
  onPress: () => void;
}) {
  const progress = computeFundingProgress(project.totalDeposited, project.targetAmount);
  const status: OnChainStatus =
    project.onChainStatus ?? (project.isActive ? 'ACTIVE' : 'COMPLETED');

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`${project.name}, ${status}, ${progress}% funded, ${project.contributorCount} contributors`}
      accessibilityHint="Double tap to view project details"
    >
      <View style={styles.cardHeader}>
        <Text
          style={[styles.cardTitle, { color: colors.text }]}
          numberOfLines={1}
          accessible
          accessibilityRole="header"
        >
          {project.name}
        </Text>
        <OnChainBadge status={status} colors={colors} />
      </View>

      <ProgressBar progress={progress} accentColor={colors.accent} />

      <View style={styles.cardStats}>
        <View>
          <Text style={[styles.statValue, { color: colors.text }]} accessible>
            {formatTokenAmount(project.totalDeposited)} XLM
          </Text>
          <Text style={[styles.statLabel, { color: colors.textSecondary }]} accessible>
            of {formatTokenAmount(project.targetAmount)} XLM
          </Text>
        </View>
        <View style={styles.statRight}>
          <Text style={[styles.statValue, { color: colors.text }]} accessible>
            {progress}%
          </Text>
          <Text style={[styles.statLabel, { color: colors.textSecondary }]} accessible>
            funded
          </Text>
        </View>
      </View>

      <View style={styles.cardFooter}>
        <Ionicons name="people-outline" size={14} color={colors.textSecondary} />
        <Text style={[styles.footerText, { color: colors.textSecondary }]} accessible>
          {project.contributorCount} contributor{project.contributorCount !== 1 ? 's' : ''}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

// ── Main screen ────────────────────────────────────────────────────────────

export default function ProjectsScreen() {
  const { colors } = useTheme();
  const { t } = useLocalization();
  const router = useRouter();

  const [projects, setProjects] = useState<CrowdfundProject[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);

  const fetchProjects = useCallback(
    async (refresh = false) => {
      if (refresh) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setError(null);

      try {
        const response = await CachedApi.getProjects();
        if (response.success && response.data) {
          setProjects(response.data as CrowdfundProject[]);
          setFromCache(!!(response as { fromCache?: boolean }).fromCache);
        } else {
          setError(
            (response.error as { message?: string })?.message ??
              t('errors.couldnt_load', { item: 'projects' }),
          );
        }
      } catch {
        setError(t('errors.something_went_wrong'));
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [t],
  );

  useEffect(() => {
    void fetchProjects(false);
  }, [fetchProjects]);

  // ── Loading skeleton ───────────────────────────────────────────────────────

  if (isLoading && projects.length === 0) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.skeletonWrap} accessible accessibilityLabel={t('common.loading')}>
          {[1, 2, 3].map((i) => (
            <View
              key={i}
              style={[
                styles.card,
                { backgroundColor: colors.surface, borderColor: colors.cardBorder },
              ]}
              accessible
              accessibilityLabel="Loading project"
            >
              <View
                style={[
                  styles.skeleton,
                  { width: '60%', height: 18, backgroundColor: colors.border },
                ]}
              />
              <View
                style={[
                  styles.skeleton,
                  { width: '100%', height: 8, marginTop: 16, backgroundColor: colors.border },
                ]}
              />
              <View
                style={[
                  styles.skeleton,
                  { width: '40%', height: 14, marginTop: 12, backgroundColor: colors.border },
                ]}
              />
            </View>
          ))}
        </View>
      </SafeAreaView>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────────

  if (error && projects.length === 0) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background, padding: 32 }]}>
        <Ionicons
          name="cloud-offline-outline"
          size={56}
          color={colors.danger}
          style={{ marginBottom: 20 }}
          accessible
          accessibilityLabel={t('errors.couldnt_load', { item: 'projects' })}
        />
        <Text
          style={[styles.emptyTitle, { color: colors.text }]}
          accessible
          accessibilityRole="header"
        >
          {t('errors.couldnt_load', { item: 'projects' })}
        </Text>
        <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]} accessible>
          {error}
        </Text>
        <TouchableOpacity
          style={[styles.ctaButton, { backgroundColor: colors.accent }]}
          onPress={() => void fetchProjects(false)}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={t('common.retry')}
        >
          <Text style={styles.ctaButtonText} accessible>
            {t('common.retry')}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── List ───────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {fromCache && (
        <View
          style={[
            styles.offlineBanner,
            { backgroundColor: colors.surface, borderBottomColor: colors.border },
          ]}
        >
          <Ionicons name="cloud-offline-outline" size={14} color={colors.textSecondary} />
          <Text style={[styles.offlineBannerText, { color: colors.textSecondary }]}>
            Showing cached data
          </Text>
        </View>
      )}
      <FlatList
        data={projects}
        keyExtractor={(item: CrowdfundProject) => String(item.id)}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => void fetchProjects(true)}
            tintColor={colors.accent}
            colors={[colors.accent]}
            accessibilityLabel="Pull to refresh projects"
          />
        }
        renderItem={({ item }: { item: CrowdfundProject }) => (
          <ProjectCard
            project={item}
            colors={colors}
            onPress={() => router.push(`/projects/${item.id}`)}
          />
        )}
        ListEmptyComponent={
          !isLoading ? (
            <View style={[styles.center, { paddingVertical: 60 }]} accessible>
              <Ionicons
                name="rocket-outline"
                size={48}
                color={colors.textSecondary}
                style={{ marginBottom: 12 }}
                accessible
                accessibilityLabel="No projects"
              />
              <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]} accessible>
                No crowdfund projects available yet.
              </Text>
            </View>
          ) : null
        }
        accessibilityLabel="Projects list"
        accessibilityRole="list"
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
    padding: 16,
    paddingBottom: 40,
  },

  // Offline banner
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  offlineBannerText: {
    fontSize: 12,
  },

  // Card
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
    gap: 8,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '700',
    flex: 1,
  },

  // On-chain status badge
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    gap: 4,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
  },

  // Progress
  progressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
    marginBottom: 12,
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },

  // Stats
  cardStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  statRight: {
    alignItems: 'flex-end',
  },
  statValue: {
    fontSize: 15,
    fontWeight: '700',
  },
  statLabel: {
    fontSize: 12,
    marginTop: 2,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    gap: 5,
  },
  footerText: {
    fontSize: 12,
  },

  // Empty / error
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
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 14,
  },
  ctaButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },

  // Skeleton
  skeletonWrap: {
    padding: 16,
  },
  skeleton: {
    borderRadius: 6,
    opacity: 0.4,
  },
});
