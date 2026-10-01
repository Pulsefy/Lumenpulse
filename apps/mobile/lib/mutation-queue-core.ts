/**
 * Offline mutation queue — state model, persistence, replay and summary.
 *
 * This module is deliberately free of React Native / Expo / AsyncStorage
 * imports so the queue rules can be unit tested in the node jest environment
 * exactly like `lib/contribution-drafts.ts`. `lib/mutation-queue.ts` wires it
 * to AsyncStorage (`mutationQueue` singleton) and NetInfo (replay on
 * reconnect); the UI layers live in `lib/offline-indicator.tsx` and
 * `app/settings/mutation-queue.tsx`.
 *
 * Every queued mutation carries an explicit lifecycle state so a replay that
 * fails or conflicts is never silently dropped:
 *
 *   pending ──▶ replaying ──▶ (removed on success)
 *      ▲            │
 *      │            ├──▶ failed       (retry / discard)
 *      │            └──▶ conflicted   (resolve: keep local / use server)
 *      └── retry / resolve("local")
 */

export const MUTATION_QUEUE_STORAGE_KEY = 'pending_mutation_queue';

export type MutationState = 'pending' | 'replaying' | 'failed' | 'conflicted';

const MUTATION_STATES: readonly MutationState[] = [
  'pending',
  'replaying',
  'failed',
  'conflicted',
];

export interface MutationConflict {
  /** The value the user wrote while offline. */
  localValue: unknown;
  /** The value currently held by the server. */
  serverValue: unknown;
  message?: string | null;
}

export interface QueuedMutation {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
  /** Lifecycle state. Missing on legacy entries, which are read as `pending`. */
  state: MutationState;
  /** How many replay attempts were made so far. */
  attempts: number;
  /** Last replay error, or `null` when there is none. */
  lastError: string | null;
  /** ISO timestamp of the last state change. */
  updatedAt: string;
  /** For `conflicted` entries: the local (offline) value. */
  localValue?: unknown;
  /** For `conflicted` entries: the value the server reported. */
  serverValue?: unknown;
  /** For `conflicted` entries: human readable explanation. */
  conflictMessage?: string | null;
}

/**
 * @deprecated Use {@link QueuedMutation}. Kept as an alias so existing
 * importers of `PendingMutation` keep compiling.
 */
export type PendingMutation = QueuedMutation;

export interface EnqueueMutationInput {
  type: string;
  payload: Record<string, unknown>;
  /** Optional local value recorded for later conflict resolution. */
  localValue?: unknown;
}

export interface QueueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface MutationQueueSummary {
  pending: number;
  replaying: number;
  failed: number;
  conflicted: number;
  total: number;
  /** `failed` + `conflicted` — entries the user has to act on. */
  needsAttention: number;
}

export type MutationQueueGroups = Record<MutationState, QueuedMutation[]>;

export type MutationReplayOutcome =
  | { status: 'applied'; serverValue?: unknown }
  | { status: 'conflict'; localValue?: unknown; serverValue: unknown; message?: string }
  | { status: 'failed'; error?: unknown };

export type MutationReplayer = (
  mutation: QueuedMutation,
) => Promise<MutationReplayOutcome> | MutationReplayOutcome;

export interface MutationReplayReport {
  applied: number;
  failed: number;
  conflicted: number;
  skipped: number;
}

export type ConflictResolution = 'local' | 'server';

export interface MutationQueueStatusOptions {
  isOffline?: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Normalise an unknown error into a stable, user-safe message. */
export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name || 'Unknown error';
  }
  if (typeof error === 'string' && error) {
    return error;
  }
  if (isRecord(error) && typeof error.message === 'string' && error.message) {
    return error.message;
  }
  if (error === undefined || error === null) {
    return 'Unknown error';
  }
  try {
    const serialized = JSON.stringify(error);
    return serialized && serialized !== '{}' ? serialized : 'Unknown error';
  } catch {
    return 'Unknown error';
  }
}

