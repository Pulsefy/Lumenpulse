import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';

import { cache } from './cache';
import { moderationApi, ReportStatus } from './moderation';
import {
  MODERATION_DECISION_MUTATION,
  createModerationDecisionService,
  isDecisionHistoryEntry,
  type DecisionHistoryEntry,
  type DecisionHistoryStore,
} from './moderation-decisions-core';
import { mutationQueue } from './mutation-queue';
import { startReplayOnReconnect } from './mutation-queue-core';

export const MODERATION_DECISION_HISTORY_KEY = 'moderation_decision_history_v1';

export const asyncStorageDecisionHistoryStore: DecisionHistoryStore = {
  async load(): Promise<DecisionHistoryEntry[]> {
    try {
      const raw = await AsyncStorage.getItem(MODERATION_DECISION_HISTORY_KEY);
      if (!raw) {
        return [];
      }
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(isDecisionHistoryEntry) : [];
    } catch {
      return [];
    }
  },

  async save(entries: readonly DecisionHistoryEntry[]): Promise<void> {
    try {
      await AsyncStorage.setItem(MODERATION_DECISION_HISTORY_KEY, JSON.stringify(entries));
    } catch (error) {
      console.warn('[moderation] failed to save decision history', error);
    }
  },
};

export const moderationDecisions = createModerationDecisionService({
  api: {
    updateReport: (reportId, updates) =>
      moderationApi.updateReport(reportId, {
        status: updates.status as ReportStatus,
        reviewNotes: updates.reviewNotes,
      }),
  },
  queue: mutationQueue,
  historyStore: asyncStorageDecisionHistoryStore,
  isOnline: () => cache.isOnlineStatus(),
});

let flushInFlight: Promise<{ applied: number; failed: number }> | null = null;

async function runFlush(): Promise<{ applied: number; failed: number }> {
  const queue = await mutationQueue.getQueue();
  const pending = queue.filter(
    (mutation) => mutation.type === MODERATION_DECISION_MUTATION && mutation.state === 'pending',
  );

  let applied = 0;
  let failed = 0;

  for (const mutation of pending) {
    const replaying = await mutationQueue.markReplaying(mutation.id);
    if (!replaying) {
      continue;
    }

    const outcome = await moderationDecisions.replay(replaying);

    if (outcome.status === 'applied') {
      await mutationQueue.discard(mutation.id);
      applied += 1;
      continue;
    }

    await mutationQueue.markFailed(
      mutation.id,
      outcome.status === 'failed' ? outcome.error : 'Unable to sync this decision',
    );
    failed += 1;
  }

  return { applied, failed };
}

/**
 * Replays only moderation decisions. Other mutation types stay untouched so
 * this feature cannot interfere with queues owned by other modules.
 */
export function flushModerationDecisions(): Promise<{ applied: number; failed: number }> {
  if (!flushInFlight) {
    flushInFlight = runFlush().finally(() => {
      flushInFlight = null;
    });
  }
  return flushInFlight;
}

let stopModerationSync: (() => void) | null = null;

export function startModerationDecisionSync(): () => void {
  if (stopModerationSync) {
    return stopModerationSync;
  }

  stopModerationSync = startReplayOnReconnect({
    subscribe: (listener) =>
      NetInfo.addEventListener((state) => listener({ isConnected: state.isConnected ?? null })),
    replay: async () => {
      await flushModerationDecisions();
    },
    onError: (error) => {
      console.warn('[moderation] decision sync on reconnect failed', error);
    },
  });

  return stopModerationSync;
}

export function stopModerationDecisionSync(): void {
  stopModerationSync?.();
  stopModerationSync = null;
}
