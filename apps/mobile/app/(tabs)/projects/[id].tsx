import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../../contexts/AuthContext';
import { useTheme } from '../../../contexts/ThemeContext';
import {
  crowdfundApi,
  CrowdfundProject,
  ContributorSummary,
  RoadmapMilestone,
} from '../../../lib/crowdfund';
import { computeFundingProgress, formatTokenAmount } from '../../../lib/stellar';
import ContributionModal from '../../../components/ContributionModal';
import { usersApi } from '../../../lib/api';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BANNER_PALETTE = ['#8B5CF6', '#DB74CF', '#3B82F6', '#10B981', '#F59E0B', '#EF4444'];

function getBannerColor(id: number): string {
  return BANNER_PALETTE[Math.abs(id) % BANNER_PALETTE.length];
}

function formatRelativeTime(isoString: string): string {
  const diffSec = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({
  title,
  icon,
  colors,
}: {
  title: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  return (
    <View style={styles.sectionHeader}>
      <Ionicons name={icon} size={14} color={colors.accent} />
      <Text style={[styles.sectionTitle, { color: colors.accent }]}>{title.toUpperCase()}</Text>
    </View>
  );
}

function StatCard({
  icon,
  label,
  value,
  colors,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  return (
    <View
      style={[styles.statCard, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}
    >
      <Ionicons name={icon} size={22} color={colors.accent} style={{ marginBottom: 8 }} />
      <Text style={[styles.statValue, { color: colors.text }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.textSecondary }]}>{label}</Text>
    </View>
  );
}

function RoadmapItem({
  milestone,
  colors,
  isLast,
}: {
  milestone: RoadmapMilestone;
  colors: ReturnType<typeof useTheme>['colors'];
  isLast: boolean;
}) {
  const done = milestone.status === 'completed';
  const active = milestone.status === 'active';

  return (
    <View style={styles.milestoneRow}>
      <View style={styles.milestoneLeft}>
        <View
          style={[
            styles.milestoneIcon,
            {
              backgroundColor: done ? colors.accent : active ? colors.accent + '22' : 'transparent',
              borderColor: done || active ? colors.accent : colors.border,
            },
          ]}
        >
          {done ? <Ionicons name="checkmark" size={11} color="#fff" /> : null}
          {active ? <View style={[styles.activeDot, { backgroundColor: colors.accent }]} /> : null}
        </View>
        {!isLast ? (
          <View style={[styles.milestoneLine, { backgroundColor: colors.border }]} />
        ) : null}
      </View>
      <View style={[styles.milestoneBody, isLast ? { paddingBottom: 0 } : null]}>
        <View style={styles.milestoneTitleRow}>
          <Text style={[styles.milestoneTitle, { color: colors.text }]}>{milestone.title}</Text>
          <View
            style={[
              styles.milestoneBadge,
              {
                backgroundColor: done ? '#10B98118' : active ? colors.accent + '1A' : colors.border,
              },
            ]}
          >
            <Text
              style={[
                styles.milestoneBadgeText,
                { color: done ? '#10B981' : active ? colors.accent : colors.textSecondary },
              ]}
            >
              {done ? 'Done' : active ? 'Active' : 'Soon'}
            </Text>
          </View>
        </View>
        {milestone.description ? (
          <Text style={[styles.milestoneDesc, { color: colors.textSecondary }]}>
            {milestone.description}
          </Text>
        ) : null}
        {milestone.targetDate ? (
          <Text style={[styles.milestoneDate, { color: colors.textSecondary }]}>
            {milestone.targetDate}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function ContributorRow({
  item,
  colors,
  isLast,
}: {
  item: ContributorSummary;
  colors: ReturnType<typeof useTheme>['colors'];
  isLast: boolean;
}) {
  const addr = item.contributor;
  const short = addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
  const initial = addr.length > 1 ? addr.charAt(1).toUpperCase() : '?';

  return (
    <View
      style={[
        styles.contributorRow,
        !isLast
          ? { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }
          : null,
      ]}
    >
      <View style={[styles.contributorAvatar, { backgroundColor: colors.accent + '18' }]}>
        <Text style={[styles.contributorInitial, { color: colors.accent }]}>{initial}</Text>
      </View>
      <View style={styles.contributorInfo}>
        <Text style={[styles.contributorAddress, { color: colors.text }]}>{short}</Text>
        <Text style={[styles.contributorTime, { color: colors.textSecondary }]}>
          {formatRelativeTime(item.lastContributionAt)}
        </Text>
      </View>
      <Text style={[styles.contributorAmount, { color: colors.accent }]}>
        +{formatTokenAmount(item.totalAmount)} XLM
      </Text>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function ProjectDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const { isAuthenticated } = useAuth();
  const router = useRouter();
  const { top: safeTop, bottom: safeBottom } = useSafeAreaInsets();

  const [project, setProject] = useState<CrowdfundProject | null>(null);
  const [contributors, setContributors] = useState<ContributorSummary[]>([]);
  const [roadmap, setRoadmap] = useState<RoadmapMilestone[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showContributeModal, setShowContributeModal] = useState(false);
  const [stellarPublicKey, setStellarPublicKey] = useState<string | null>(null);

  const projectId = parseInt(id ?? '0', 10);
  const progressAnim = useRef(new Animated.Value(0)).current;

  const fetchAll = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    const [projectRes, contributorsRes, roadmapRes] = await Promise.allSettled([
      crowdfundApi.getProject(projectId),
      crowdfundApi.getContributors(projectId),
      crowdfundApi.getRoadmap(projectId),
    ]);

    if (projectRes.status === 'fulfilled' && projectRes.value.success && projectRes.value.data) {
      setProject(projectRes.value.data);
    } else if (projectRes.status === 'fulfilled') {
      setError(projectRes.value.error?.message ?? 'Project not found.');
    } else {
      setError('Failed to load project details.');
    }

    if (
      contributorsRes.status === 'fulfilled' &&
      contributorsRes.value.success &&
      contributorsRes.value.data
    ) {
      setContributors(contributorsRes.value.data);
    }

    if (roadmapRes.status === 'fulfilled' && roadmapRes.value.success && roadmapRes.value.data) {
      setRoadmap(roadmapRes.value.data);
    }

    setIsLoading(false);
  }, [projectId]);

  const fetchUserPublicKey = useCallback(async () => {
    try {
      const response = await usersApi.getProfile();
      if (response.success && response.data?.stellarPublicKey) {
        setStellarPublicKey(response.data.stellarPublicKey);
      }
    } catch {
      // Non-critical — user may not have a linked account yet
    }
  }, []);

  useEffect(() => {
    void fetchAll();
    if (isAuthenticated) {
      void fetchUserPublicKey();
    }
  }, [fetchAll, fetchUserPublicKey, isAuthenticated]);

  // Animate the progress bar once data is loaded
  useEffect(() => {
    if (project) {
      const pct = computeFundingProgress(project.totalDeposited, project.targetAmount);
      Animated.spring(progressAnim, {
        toValue: pct,
        useNativeDriver: false,
        damping: 15,
        stiffness: 80,
      }).start();
    }
  }, [project, progressAnim]);

  const handleContribute = async (
    amount: string,
  ): Promise<{ transactionHash?: string; errorMessage?: string }> => {
    if (!stellarPublicKey) {
      return { errorMessage: 'No Stellar account linked. Please link one in Settings first.' };
    }

    try {
      const response = await crowdfundApi.contribute({
        projectId,
        amount,
        senderPublicKey: stellarPublicKey,
      });

      if (response.success && response.data) {
        void fetchAll();
        if (response.data.status === 'SUCCESS') {
          return { transactionHash: response.data.transactionHash };
        }
        return { errorMessage: response.data.message || 'Transaction did not confirm.' };
      }

      return { errorMessage: response.error?.message || 'Contribution failed.' };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error. Please try again.';
      return { errorMessage: message };
    }
  };

  // ── Floating back button (shared across all states) ───────────────────────
  const BackButton = ({ tint = '#ffffff', bg = 'rgba(0,0,0,0.45)' }) => (
    <TouchableOpacity
      style={[styles.floatingBack, { top: safeTop + 12, backgroundColor: bg }]}
      onPress={() => router.back()}
      activeOpacity={0.8}
    >
      <Ionicons name="chevron-back" size={20} color={tint} />
    </TouchableOpacity>
  );

  // ── Loading ──────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <BackButton tint={colors.text} bg={colors.card} />
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────
  if (error || !project) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background, padding: 32 }]}>
        <BackButton tint={colors.text} bg={colors.card} />
        <Ionicons
          name="alert-circle-outline"
          size={56}
          color={colors.danger}
          style={{ marginBottom: 16 }}
        />
        <Text style={[styles.errorTitle, { color: colors.text }]}>
          {error || 'Project not found.'}
        </Text>
        <TouchableOpacity
          style={[styles.retryButton, { backgroundColor: colors.accent }]}
          onPress={() => void fetchAll()}
          activeOpacity={0.8}
        >
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const progress = computeFundingProgress(project.totalDeposited, project.targetAmount);
  const remaining = Math.max(
    parseFloat(project.targetAmount) - parseFloat(project.totalDeposited),
    0,
  );
  const bannerColor = getBannerColor(project.id);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: Math.max(safeBottom, 16) + 80 }}
      >
        {/* ── Hero Banner ───────────────────────────────────────────────── */}
        <View style={styles.bannerContainer}>
          {project.imageUrl ? (
            <Image
              source={{ uri: project.imageUrl }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              transition={300}
            />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: bannerColor }]}>
              <Text style={styles.bannerWatermark}>{project.name.charAt(0).toUpperCase()}</Text>
            </View>
          )}

          {/* Gradient overlay with title */}
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.82)']}
            style={styles.bannerGradient}
          >
            <Text style={styles.bannerTitle} numberOfLines={2}>
              {project.name}
            </Text>
            <View style={styles.bannerBadgeRow}>
              <View
                style={[
                  styles.statusBadge,
                  {
                    backgroundColor: project.isActive
                      ? 'rgba(16,185,129,0.25)'
                      : 'rgba(239,68,68,0.25)',
                  },
                ]}
              >
                <View
                  style={[
                    styles.statusDot,
                    { backgroundColor: project.isActive ? '#10B981' : '#EF4444' },
                  ]}
                />
                <Text
                  style={[
                    styles.statusBadgeText,
                    { color: project.isActive ? '#10B981' : '#EF4444' },
                  ]}
                >
                  {project.isActive ? 'Active' : 'Closed'}
                </Text>
              </View>
            </View>
          </LinearGradient>
        </View>

        {/* ── Content ──────────────────────────────────────────────────── */}
        <View style={styles.content}>
          {/* Funding Progress */}
          <View
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.cardBorder },
            ]}
          >
            <View style={styles.fundingTopRow}>
              <View>
                <Text style={[styles.fundingRaised, { color: colors.text }]}>
                  {formatTokenAmount(project.totalDeposited)} XLM
                </Text>
                <Text style={[styles.fundingRaisedLabel, { color: colors.textSecondary }]}>
                  raised
                </Text>
              </View>
              <View style={styles.fundingPctBlock}>
                <Text style={[styles.fundingPct, { color: colors.accent }]}>{progress}%</Text>
                <Text style={[styles.fundingPctLabel, { color: colors.textSecondary }]}>
                  funded
                </Text>
              </View>
            </View>

            {/* Animated progress bar */}
            <View style={styles.progressTrack}>
              <Animated.View
                style={[
                  styles.progressFill,
                  {
                    width: progressAnim.interpolate({
                      inputRange: [0, 100],
                      outputRange: ['0%', '100%'],
                      extrapolate: 'clamp',
                    }),
                    backgroundColor: colors.accent,
                  },
                ]}
              />
            </View>

            <Text style={[styles.fundingGoal, { color: colors.textSecondary }]}>
              Goal: {formatTokenAmount(project.targetAmount)} XLM
            </Text>
          </View>

          {/* Stats grid */}
          <View style={styles.statsGrid}>
            <StatCard
              icon="people-outline"
              label="Contributors"
              value={String(project.contributorCount)}
              colors={colors}
            />
            <StatCard
              icon="trending-up-outline"
              label="Remaining"
              value={`${formatTokenAmount(String(remaining))} XLM`}
              colors={colors}
            />
          </View>

          {/* About / Description */}
          {project.description ? (
            <View
              style={[
                styles.card,
                { backgroundColor: colors.surface, borderColor: colors.cardBorder },
              ]}
            >
              <SectionHeader title="About" icon="information-circle-outline" colors={colors} />
              <Text style={[styles.descriptionText, { color: colors.textSecondary }]}>
                {project.description}
              </Text>
            </View>
          ) : null}

          {/* Roadmap */}
          {roadmap.length > 0 ? (
            <View
              style={[
                styles.card,
                { backgroundColor: colors.surface, borderColor: colors.cardBorder },
              ]}
            >
              <SectionHeader title="Roadmap" icon="map-outline" colors={colors} />
              {roadmap.map((milestone, idx) => (
                <RoadmapItem
                  key={milestone.id}
                  milestone={milestone}
                  colors={colors}
                  isLast={idx === roadmap.length - 1}
                />
              ))}
            </View>
          ) : null}

          {/* Recent Contributors */}
          {contributors.length > 0 ? (
            <View
              style={[
                styles.card,
                { backgroundColor: colors.surface, borderColor: colors.cardBorder },
              ]}
            >
              <SectionHeader title="Recent Contributors" icon="heart-outline" colors={colors} />
              {contributors.slice(0, 5).map((item, idx) => (
                <ContributorRow
                  key={`${item.contributor}-${idx}`}
                  item={item}
                  colors={colors}
                  isLast={idx === Math.min(contributors.length, 5) - 1}
                />
              ))}
            </View>
          ) : null}

          {/* Owner */}
          <View style={[styles.infoRow, { borderColor: colors.border }]}>
            <Ionicons name="person-outline" size={16} color={colors.textSecondary} />
            <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>Owner</Text>
            <Text
              style={[styles.infoValue, { color: colors.text }]}
              numberOfLines={1}
              ellipsizeMode="middle"
            >
              {project.owner}
            </Text>
          </View>

          {/* On-chain notice */}
          <View
            style={[
              styles.noticeCard,
              { backgroundColor: colors.card, borderColor: colors.cardBorder },
            ]}
          >
            <Ionicons name="shield-checkmark-outline" size={18} color={colors.accent} />
            <Text style={[styles.noticeText, { color: colors.textSecondary }]}>
              Contributions are secured by a Soroban smart contract on the Stellar network. Funds
              are held in an on-chain vault until milestones are approved.
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* Floating back button — always on top */}
      <BackButton />

      {/* Contribute CTA — pinned to bottom */}
      {project.isActive ? (
        <View
          style={[
            styles.bottomBar,
            {
              backgroundColor: colors.background,
              borderColor: colors.border,
              paddingBottom: Math.max(safeBottom, 16),
            },
          ]}
        >
          <TouchableOpacity
            style={[styles.contributeButton, { backgroundColor: colors.accent }]}
            onPress={() => setShowContributeModal(true)}
            activeOpacity={0.8}
          >
            <Ionicons name="wallet-outline" size={20} color="#ffffff" style={{ marginRight: 8 }} />
            <Text style={styles.contributeButtonText}>Contribute XLM</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <ContributionModal
        visible={showContributeModal}
        projectName={project.name}
        onClose={() => setShowContributeModal(false)}
        onSubmit={handleContribute}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Floating back button
  floatingBack: {
    position: 'absolute',
    left: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },

  // Hero Banner
  bannerContainer: {
    height: 240,
    overflow: 'hidden',
  },
  bannerWatermark: {
    position: 'absolute',
    fontSize: 200,
    fontWeight: '900',
    color: 'rgba(255,255,255,0.10)',
    alignSelf: 'center',
    top: -20,
    letterSpacing: -8,
  },
  bannerGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 150,
    justifyContent: 'flex-end',
    paddingHorizontal: 20,
    paddingBottom: 20,
    gap: 8,
  },
  bannerTitle: {
    color: '#ffffff',
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  bannerBadgeRow: {
    flexDirection: 'row',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },

  // Content area
  content: {
    padding: 20,
    gap: 14,
  },

  // Generic section card
  card: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },

  // Section header label
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },

  // Funding card internals
  fundingTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 14,
  },
  fundingRaised: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  fundingRaisedLabel: {
    fontSize: 12,
    marginTop: 2,
  },
  fundingPctBlock: {
    alignItems: 'flex-end',
  },
  fundingPct: {
    fontSize: 22,
    fontWeight: '800',
  },
  fundingPctLabel: {
    fontSize: 12,
  },
  progressTrack: {
    height: 10,
    borderRadius: 5,
    backgroundColor: 'rgba(128,128,128,0.15)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 5,
  },
  fundingGoal: {
    fontSize: 13,
    marginTop: 10,
  },

  // Stats grid
  statsGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  statCard: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 2,
    textAlign: 'center',
  },
  statLabel: {
    fontSize: 12,
    textAlign: 'center',
  },

  // Description
  descriptionText: {
    fontSize: 14,
    lineHeight: 22,
  },

  // Roadmap
  milestoneRow: {
    flexDirection: 'row',
    gap: 14,
  },
  milestoneLeft: {
    alignItems: 'center',
    width: 22,
  },
  milestoneIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  activeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  milestoneLine: {
    width: 1.5,
    flex: 1,
    minHeight: 16,
    marginTop: 3,
  },
  milestoneBody: {
    flex: 1,
    paddingBottom: 16,
  },
  milestoneTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  milestoneTitle: {
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  milestoneBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  milestoneBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  milestoneDesc: {
    fontSize: 13,
    lineHeight: 20,
    marginTop: 4,
  },
  milestoneDate: {
    fontSize: 11,
    marginTop: 4,
  },

  // Contributors
  contributorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
  },
  contributorAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  contributorInitial: {
    fontSize: 16,
    fontWeight: '700',
  },
  contributorInfo: {
    flex: 1,
  },
  contributorAddress: {
    fontSize: 14,
    fontWeight: '600',
  },
  contributorTime: {
    fontSize: 12,
    marginTop: 2,
  },
  contributorAmount: {
    fontSize: 14,
    fontWeight: '700',
  },

  // Owner row
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  infoLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  infoValue: {
    flex: 1,
    fontSize: 13,
    textAlign: 'right',
  },

  // On-chain notice
  noticeCard: {
    flexDirection: 'row',
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    gap: 10,
    alignItems: 'flex-start',
  },
  noticeText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
  },

  // Bottom bar
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  contributeButton: {
    height: 52,
    borderRadius: 14,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 5,
  },
  contributeButtonText: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
  },

  // Error / retry
  errorTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
    textAlign: 'center',
  },
  retryButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  retryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
});