/**
 * Defensively parse one persisted entry. Legacy entries written before the
 * state model existed (no `state` / `attempts` / `updatedAt`) are upgraded to
 * `pending`, so an app restart across a version boundary keeps the queue.
 */
export function parseQueuedMutation(raw: unknown): QueuedMutation | null {
  if (!isRecord(raw)) {
    return null;
  }

  const { id, type } = raw;
  if (typeof id !== 'string' || !id) {
    return null;
  }
  if (typeof type !== 'string' || !type) {
    return null;
  }

  const updatedAt =
    typeof raw.updatedAt === 'string' && raw.updatedAt ? raw.updatedAt : null;
  const createdAt =
    typeof raw.createdAt === 'string' && raw.createdAt
      ? raw.createdAt
      : (updatedAt ?? new Date(0).toISOString());

  const state = MUTATION_STATES.includes(raw.state as MutationState)
    ? (raw.state as MutationState)
    : 'pending';

  const attempts =
    typeof raw.attempts === 'number' && Number.isFinite(raw.attempts) && raw.attempts > 0
      ? Math.floor(raw.attempts)
      : 0;

  const mutation: QueuedMutation = {
    id,
    type,
    payload: isRecord(raw.payload) ? raw.payload : {},
    createdAt,
    state,
    attempts,
    lastError: typeof raw.lastError === 'string' && raw.lastError ? raw.lastError : null,
    updatedAt: updatedAt ?? createdAt,
  };

  if ('localValue' in raw) {
    mutation.localValue = raw.localValue;
  }
  if ('serverValue' in raw) {
    mutation.serverValue = raw.serverValue;
  }
  if (typeof raw.conflictMessage === 'string' || raw.conflictMessage === null) {
    mutation.conflictMessage = raw.conflictMessage;
  }

  return mutation;
}

/** Parse a raw AsyncStorage value into a valid queue, dropping junk entries. */
export function parseQueuedMutations(raw: string | null | undefined): QueuedMutation[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map(parseQueuedMutation)
      .filter((mutation): mutation is QueuedMutation => mutation !== null);
  } catch {
    return [];
  }
}

export function summarizeQueue(queue: readonly QueuedMutation[]): MutationQueueSummary {
  const summary: MutationQueueSummary = {
    pending: 0,
    replaying: 0,
    failed: 0,
    conflicted: 0,
    total: queue.length,
    needsAttention: 0,
  };

  for (const mutation of queue) {
    summary[mutation.state] += 1;
  }
  summary.needsAttention = summary.failed + summary.conflicted;
  return summary;
}

const EMPTY_GROUPS = (): MutationQueueGroups => ({
  pending: [],
  replaying: [],
  failed: [],
  conflicted: [],
});

export function groupQueue(queue: readonly QueuedMutation[]): MutationQueueGroups {
  const groups = EMPTY_GROUPS();
  for (const mutation of queue) {
    groups[mutation.state].push(mutation);
  }
  return groups;
}

/**
 * Human readable one-liner for the offline indicator / accessibility label.
 * Pending and replaying counts are combined because both mean "not settled".
 */
export function formatMutationQueueStatus(
  summary: MutationQueueSummary,
  options: MutationQueueStatusOptions = {},
): string {
  const parts: string[] = [];
  if (options.isOffline) {
    parts.push('No internet connection');
  }

  const waiting = summary.pending + summary.replaying;
  if (waiting > 0) {
    parts.push(`${waiting} change${waiting === 1 ? '' : 's'} pending`);
  }
  if (summary.failed > 0) {
    parts.push(`${summary.failed} failed`);
  }
  if (summary.conflicted > 0) {
    parts.push(`${summary.conflicted} conflict${summary.conflicted === 1 ? '' : 's'}`);
  }

  if (parts.length === 0) {
    return options.isOffline ? 'No internet connection' : 'All changes synced';
  }
  return parts.join(' · ');
}

