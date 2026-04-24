import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  ImageBackground,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../../contexts/AuthContext';
import { useTheme } from '../../../contexts/ThemeContext';
import {
  crowdfundApi,
  CrowdfundProject,
  ProjectContributor,
} from '../../../lib/crowdfund';
import { buildContributorFallbacks, getProjectPresentation } from '../../../lib/project-details';
import { computeFundingProgress, formatTokenAmount } from '../../../lib/stellar';
import ContributionModal from '../../../components/ContributionModal';
import { usersApi } from '../../../lib/api';

function ProgressBar({ progress, color }: { progress: number; color: string }) {
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${progress}%`, backgroundColor: color }]} />
    </View>
  );
}

function StatItem({
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
      style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
    >
      <Ionicons name={icon} size={20} color={colors.accent} style={{ marginBottom: 6 }} />
      <Text style={[styles.statCardValue, { color: colors.text }]}>{value}</Text>
      <Text style={[styles.statCardLabel, { color: colors.textSecondary }]}>{label}</Text>
    </View>
  );
}

function ContributorPill({
  contributor,
  colors,
}: {
  contributor: ProjectContributor;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  const initial = contributor.name.charAt(0).toUpperCase() || '?';

  return (
    <View
      style={[
        styles.contributorPill,
        { backgroundColor: colors.card, borderColor: colors.cardBorder },
      ]}
    >
      {contributor.avatarUrl ? (
        <Image source={{ uri: contributor.avatarUrl }} style={styles.contributorAvatar} />
      ) : (
        <View style={[styles.contributorAvatar, { backgroundColor: colors.accentSecondary }]}>
          <Text style={styles.contributorInitial}>{initial}</Text>
        </View>
      )}

      <View style={styles.contributorMeta}>
        <Text style={[styles.contributorName, { color: colors.text }]} numberOfLines={1}>
          {contributor.name}
        </Text>
        <Text style={[styles.contributorHandle, { color: colors.textSecondary }]} numberOfLines={1}>
          {contributor.amount
            ? `${formatTokenAmount(contributor.amount)} XLM`
            : contributor.handle
              ? `@${contributor.handle}`
              : 'Recent supporter'}
        </Text>
      </View>
    </View>
  );
}

export default function ProjectDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const { isAuthenticated } = useAuth();

  const [project, setProject] = useState<CrowdfundProject | null>(null);
  const [contributors, setContributors] = useState<ProjectContributor[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showContributeModal, setShowContributeModal] = useState(false);
  const [stellarPublicKey, setStellarPublicKey] = useState<string | null>(null);

  const projectId = parseInt(id ?? '0', 10);
  const hasValidProjectId = Number.isFinite(projectId) && projectId > 0;

  const fetchProject = useCallback(async () => {
    if (!hasValidProjectId) {
      setProject(null);
      setError('Project not found.');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await crowdfundApi.getProject(projectId);
      if (response.success && response.data) {
        setProject(response.data);
      } else {
        setError(response.error?.message ?? 'Project not found.');
      }
    } catch {
      setError('Failed to load project details.');
    } finally {
      setIsLoading(false);
    }
  }, [hasValidProjectId, projectId]);

  const fetchContributors = useCallback(async () => {
    if (!hasValidProjectId) {
      setContributors([]);
      return;
    }

    try {
      const response = await crowdfundApi.getProjectContributors(projectId);
      if (response.success && response.data?.length) {
        setContributors(response.data.slice(0, 6));
      } else {
        setContributors([]);
      }
    } catch {
      setContributors([]);
    }
  }, [hasValidProjectId, projectId]);

  const fetchUserPublicKey = useCallback(async () => {
    try {
      const response = await usersApi.getProfile();
      if (response.success && response.data?.stellarPublicKey) {
        setStellarPublicKey(response.data.stellarPublicKey);
      }
    } catch {
      // Non-critical: the user may not have a linked account yet.
    }
  }, []);

  useEffect(() => {
    void fetchProject();
    void fetchContributors();
    if (isAuthenticated) {
      void fetchUserPublicKey();
    }
  }, [fetchProject, fetchContributors, fetchUserPublicKey, isAuthenticated]);

  const handleContribute = async (
    amount: string,
  ): Promise<{ transactionHash?: string; errorMessage?: string }> => {
    if (!hasValidProjectId) {
      return { errorMessage: 'Project not found.' };
    }

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
        void fetchProject();
        void fetchContributors();

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

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.accent} />
      </SafeAreaView>
    );
  }

  if (error || !project) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: colors.background, padding: 32 }]}>
        <Ionicons
          name="alert-circle-outline"
          size={56}
          color={colors.danger}
          style={{ marginBottom: 16 }}
        />
        <Text style={[styles.errorTitle, { color: colors.text }]}>{error || 'Project not found.'}</Text>
        <TouchableOpacity
          style={[styles.retryButton, { backgroundColor: colors.accent }]}
          onPress={() => void fetchProject()}
          activeOpacity={0.8}
        >
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const progress = computeFundingProgress(project.totalDeposited, project.targetAmount);
  const remaining = Math.max(
    parseFloat(project.targetAmount) - parseFloat(project.totalDeposited),
    0,
  );
  const presentation = getProjectPresentation(project);
  const visibleContributors =
    contributors.length > 0
      ? contributors
      : buildContributorFallbacks(project, project.contributorCount);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <TouchableOpacity
          style={[styles.backButton, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
          onPress={() => router.back()}
          activeOpacity={0.8}
        >
          <Ionicons name="arrow-back" size={18} color={colors.text} />
        </TouchableOpacity>

        <ImageBackground
          source={presentation.heroImage}
          imageStyle={styles.heroImage}
          style={[styles.heroCard, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}
        >
          <View style={styles.heroOverlay} />
          <View style={styles.heroContent}>
            <View style={[styles.heroBadge, { backgroundColor: colors.card }]}>
              <Text style={[styles.heroBadgeText, { color: colors.accent }]}>
                {project.category || presentation.category}
              </Text>
            </View>
            <Text style={styles.heroTitle}>{project.name}</Text>
            <Text style={styles.heroSubtitle}>{project.tagline || presentation.tagline}</Text>

            <View style={styles.heroStatsRow}>
              <View style={styles.heroStatChip}>
                <Text style={styles.heroStatValue}>{progress}%</Text>
                <Text style={styles.heroStatLabel}>Funded</Text>
              </View>
              <View style={styles.heroStatChip}>
                <Text style={styles.heroStatValue}>{project.contributorCount}</Text>
                <Text style={styles.heroStatLabel}>Backers</Text>
              </View>
            </View>
          </View>
        </ImageBackground>

        {!project.isActive && (
          <View style={[styles.closedBanner, { backgroundColor: colors.danger + '18' }]}>
            <Ionicons name="lock-closed" size={16} color={colors.danger} />
            <Text style={[styles.closedText, { color: colors.danger }]}>
              This project is no longer accepting contributions.
            </Text>
          </View>
        )}

        <View style={styles.highlightRow}>
          {presentation.highlights.map((highlight) => (
            <View
              key={highlight}
              style={[
                styles.highlightChip,
                { backgroundColor: colors.card, borderColor: colors.cardBorder },
              ]}
            >
              <Text style={[styles.highlightChipText, { color: colors.text }]}>{highlight}</Text>
            </View>
          ))}
        </View>

        <View
          style={[
            styles.sectionCard,
            { backgroundColor: colors.surface, borderColor: colors.cardBorder },
          ]}
        >
          <Text style={[styles.sectionEyebrow, { color: colors.accent }]}>{presentation.heroLabel}</Text>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>About this project</Text>
          <Text style={[styles.bodyText, { color: colors.textSecondary }]}>
            {project.description || presentation.description}
          </Text>
          <Text style={[styles.bodyText, styles.bodyTextSpaced, { color: colors.textSecondary }]}>
            {presentation.longDescription}
          </Text>
        </View>

        <View
          style={[
            styles.sectionCard,
            styles.fundingCard,
            { backgroundColor: colors.surface, borderColor: colors.cardBorder },
          ]}
        >
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Funding Progress</Text>
          <View style={styles.fundingHeader}>
            <Text style={[styles.fundingAmount, { color: colors.text }]}>
              {formatTokenAmount(project.totalDeposited)} XLM
            </Text>
            <Text style={[styles.fundingPercentage, { color: colors.accent }]}>{progress}%</Text>
          </View>
          <ProgressBar progress={progress} color={colors.accent} />
          <Text style={[styles.fundingTarget, { color: colors.textSecondary }]}>
            Goal: {formatTokenAmount(project.targetAmount)} XLM
          </Text>
          <View style={styles.fundingFootnoteRow}>
            <Text style={[styles.fundingFootnote, { color: colors.textSecondary }]}>
              Remaining: {formatTokenAmount(String(remaining))} XLM
            </Text>
            <Text style={[styles.fundingFootnote, { color: colors.textSecondary }]}>
              Withdrawn: {formatTokenAmount(project.totalWithdrawn)} XLM
            </Text>
          </View>
        </View>

        <View style={styles.statsGrid}>
          <StatItem
            icon="people-outline"
            label="Contributors"
            value={String(project.contributorCount)}
            colors={colors}
          />
          <StatItem
            icon="trending-up-outline"
            label="Remaining"
            value={`${formatTokenAmount(String(remaining))} XLM`}
            colors={colors}
          />
        </View>

        <View
          style={[
            styles.sectionCard,
            { backgroundColor: colors.surface, borderColor: colors.cardBorder },
          ]}
        >
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Roadmap</Text>
          {presentation.roadmap.map((item, index) => {
            const iconName =
              item.status === 'complete'
                ? 'checkmark-circle'
                : item.status === 'current'
                  ? 'radio-button-on'
                  : 'ellipse-outline';
            const iconColor =
              item.status === 'complete'
                ? '#4ecdc4'
                : item.status === 'current'
                  ? colors.accent
                  : colors.textSecondary;

            return (
              <View
                key={`${item.title}-${index}`}
                style={[
                  styles.roadmapItem,
                  index < presentation.roadmap.length - 1 && {
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: colors.border,
                  },
                ]}
              >
                <Ionicons name={iconName} size={20} color={iconColor} style={styles.roadmapIcon} />
                <View style={styles.roadmapCopy}>
                  <Text style={[styles.roadmapTitle, { color: colors.text }]}>{item.title}</Text>
                  <Text style={[styles.roadmapDetail, { color: colors.textSecondary }]}>
                    {item.detail}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>

        <View
          style={[
            styles.sectionCard,
            { backgroundColor: colors.surface, borderColor: colors.cardBorder },
          ]}
        >
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Recent contributors</Text>
          {visibleContributors.length > 0 ? (
            <View style={styles.contributorsList}>
              {visibleContributors.map((contributor) => (
                <ContributorPill key={contributor.id} contributor={contributor} colors={colors} />
              ))}
            </View>
          ) : (
            <Text style={[styles.bodyText, { color: colors.textSecondary }]}>
              Contributor activity will appear here as soon as it is available from the vault feed.
            </Text>
          )}
        </View>

        <View
          style={[
            styles.sectionCard,
            { backgroundColor: colors.surface, borderColor: colors.cardBorder },
          ]}
        >
          <View style={[styles.infoRow, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
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

          <View style={styles.infoRow}>
            <Ionicons name="cube-outline" size={16} color={colors.textSecondary} />
            <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>Vault token</Text>
            <Text
              style={[styles.infoValue, { color: colors.text }]}
              numberOfLines={1}
              ellipsizeMode="middle"
            >
              {project.tokenAddress}
            </Text>
          </View>
        </View>

        <View
          style={[
            styles.sectionCard,
            styles.noticeCard,
            { backgroundColor: colors.card, borderColor: colors.cardBorder },
          ]}
        >
          <Ionicons name="shield-checkmark-outline" size={18} color={colors.accent} />
          <Text style={[styles.noticeText, { color: colors.textSecondary }]}>
            Contributions are secured by a Soroban smart contract on the Stellar network. Funds are
            held in an on-chain vault until milestones are approved.
          </Text>
        </View>
      </ScrollView>

      {project.isActive && (
        <View
          style={[
            styles.bottomBar,
            { backgroundColor: colors.background, borderColor: colors.border },
          ]}
        >
          <TouchableOpacity
            style={[styles.contributeButton, { backgroundColor: colors.accent }]}
            onPress={() => setShowContributeModal(true)}
            activeOpacity={0.8}
          >
            <Ionicons name="wallet-outline" size={20} color="#ffffff" style={{ marginRight: 8 }} />
            <Text style={styles.contributeButtonText}>Contribute</Text>
          </TouchableOpacity>
        </View>
      )}

      <ContributionModal
        visible={showContributeModal}
        projectName={project.name}
        onClose={() => setShowContributeModal(false)}
        onSubmit={handleContribute}
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
  scrollContent: {
    padding: 20,
    paddingBottom: 110,
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  heroCard: {
    minHeight: 300,
    borderRadius: 28,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: 16,
    justifyContent: 'flex-end',
  },
  heroImage: {
    resizeMode: 'cover',
    opacity: 0.94,
  },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(12, 12, 20, 0.48)',
  },
  heroContent: {
    padding: 22,
  },
  heroBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    marginBottom: 12,
  },
  heroBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  heroTitle: {
    color: '#ffffff',
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -0.7,
    marginBottom: 8,
  },
  heroSubtitle: {
    color: 'rgba(255,255,255,0.86)',
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 18,
  },
  heroStatsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  heroStatChip: {
    backgroundColor: 'rgba(0, 0, 0, 0.28)',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    minWidth: 88,
  },
  heroStatValue: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '800',
  },
  heroStatLabel: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 12,
    marginTop: 2,
  },
  closedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    marginBottom: 16,
    gap: 8,
  },
  closedText: {
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  highlightRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 16,
  },
  highlightChip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  highlightChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  sectionCard: {
    borderRadius: 22,
    borderWidth: 1,
    padding: 18,
    marginBottom: 16,
  },
  sectionEyebrow: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 12,
    letterSpacing: -0.3,
  },
  bodyText: {
    fontSize: 14,
    lineHeight: 22,
  },
  bodyTextSpaced: {
    marginTop: 12,
  },
  fundingCard: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  fundingHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 12,
  },
  fundingAmount: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  fundingPercentage: {
    fontSize: 18,
    fontWeight: '700',
  },
  fundingTarget: {
    fontSize: 13,
    marginTop: 8,
  },
  fundingFootnoteRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 14,
    gap: 10,
  },
  fundingFootnote: {
    flex: 1,
    fontSize: 12,
  },
  progressTrack: {
    height: 10,
    borderRadius: 5,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 5,
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    alignItems: 'center',
  },
  statCardValue: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 2,
  },
  statCardLabel: {
    fontSize: 12,
  },
  roadmapItem: {
    flexDirection: 'row',
    paddingVertical: 14,
  },
  roadmapIcon: {
    marginRight: 12,
    marginTop: 2,
  },
  roadmapCopy: {
    flex: 1,
  },
  roadmapTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
  },
  roadmapDetail: {
    fontSize: 13,
    lineHeight: 20,
  },
  contributorsList: {
    gap: 10,
  },
  contributorPill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 18,
    padding: 12,
  },
  contributorAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  contributorInitial: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
  },
  contributorMeta: {
    flex: 1,
  },
  contributorName: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
  },
  contributorHandle: {
    fontSize: 12,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 8,
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
  noticeCard: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  noticeText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
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
