import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import {
  ProjectVerification,
  VerificationStatus,
  statusColor,
  statusLabel,
  verificationApi,
} from '../lib/verification';

interface Props {
  projectId: number;
  voterPublicKey: string | null;
}

function QuorumBar({
  progress,
  color,
}: {
  progress: number;
  color: string;
}) {
  return (
    <View style={styles.barTrack}>
      <View style={[styles.barFill, { width: `${progress}%`, backgroundColor: color }]} />
    </View>
  );
}

export default function VerificationPanel({ projectId, voterPublicKey }: Props) {
  const { colors } = useTheme();
  const [data, setData] = useState<ProjectVerification | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isVoting, setIsVoting] = useState(false);
  const [voteError, setVoteError] = useState<string | null>(null);
  const [hasVoted, setHasVoted] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await verificationApi.getProject(projectId);
      if (res.success && res.data) setData(res.data);
    } catch {
      // project not yet registered — silently hide panel
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const vote = async (support: boolean) => {
    if (!voterPublicKey || !data) return;
    setIsVoting(true);
    setVoteError(null);
    try {
      const res = await verificationApi.castVote(projectId, voterPublicKey, support);
      if (res.success && res.data) {
        setHasVoted(true);
        setData((prev) =>
          prev
            ? {
                ...prev,
                votesFor: res.data!.votesFor,
                votesAgainst: res.data!.votesAgainst,
                status: res.data!.newStatus,
              }
            : prev,
        );
      } else {
        setVoteError(res.error?.message ?? 'Vote failed.');
      }
    } catch {
      setVoteError('Network error. Please try again.');
    } finally {
      setIsVoting(false);
    }
  };

  if (isLoading) {
    return (
      <View style={[styles.container, { borderColor: colors.cardBorder }]}>
        <ActivityIndicator size="small" color={colors.accent} />
      </View>
    );
  }

  if (!data) return null;

  const color = statusColor(data.status);
  const isPending = data.status === VerificationStatus.Pending;
  const canVote = isPending && !!voterPublicKey && !hasVoted;

  return (
    <View style={[styles.container, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
      {/* Status header */}
      <View style={styles.header}>
        <Ionicons
          name={data.status === 'VERIFIED' ? 'shield-checkmark' : data.status === 'REJECTED' ? 'shield-outline' : 'time-outline'}
          size={20}
          color={color}
        />
        <Text style={[styles.statusText, { color }]}>{statusLabel(data.status as VerificationStatus)}</Text>
      </View>

      {/* Quorum progress */}
      <View style={styles.progressSection}>
        <View style={styles.progressHeader}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>Community votes</Text>
          <Text style={[styles.progressPct, { color }]}>{data.quorumProgress}%</Text>
        </View>
        <QuorumBar progress={data.quorumProgress} color={color} />
        <View style={styles.voteRow}>
          <Text style={[styles.voteCount, { color: '#10b981' }]}>
            {data.votesFor} for
          </Text>
          <Text style={[styles.voteCount, { color: '#ef4444' }]}>
            {data.votesAgainst} against
          </Text>
        </View>
      </View>

      {/* Vote buttons */}
      {canVote && (
        <View style={styles.voteButtons}>
          <TouchableOpacity
            style={[styles.voteBtn, { backgroundColor: '#10b981' + '22', borderColor: '#10b981' }]}
            onPress={() => void vote(true)}
            disabled={isVoting}
            activeOpacity={0.75}
          >
            {isVoting ? (
              <ActivityIndicator size="small" color="#10b981" />
            ) : (
              <>
                <Ionicons name="thumbs-up-outline" size={16} color="#10b981" />
                <Text style={[styles.voteBtnText, { color: '#10b981' }]}>Verify</Text>
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.voteBtn, { backgroundColor: '#ef4444' + '22', borderColor: '#ef4444' }]}
            onPress={() => void vote(false)}
            disabled={isVoting}
            activeOpacity={0.75}
          >
            {isVoting ? (
              <ActivityIndicator size="small" color="#ef4444" />
            ) : (
              <>
                <Ionicons name="thumbs-down-outline" size={16} color="#ef4444" />
                <Text style={[styles.voteBtnText, { color: '#ef4444' }]}>Reject</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      )}

      {hasVoted && (
        <Text style={[styles.votedNote, { color: colors.textSecondary }]}>
          Your vote has been recorded.
        </Text>
      )}

      {!voterPublicKey && isPending && (
        <Text style={[styles.votedNote, { color: colors.textSecondary }]}>
          Link a Stellar account in Settings to vote.
        </Text>
      )}

      {voteError && (
        <Text style={[styles.errorText, { color: colors.danger }]}>{voteError}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    marginTop: 16,
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusText: {
    fontSize: 14,
    fontWeight: '700',
  },
  progressSection: {
    gap: 6,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  label: {
    fontSize: 12,
  },
  progressPct: {
    fontSize: 12,
    fontWeight: '700',
  },
  barTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 4,
  },
  voteRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  voteCount: {
    fontSize: 12,
    fontWeight: '600',
  },
  voteButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  voteBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  voteBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  votedNote: {
    fontSize: 12,
    textAlign: 'center',
  },
  errorText: {
    fontSize: 12,
    textAlign: 'center',
  },
});