/** Whether there is anything worth showing in the indicator. */
export function shouldSurfaceMutationQueue(
  summary: MutationQueueSummary,
  isOffline = false,
): boolean {
  return isOffline || summary.total > 0;
}

export interface MutationQueueOptions {
  storage: QueueStorage;
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
  /** Injectable id generator; defaults to the previous 7-char random id. */
  idFactory?: () => string;
  /** Receives storage / subscriber failures instead of throwing at the caller. */
  onError?: (error: unknown, context: string) => void;
}

export interface MutationQueue {
  readonly storageKey: string;
  /** The whole queue, in insertion order. */
  getQueue(): Promise<QueuedMutation[]>;
  getSummary(): Promise<MutationQueueSummary>;
  groupByState(): Promise<MutationQueueGroups>;
  findById(id: string): Promise<QueuedMutation | null>;
  enqueue(mutation: EnqueueMutationInput): Promise<QueuedMutation>;
  /** Removes and returns the head of the queue (legacy behaviour). */
  dequeue(): Promise<QueuedMutation | null>;
  clear(): Promise<void>;
  markReplaying(id: string): Promise<QueuedMutation | null>;
  markPending(id: string): Promise<QueuedMutation | null>;
  markFailed(id: string, error: unknown): Promise<QueuedMutation | null>;
  markConflicted(id: string, conflict: MutationConflict): Promise<QueuedMutation | null>;
  /** Re-queues a `failed` mutation as `pending`. Returns null for conflicts. */
  retry(id: string): Promise<QueuedMutation | null>;
  /** Drops a mutation, whichever state it is in. */
  discard(id: string): Promise<boolean>;
  /**
   * Resolves a conflict. `local` re-queues the local value for replay;
   * `server` accepts the server value and drops the local mutation.
   * Returns the affected entry, or null when the id is unknown / not conflicted.
   */
  resolveConflict(id: string, choice: ConflictResolution): Promise<QueuedMutation | null>;
  /** Replays every `pending` mutation once, recording failures / conflicts. */
  replay(replayer: MutationReplayer): Promise<MutationReplayReport>;
  /** Subscribe to queue changes. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
}

const defaultIdFactory = (): string => Math.random().toString(36).substring(2, 9);

const resolveLocalValue = (mutation: QueuedMutation): unknown =>
  mutation.localValue === undefined ? mutation.payload : mutation.localValue;

export function createMutationQueue(options: MutationQueueOptions): MutationQueue {
  const { storage, onError } = options;
  const now = options.now ?? ((): Date => new Date());
  const idFactory = options.idFactory ?? defaultIdFactory;
  const storageKey = MUTATION_QUEUE_STORAGE_KEY;
  const listeners = new Set<() => void>();

  // Serialise read-modify-write cycles so concurrent callers cannot interleave.
  let lock: Promise<unknown> = Promise.resolve();

  const report = (context: string, error: unknown): void => {
    try {
      onError?.(error, context);
    } catch {
      // A failing error handler must never take the queue down.
    }
  };

  const notify = (): void => {
    for (const listener of Array.from(listeners)) {
      try {
        listener();
      } catch (error) {
        report('subscriber', error);
      }
    }
  };

  const read = async (): Promise<QueuedMutation[]> => {
    try {
      return parseQueuedMutations(await storage.getItem(storageKey));
    } catch (error) {
      report('read', error);
      return [];
    }
  };

  const write = async (queue: readonly QueuedMutation[]): Promise<void> => {
    await storage.setItem(storageKey, JSON.stringify(queue));
    notify();
  };

  const serialize = <T>(task: () => Promise<T>): Promise<T> => {
    const run = lock.then(task, task);
    lock = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const timestamp = (): string => now().toISOString();

  const patch = (
    id: string,
    updater: (mutation: QueuedMutation) => QueuedMutation,
  ): Promise<QueuedMutation | null> =>
    serialize(async () => {
      const queue = await read();
      const index = queue.findIndex((mutation) => mutation.id === id);
      if (index === -1) {
        return null;
      }
      const updated = updater(queue[index]);
      queue[index] = updated;
      await write(queue);
      return updated;
    });

  const getQueue = (): Promise<QueuedMutation[]> => serialize(read);

  return {
    storageKey,

    getQueue,

    async getSummary(): Promise<MutationQueueSummary> {
      return summarizeQueue(await getQueue());
    },

    async groupByState(): Promise<MutationQueueGroups> {
      return groupQueue(await getQueue());
    },

    async findById(id: string): Promise<QueuedMutation | null> {
      const queue = await getQueue();
      return queue.find((mutation) => mutation.id === id) ?? null;
    },

    async enqueue(mutation: EnqueueMutationInput): Promise<QueuedMutation> {
      return serialize(async () => {
        const queue = await read();
        const createdAt = timestamp();
        const item: QueuedMutation = {
          id: idFactory(),
          type: mutation.type,
          payload: mutation.payload,
          createdAt,
          state: 'pending',
          attempts: 0,
          lastError: null,
          updatedAt: createdAt,
        };
        if ('localValue' in mutation) {
          item.localValue = mutation.localValue;
        }
        queue.push(item);
        await write(queue);
        return item;
      });
    },

    async dequeue(): Promise<QueuedMutation | null> {
      return serialize(async () => {
        const queue = await read();
        if (queue.length === 0) {
          return null;
        }
        const [head, ...rest] = queue;
        await write(rest);
        return head;
      });
    },

    async clear(): Promise<void> {
      await serialize(async () => {
        await storage.removeItem(storageKey);
        notify();
      });
    },

    markReplaying(id: string): Promise<QueuedMutation | null> {
      return patch(id, (mutation) => ({
        ...mutation,
        state: 'replaying',
        lastError: null,
        updatedAt: timestamp(),
      }));
    },

    markPending(id: string): Promise<QueuedMutation | null> {
      return patch(id, (mutation) => ({
        ...mutation,
        state: 'pending',
        lastError: null,
        updatedAt: timestamp(),
      }));
    },

    markFailed(id: string, error: unknown): Promise<QueuedMutation | null> {
      return patch(id, (mutation) => ({
        ...mutation,
        state: 'failed',
        lastError: toErrorMessage(error),
        updatedAt: timestamp(),
      }));
    },

    markConflicted(id: string, conflict: MutationConflict): Promise<QueuedMutation | null> {
      return patch(id, (mutation) => ({
        ...mutation,
        state: 'conflicted',
        localValue: conflict.localValue,
        serverValue: conflict.serverValue,
        conflictMessage:
          conflict.message ?? 'The server value changed while you were offline.',
        lastError: null,
        updatedAt: timestamp(),
      }));
    },

    async retry(id: string): Promise<QueuedMutation | null> {
      return serialize(async () => {
        const queue = await read();
        const index = queue.findIndex((mutation) => mutation.id === id);
        if (index === -1) {
          return null;
        }
        // A conflict needs an explicit local/server choice, not a blind retry.
        if (queue[index].state === 'conflicted') {
          return null;
        }
        const updated: QueuedMutation = {
          ...queue[index],
          state: 'pending',
          lastError: null,
          updatedAt: timestamp(),
        };
        queue[index] = updated;
        await write(queue);
        return updated;
      });
    },

    async discard(id: string): Promise<boolean> {
      return serialize(async () => {
        const queue = await read();
        const next = queue.filter((mutation) => mutation.id !== id);
        if (next.length === queue.length) {
          return false;
        }
        await write(next);
        return true;
      });
    },

    async resolveConflict(
      id: string,
      choice: ConflictResolution,
    ): Promise<QueuedMutation | null> {
      return serialize(async () => {
        const queue = await read();
        const index = queue.findIndex((mutation) => mutation.id === id);
        if (index === -1) {
          return null;
        }
        const current = queue[index];
        if (current.state !== 'conflicted') {
          return null;
        }

        if (choice === 'server') {
          queue.splice(index, 1);
          await write(queue);
          return current;
        }

        const resolved: QueuedMutation = {
          ...current,
          state: 'pending',
          localValue: resolveLocalValue(current),
          conflictMessage: null,
          lastError: null,
          updatedAt: timestamp(),
        };
        delete resolved.serverValue;
        queue[index] = resolved;
        await write(queue);
        return resolved;
      });
    },

    async replay(replayer: MutationReplayer): Promise<MutationReplayReport> {
      return serialize(async () => {
        const queue = await read();
        const candidateIds = queue
          .filter((mutation) => mutation.state === 'pending')
          .map((mutation) => mutation.id);

        const report: MutationReplayReport = {
          applied: 0,
          failed: 0,
          conflicted: 0,
          skipped: queue.length - candidateIds.length,
        };

        for (const id of candidateIds) {
          const index = queue.findIndex((mutation) => mutation.id === id);
          if (index === -1) {
            continue;
          }

          const replaying: QueuedMutation = {
            ...queue[index],
            state: 'replaying',
            attempts: queue[index].attempts + 1,
            lastError: null,
            updatedAt: timestamp(),
          };
          queue[index] = replaying;
          await write(queue);

          let outcome: MutationReplayOutcome;
          try {
            outcome = await replayer({ ...replaying });
          } catch (error) {
            outcome = { status: 'failed', error };
          }

          const currentIndex = queue.findIndex((mutation) => mutation.id === id);
          if (currentIndex === -1) {
            // Discarded while the replay was in flight — leave it be.
            continue;
          }

          if (outcome.status === 'applied') {
            queue.splice(currentIndex, 1);
            report.applied += 1;
            await write(queue);
            continue;
          }

          if (outcome.status === 'conflict') {
            queue[currentIndex] = {
              ...queue[currentIndex],
              state: 'conflicted',
              localValue:
                outcome.localValue === undefined
                  ? resolveLocalValue(queue[currentIndex])
                  : outcome.localValue,
              serverValue: outcome.serverValue,
              conflictMessage:
                outcome.message ?? 'The server value changed while you were offline.',
              lastError: null,
              updatedAt: timestamp(),
            };
            report.conflicted += 1;
            await write(queue);
            continue;
          }

          queue[currentIndex] = {
            ...queue[currentIndex],
            state: 'failed',
            lastError: toErrorMessage(outcome.error),
            updatedAt: timestamp(),
          };
          report.failed += 1;
          await write(queue);
        }

        return report;
      });
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** Connectivity state shape shared with `@react-native-community/netinfo`. */
export interface ConnectivityState {
  isConnected: boolean | null;
}

export type ConnectivitySubscriber = (
  listener: (state: ConnectivityState) => void,
) => () => void;

export interface ReplayOnReconnectOptions {
  subscribe: ConnectivitySubscriber;
  replay: () => Promise<unknown>;
  onError?: (error: unknown) => void;
}

/**
 * Runs `replay` whenever connectivity is (re)gained. NetInfo fires the
 * listener immediately with the current state, so this also covers launch.
 * Returns an unsubscribe function.
 */
export function startReplayOnReconnect(options: ReplayOnReconnectOptions): () => void {
  let wasOnline = false;

  const run = (): void => {
    void options.replay().catch((error) => {
      try {
        options.onError?.(error);
      } catch {
        // ignore
      }
    });
  };

  const unsubscribe = options.subscribe((state) => {
    const isOnline = state.isConnected === true;
    if (isOnline && !wasOnline) {
      run();
    }
    wasOnline = isOnline;
  });

  return () => {
    unsubscribe();
  };
}
