/**
 * Offline mutation queue — AsyncStorage + NetInfo wiring.
 *
 * All queue rules (state transitions, conflict resolution, replay, summary)
 * live in `lib/mutation-queue-core.ts`, which is storage-agnostic so it can be
 * unit tested in the node jest environment. This file is the thin native
 * edge: it binds the queue to the app's AsyncStorage instance under the
 * original `pending_mutation_queue` key and starts a replay pass whenever the
 * device comes back online.
 *
 * `mutationQueue.getQueue() / enqueue() / dequeue() / clear()` keep the exact
 * behaviour (and storage key) of the previous implementation, so existing
 * callers do not change.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';

import {
  createMutationQueue,
  startReplayOnReconnect,
  type MutationQueue,
  type MutationReplayReport,
  type MutationReplayer,
} from './mutation-queue-core';

export * from './mutation-queue-core';

/** `QueueStorage` implementation backed by React Native AsyncStorage. */
export const asyncStorageQueueAdapter = {
  getItem: (key: string): Promise<string | null> => AsyncStorage.getItem(key),
  setItem: (key: string, value: string): Promise<void> => AsyncStorage.setItem(key, value),
  removeItem: (key: string): Promise<void> => AsyncStorage.removeItem(key),
};

const baseQueue = createMutationQueue({
  storage: asyncStorageQueueAdapter,
  onError: (error, context) => {
    console.warn(`[mutation-queue] ${context} failed`, error);
  },
});

let configuredReplayer: MutationReplayer | null = null;

export interface MobileMutationQueue extends Omit<MutationQueue, 'replay'> {
  /** Registers the executor used by {@link MobileMutationQueue.replay}. */
  setReplayer(replayer: MutationReplayer | null): void;
  /**
   * Replays the queue. Without a configured replayer nothing is touched and
   * every queued entry is reported as skipped, so a missing executor can
   * never mark a user's change as failed.
   */
  replay(replayer?: MutationReplayer): Promise<MutationReplayReport>;
}

/**
 * The app-wide queue. Persisted through AsyncStorage under
 * `pending_mutation_queue` (see {@link MUTATION_QUEUE_STORAGE_KEY}).
 */
export const mutationQueue: MobileMutationQueue = {
  ...baseQueue,

  setReplayer(replayer: MutationReplayer | null): void {
    configuredReplayer = replayer;
  },

  async replay(replayer?: MutationReplayer): Promise<MutationReplayReport> {
    const active = replayer ?? configuredReplayer;
    if (!active) {
      const queue = await baseQueue.getQueue();
      return { applied: 0, failed: 0, conflicted: 0, skipped: queue.length };
    }
    return baseQueue.replay(active);
  },
};

let stopReplayOnReconnect: (() => void) | null = null;

/**
 * Starts replaying the queue whenever connectivity returns. Idempotent: the
 * second call returns the existing unsubscribe function instead of attaching
 * a duplicate NetInfo listener.
 */
export function startMutationQueueReplayOnReconnect(): () => void {
  if (stopReplayOnReconnect) {
    return stopReplayOnReconnect;
  }

  stopReplayOnReconnect = startReplayOnReconnect({
    subscribe: (listener) =>
      NetInfo.addEventListener((state) => listener({ isConnected: state.isConnected ?? null })),
    replay: () => mutationQueue.replay(),
    onError: (error) => {
      console.warn('[mutation-queue] replay on reconnect failed', error);
    },
  });

  return stopReplayOnReconnect;
}

export function stopMutationQueueReplayOnReconnect(): void {
  stopReplayOnReconnect?.();
  stopReplayOnReconnect = null;
}
