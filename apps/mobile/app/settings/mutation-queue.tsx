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
import { useRouter } from 'expo-router';
import { useLocalization } from '../../src/context';
import { mutationQueue } from '../../lib/mutation-queue';
import {
  formatMutationQueueStatus,
  groupQueue,
  summarizeQueue,
  type MutationQueueGroups,
  type MutationQueueSummary,
  type QueuedMutation,
} from '../../lib/mutation-queue-core';

const EMPTY_GROUPS: MutationQueueGroups = {
  pending: [],
  replaying: [],
  failed: [],
  conflicted: [],
};

/** Render an arbitrary queued value for the conflict comparison. */
const describeValue = (value: unknown): string => {
  if (value === undefined) {
    return '(not set)';
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
};

export default function MutationQueueScreen() {
  const router = useRouter();
  const { colors } = useLocalization();
  const [groups, setGroups] = useState<MutationQueueGroups>(EMPTY_GROUPS);
  const [summary, setSummary] = useState<MutationQueueSummary>(() => summarizeQueue([]));
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void mutationQueue
      .getQueue()
      .then((queue) => {
        setGroups(groupQueue(queue));
        setSummary(summarizeQueue(queue));
      })
      .catch(() => {
        setGroups(EMPTY_GROUPS);
        setSummary(summarizeQueue([]));
      });
  }, []);

  useEffect(() => {
    const unsubscribe = mutationQueue.subscribe(refresh);
    refresh();
    return unsubscribe;
  }, [refresh]);

  const runAction = useCallback(
    async (id: string, action: () => Promise<unknown>) => {
      setBusyId(id);
      try {
        await action();
        refresh();
      } catch (error) {
        console.warn('[mutation-queue] action failed', error);
      } finally {
        setBusyId(null);
      }
    },
    [refresh],
  );

  const meta = (mutation: QueuedMutation): string => {
    const stamp = new Date(mutation.updatedAt).toLocaleString();
    if (mutation.state === 'failed') {
      return `${mutation.lastError ?? 'Unknown error'} · ${stamp}`;
    }
    if (mutation.state === 'conflicted') {
      return mutation.conflictMessage ?? 'The server value changed while you were offline.';
    }
    return `${mutation.attempts > 0 ? `Attempt ${mutation.attempts} · ` : ''}${stamp}`;
  };

  const renderHeader = (mutation: QueuedMutation, tone: string) => (
    <View style={styles.cardHeader}>
      <View style={styles.cardHeading}>
        <Text style={[styles.cardTitle, { color: colors.text }]} accessible>
          {mutation.type}
        </Text>
        <Text style={[styles.cardMeta, { color: colors.textSecondary }]} accessible>
          {meta(mutation)}
        </Text>
      </View>
      <View style={[styles.badge, { borderColor: tone }]}>
        <Text style={[styles.badgeText, { color: tone }]}>{mutation.state}</Text>
      </View>
    </View>
  );

  const renderConflict = (mutation: QueuedMutation) => (
    <View
      key={mutation.id}
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.danger }]}
    >
      {renderHeader(mutation, colors.danger)}

      <View style={styles.compareRow}>
        <View style={[styles.compareColumn, { borderColor: colors.border }]}>
          <Text style={[styles.compareLabel, { color: colors.textSecondary }]}>Your change</Text>
          <Text style={[styles.compareValue, { color: colors.text }]} accessible>
            {describeValue(mutation.localValue ?? mutation.payload)}
          </Text>
        </View>
        <View style={[styles.compareColumn, { borderColor: colors.border }]}>
          <Text style={[styles.compareLabel, { color: colors.textSecondary }]}>Server value</Text>
          <Text style={[styles.compareValue, { color: colors.text }]} accessible>
            {describeValue(mutation.serverValue)}
          </Text>
        </View>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.actionButton, { backgroundColor: colors.accent }]}
          onPress={() => runAction(mutation.id, () => mutationQueue.resolveConflict(mutation.id, 'local'))}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={`Keep my change for ${mutation.type}`}
        >
          <Text style={styles.actionButtonText}>Keep mine</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionButton, styles.secondaryButton, { borderColor: colors.border }]}
          onPress={() => runAction(mutation.id, () => mutationQueue.resolveConflict(mutation.id, 'server'))}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={`Use server value for ${mutation.type}`}
        >
          <Text style={[styles.actionButtonText, { color: colors.text }]}>Use server</Text>
        </TouchableOpacity>
      </View>

      {busyId === mutation.id && (
        <ActivityIndicator color={colors.accent} accessibilityLabel="Resolving conflict" />
      )}
    </View>
  );

  const renderFailed = (mutation: QueuedMutation) => (
    <View
      key={mutation.id}
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.danger }]}
    >
      {renderHeader(mutation, colors.danger)}

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.actionButton, { backgroundColor: colors.accent }]}
          onPress={() => runAction(mutation.id, () => mutationQueue.retry(mutation.id))}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={`Retry ${mutation.type}`}
        >
          <Ionicons name="refresh" size={16} color="#ffffff" />
          <Text style={styles.actionButtonText}>Retry</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionButton, styles.secondaryButton, { borderColor: colors.border }]}
          onPress={() => runAction(mutation.id, () => mutationQueue.discard(mutation.id))}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={`Discard ${mutation.type}`}
        >
          <Ionicons name="trash-outline" size={16} color={colors.text} />
          <Text style={[styles.actionButtonText, { color: colors.text }]}>Discard</Text>
        </TouchableOpacity>
      </View>

      {busyId === mutation.id && (
        <ActivityIndicator color={colors.accent} accessibilityLabel="Updating queue" />
      )}
    </View>
  );

  const renderPending = (mutation: QueuedMutation) => (
    <View
      key={mutation.id}
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      {renderHeader(mutation, mutation.state === 'replaying' ? colors.accent : colors.textSecondary)}
      <Text style={[styles.cardMeta, { color: colors.textSecondary }]} accessible>
        {mutation.state === 'replaying'
          ? 'Sending your change…'
          : 'Waiting to sync. It will be sent automatically once you are back online.'}
      </Text>
    </View>
  );

  const sections: {
    title: string;
    items: QueuedMutation[];
    render: (mutation: QueuedMutation) => React.ReactElement;
  }[] = [
    { title: 'Conflicts', items: groups.conflicted, render: renderConflict },
    { title: 'Failed', items: groups.failed, render: renderFailed },
    { title: 'Sending', items: groups.replaying, render: renderPending },
    { title: 'Pending', items: groups.pending, render: renderPending },
  ];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.topBar}>
        <TouchableOpacity
          onPress={() => router.back()}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]} accessible accessibilityRole="header">
          Offline changes
        </Text>
      </View>

      <Text style={[styles.status, { color: colors.textSecondary }]} accessible>
        {formatMutationQueueStatus(summary)}
      </Text>

      {summary.total === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="cloud-done-outline" size={40} color={colors.success} />
          <Text style={[styles.emptyText, { color: colors.textSecondary }]} accessible>
            Nothing queued. Every change you made has been saved.
          </Text>
        </View>
      ) : (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
          {sections.map((section) =>
            section.items.length === 0 ? null : (
              <View key={section.title} style={styles.section}>
                <Text style={[styles.sectionTitle, { color: colors.textSecondary }]} accessible>
                  {`${section.title} (${section.items.length})`}
                </Text>
                {section.items.map(section.render)}
              </View>
            ),
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 8,
  },
  backButton: {
    padding: 4,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  status: {
    fontSize: 13,
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 4,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: 20,
    paddingBottom: 48,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
    gap: 10,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  cardHeading: {
    flex: 1,
    gap: 4,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  cardMeta: {
    fontSize: 12,
    lineHeight: 17,
  },
  badge: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  compareRow: {
    flexDirection: 'row',
    gap: 10,
  },
  compareColumn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    gap: 4,
  },
  compareLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  compareValue: {
    fontSize: 13,
    lineHeight: 18,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
  },
  actionButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  secondaryButton: {
    borderWidth: 1,
    backgroundColor: 'transparent',
  },
  actionButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
});
