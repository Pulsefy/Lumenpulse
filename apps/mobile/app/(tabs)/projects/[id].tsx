import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { useAuth } from '../../../contexts/AuthContext';
import { useTheme } from '../../../contexts/ThemeContext';
import { crowdfundApi, CrowdfundProject, Contributor, RoadmapItem } from '../../../lib/crowdfund';
import { computeFundingProgress, formatTokenAmount } from '../../../lib/stellar';
import ContributionModal from '../../../components/ContributionModal';
import VerificationPanel from '../../../components/VerificationPanel';
import { usersApi } from '../../../lib/api';
import { moderationApi, ReportType, ReportReason } from '../../../lib/moderation';

// ─── Sub-components ───────────────────────────────────────────────────────────

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

function ContributorCard({
  contributor,
  colors,
}: {
  contributor: Contributor;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  return (
    <View
      style={[
        styles.contributorCard,
        { backgroundColor: colors.card, borderColor: colors.cardBorder },
      ]}
    >
      <View style={styles.contributorInfo}>
        <Ionicons name="wallet-outline" size={18} color={colors.accent} />
        <Text
          style={[styles.contributorAddress, { color: colors.text }]}
          numberOfLines={1}
          ellipsizeMode="middle"
        >
          {contributor.publicKey}
        </Text>
      </View>
      <View style={styles.contributorStats}>
        <Text style={[styles.contributorAmount, { color: colors.accent }]}>
          {formatTokenAmount(contributor.totalContributed)} XLM
        </Text>
        <Text style={[styles.contributorCount, { color: colors.textSecondary }]}>
          {contributor.contributionCount} contribution
          {contributor.contributionCount !== 1 ? 's' : ''}
        </Text>
      </View>
    </View>
  );
}

function RoadmapCard({
  item,
  colors,
}: {
  item: RoadmapItem;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  return (
    <View
      style={[styles.roadmapCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
    >
      <View style={styles.roadmapHeader}>
        <Ionicons
          name={item.isCompleted ? 'checkmark-circle' : 'time-outline'}
          size={20}
          color={item.isCompleted ? colors.success : colors.textSecondary}
        />
        <Text style={[styles.roadmapTitle, { color: colors.text }]}>{item.title}</Text>
      </View>
      <Text style={[styles.roadmapDescription, { color: colors.textSecondary }]}>
        {item.description}
      </Text>
      <Text style={[styles.roadmapDate, { color: colors.textSecondary }]}>
        Target: {new Date(item.targetDate).toLocaleDateString()}
      </Text>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function ProjectDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const { isAuthenticated } = useAuth();

  const [project, setProject] = useState<CrowdfundProject | null>(null);
  const [contributors, setContributors] = useState<Contributor[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showContributeModal, setShowContributeModal] = useState(false);
  const [stellarPublicKey, setStellarPublicKey] = useState<string | null>(null);
  const [isReporting, setIsReporting] = useState(false);

  const projectId = parseInt(id ?? '0', 10);

  const fetchProject = useCallback(async () => {
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
  }, [projectId]);

  const fetchContributors = useCallback(async () => {
    try {
      const response = await crowdfundApi.getContributors(projectId);
      if (response.success && response.data) {
        setContributors(response.data);
      }
    } catch {
      // Non-critical — contributors list is optional
    }
  }, [projectId]);

  const fetchUserPublicKey = useCallback(async () => {
    try {
      const response = await usersApi.getProfile();
      if (response.success && response.data?.stellarPublicKey) {
        setStellarPublicKey(response.data.stellarPublicKey);
      }
    } catch {
      // Non-critical — the user may not have a linked account yet
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
        // Refresh project data so the progress bar updates
        void fetchProject();

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

  const handleReport = async (reason: ReportReason) => {
    if (isReporting || !project) return;

    setIsReporting(true);
    try {
      const response = await moderationApi.createReport({
        targetType: ReportType.PROJECT,
        targetId: String(projectId),
        reason,
        description: `Project reported: ${project.name}`,
      });

      if (response.success) {
        Alert.alert(
          'Report Submitted',
          'Thank you. Your report has been submitted for review by our moderation team.',
        );
      } else {
        Alert.alert('Error', response.error?.message || 'Failed to submit report.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to submit report.';
      Alert.alert('Error', message);
    } finally {
      setIsReporting(false);
    }
  };

  // ── Loading ──────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.accent} />
      </SafeAreaView>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────
  if (error || !project) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: colors.background, padding: 32 }]}>
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

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Project banner image */}
        {project.bannerUrl && (
          <Image
            source={{ uri: project.bannerUrl }}
            style={styles.bannerImage}
            contentFit="cover"
            transition={200}
          />
        )}

        {/* Project header */}
        <Text style={[styles.title, { color: colors.text }]}>{project.name}</Text>

        {!project.isActive && (
          <View style={[styles.closedBanner, { backgroundColor: colors.danger + '18' }]}>
            <Ionicons name="lock-closed" size={16} color={colors.danger} />
            <Text style={[styles.closedText, { color: colors.danger }]}>
              This project is no longer accepting contributions.
            </Text>
          </View>
        )}

        {/* Description */}
        {project.description && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>About</Text>
            <Text style={[styles.description, { color: colors.textSecondary }]}>
              {project.description}
            </Text>
          </View>
        )}

        {/* Funding progress */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Funding Progress</Text>
          <View
            style={[
              styles.fundingCard,
              { backgroundColor: colors.surface, borderColor: colors.cardBorder },
            ]}
          >
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
          </View>
        </View>

        {/* Stats grid */}
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

        {/* Roadmap */}
        {project.roadmap && project.roadmap.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Roadmap</Text>
            {project.roadmap.map((item) => (
              <RoadmapCard key={item.id} item={item} colors={colors} />
            ))}
          </View>
        )}

        {/* Recent contributors */}
        {contributors.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Recent Contributors</Text>
            {contributors.slice(0, 5).map((contributor, index) => (
              <ContributorCard
                key={`${contributor.publicKey}-${index}`}
                contributor={contributor}
                colors={colors}
              />
            ))}
          </View>
        )}

        {/* Owner info */}
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

        {/* Report button */}
        <TouchableOpacity
          style={[styles.reportButton, { borderColor: colors.border }]}
          onPress={() => {
            Alert.alert('Report Project', 'Why are you reporting this project?', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Spam',
                onPress: () => void handleReport(ReportReason.SPAM),
              },
              {
                text: 'Fraud',
                onPress: () => void handleReport(ReportReason.FRAUD),
              },
              {
                text: 'Misleading',
                onPress: () => void handleReport(ReportReason.MISLEADING_INFO),
              },
            ]);
          }}
        >
          <Ionicons name="flag-outline" size={16} color={colors.danger} />
          <Text style={[styles.reportButtonText, { color: colors.danger }]}>
            Report this project
          </Text>
        </TouchableOpacity>

        {/* On-chain notice */}
        <View
          style={[
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

        {/* Community verification */}
        <VerificationPanel projectId={projectId} voterPublicKey={stellarPublicKey} />
      </ScrollView>

      {/* Contribute button — pinned to bottom */}
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

      {/* Contribution modal */}
      <ContributionModal
        visible={showContributeModal}
        projectName={project.name}
        onClose={() => setShowContributeModal(false)}
        onSubmit={handleContribute}
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
  scrollContent: {
    padding: 20,
    paddingBottom: 100,
  },

  // Banner image
  bannerImage: {
    width: '100%',
    height: 200,
    borderRadius: 16,
    marginBottom: 20,
  },

  // Header
  title: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginBottom: 16,
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

  // Section
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
  },
  description: {
    fontSize: 14,
    lineHeight: 22,
  },

  // Funding card
  fundingCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 20,
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

  // Progress bar
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

  // Stats grid
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

  // Contributor card
  contributorCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginBottom: 10,
  },
  contributorInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  contributorAddress: {
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  contributorStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingLeft: 26,
  },
  contributorAmount: {
    fontSize: 14,
    fontWeight: '700',
  },
  contributorCount: {
    fontSize: 12,
  },

  // Roadmap card
  roadmapCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginBottom: 10,
  },
  roadmapHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  roadmapTitle: {
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
  },
  roadmapDescription: {
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 8,
    paddingLeft: 28,
  },
  roadmapDate: {
    fontSize: 12,
    paddingLeft: 28,
  },

  // Info row
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
    marginBottom: 16,
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

  // Report button
  reportButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderWidth: 1,
    borderRadius: 10,
    gap: 8,
    marginBottom: 16,
  },
  reportButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },

  // Notice card
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
