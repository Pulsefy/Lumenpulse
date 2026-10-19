import {
  MUTATION_QUEUE_STORAGE_KEY,
  createMutationQueue,
  formatMutationQueueStatus,
  groupQueue,
  parseQueuedMutations,
  shouldSurfaceMutationQueue,
  startReplayOnReconnect,
  summarizeQueue,
  toErrorMessage,
} from '../mutation-queue-core';
import type {
  MutationQueue,
  MutationReplayOutcome,
  MutationReplayer,
  QueueStorage,
  QueuedMutation,
} from '../mutation-queue-core';

/** In-memory QueueStorage; `seed` injects raw (possibly corrupt) payloads. */
class MemoryStorage implements QueueStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): Promise<string | null> {
    return Promise.resolve(this.values.get(key) ?? null);
  }

  setItem(key: string, value: string): Promise<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }

  removeItem(key: string): Promise<void> {
    this.values.delete(key);
    return Promise.resolve();
  }

  seed(key: string, value: string): void {
    this.values.set(key, value);
  }

  raw(key: string): string | null {
    return this.values.get(key) ?? null;
  }
}

const makeClock = () => {
  let tick = 0;
  return () => new Date(1_700_000_000_000 + (tick += 1_000));
};

const makeQueue = (
  storage: QueueStorage = new MemoryStorage(),
  overrides: Partial<Parameters<typeof createMutationQueue>[0]> = {},
): MutationQueue =>
  createMutationQueue({
    storage,
    now: makeClock(),
    idFactory: (() => {
      let n = 0;
      return () => `mut-${++n}`;
    })(),
    ...overrides,
  });

type ReplayHandler = () => MutationReplayOutcome;

const applied: MutationReplayOutcome = { status: 'applied' };

const replayWith = (handlers: Record<string, ReplayHandler>): MutationReplayer => (mutation) => {
  const handler = handlers[mutation.id];
  return handler ? handler() : applied;
};

describe('mutation queue state model', () => {
  it('enqueues a mutation in the pending state with bookkeeping fields', async () => {
    const queue = makeQueue();
    const created = await queue.enqueue({ type: 'like', payload: { projectId: 7 } });

    expect(created.type).toBe('like');
    expect(created.payload).toEqual({ projectId: 7 });
    expect(created.state).toBe('pending');
    expect(created.attempts).toBe(0);
    expect(created.lastError).toBeNull();
    expect(created.updatedAt).toBe(created.createdAt);

    const [stored] = await queue.getQueue();
    expect(stored).toEqual(created);
  });

  it('transitions pending -> replaying -> failed and records the error', async () => {
    const queue = makeQueue();
    const created = await queue.enqueue({ type: 'follow', payload: { userId: 1 } });

    const replaying = await queue.markReplaying(created.id);
    expect(replaying?.state).toBe('replaying');
    expect(replaying?.lastError).toBeNull();

    const failed = await queue.markFailed(created.id, new Error('503 from server'));
    expect(failed?.state).toBe('failed');
    expect(failed?.lastError).toBe('503 from server');
    expect(failed?.attempts).toBe(0);
  });

  it('records a conflict with both the local and the server value', async () => {
    const queue = makeQueue();
    const created = await queue.enqueue({ type: 'edit', payload: { title: 'local' } });

    const conflicted = await queue.markConflicted(created.id, {
      localValue: { title: 'local' },
      serverValue: { title: 'server' },
      message: 'Someone else edited this',
    });

    expect(conflicted?.state).toBe('conflicted');
    expect(conflicted?.localValue).toEqual({ title: 'local' });
    expect(conflicted?.serverValue).toEqual({ title: 'server' });
    expect(conflicted?.conflictMessage).toBe('Someone else edited this');
    expect(conflicted?.lastError).toBeNull();
  });

  it('retries a failed mutation and clears the error without losing attempts', async () => {
    const queue = makeQueue();
    const created = await queue.enqueue({ type: 'follow', payload: { userId: 1 } });
    await queue.replay(() => ({ status: 'failed', error: 'network down' }));

    const failed = await queue.findById(created.id);
    expect(failed?.state).toBe('failed');
    expect(failed?.attempts).toBe(1);
    expect(failed?.lastError).toBe('network down');

    const retried = await queue.retry(created.id);
    expect(retried?.state).toBe('pending');
    expect(retried?.lastError).toBeNull();
    expect(retried?.attempts).toBe(1);
  });

  it('refuses to retry a conflicted mutation (it needs an explicit choice)', async () => {
    const queue = makeQueue();
    const created = await queue.enqueue({ type: 'edit', payload: { title: 'local' } });
    await queue.markConflicted(created.id, { localValue: 'a', serverValue: 'b' });

    await expect(queue.retry(created.id)).resolves.toBeNull();
    expect((await queue.findById(created.id))?.state).toBe('conflicted');
  });

  it('returns null when acting on an unknown id', async () => {
    const queue = makeQueue();
    await expect(queue.retry('nope')).resolves.toBeNull();
    await expect(queue.markFailed('nope', 'x')).resolves.toBeNull();
    await expect(queue.resolveConflict('nope', 'local')).resolves.toBeNull();
    await expect(queue.discard('nope')).resolves.toBe(false);
  });

  it('discards a failed mutation', async () => {
    const queue = makeQueue();
    const created = await queue.enqueue({ type: 'follow', payload: { userId: 1 } });
    await queue.markFailed(created.id, 'boom');

    await expect(queue.discard(created.id)).resolves.toBe(true);
    await expect(queue.getQueue()).resolves.toEqual([]);
  });

  it('resolves a conflict by keeping the local value and re-queueing it', async () => {
    const queue = makeQueue();
    const created = await queue.enqueue({ type: 'edit', payload: { title: 'local' } });
    await queue.markConflicted(created.id, {
      localValue: { title: 'local' },
      serverValue: { title: 'server' },
    });

    const resolved = await queue.resolveConflict(created.id, 'local');

    expect(resolved?.state).toBe('pending');
    expect(resolved?.localValue).toEqual({ title: 'local' });
    expect(resolved?.serverValue).toBeUndefined();
    expect(resolved?.conflictMessage).toBeNull();
    expect((await queue.findById(created.id))?.state).toBe('pending');
  });

  it('resolves a conflict by accepting the server value and dropping the mutation', async () => {
    const queue = makeQueue();
    const created = await queue.enqueue({ type: 'edit', payload: { title: 'local' } });
    await queue.markConflicted(created.id, {
      localValue: { title: 'local' },
      serverValue: { title: 'server' },
    });

    const resolved = await queue.resolveConflict(created.id, 'server');

    expect(resolved?.serverValue).toEqual({ title: 'server' });
    await expect(queue.getQueue()).resolves.toEqual([]);
  });

  it('refuses to resolve a mutation that is not conflicted', async () => {
    const queue = makeQueue();
    const created = await queue.enqueue({ type: 'edit', payload: { title: 'local' } });

    await expect(queue.resolveConflict(created.id, 'local')).resolves.toBeNull();
    expect((await queue.findById(created.id))?.state).toBe('pending');
  });

  it('notifies subscribers on change and stops after unsubscribe', async () => {
    const queue = makeQueue();
    const calls: number[] = [];
    const unsubscribe = queue.subscribe(() => calls.push(1));

    await queue.enqueue({ type: 'like', payload: { id: 1 } });
    expect(calls).toHaveLength(1);

    unsubscribe();
    await queue.enqueue({ type: 'like', payload: { id: 2 } });
    expect(calls).toHaveLength(1);
  });

  it('keeps the legacy dequeue/clear behaviour', async () => {
    const queue = makeQueue();
    const first = await queue.enqueue({ type: 'a', payload: {} });
    const second = await queue.enqueue({ type: 'b', payload: {} });

    const head = await queue.dequeue();
    expect(head?.id).toBe(first.id);
    expect((await queue.getQueue()).map((m) => m.id)).toEqual([second.id]);

    await queue.dequeue();
    await expect(queue.dequeue()).resolves.toBeNull();

    await queue.enqueue({ type: 'c', payload: {} });
    await queue.clear();
    await expect(queue.getQueue()).resolves.toEqual([]);
  });

  it('persists state across a fresh queue instance (restart simulation)', async () => {
    const storage = new MemoryStorage();
    const beforeRestart = makeQueue(storage);
    const created = await beforeRestart.enqueue({ type: 'contribute', payload: { amount: '10' } });
    const failed = await beforeRestart.markFailed(created.id, 'network down');

    // A brand new instance over the same storage == relaunching the app.
    const afterRestart = createMutationQueue({ storage, idFactory: () => 'other' });
    const [restored] = await afterRestart.getQueue();

    expect(restored).toEqual(failed);
    expect(restored.state).toBe('failed');
    expect(restored.lastError).toBe('network down');

    // and the restored queue can still act on it
    await afterRestart.retry(created.id);
    expect((await afterRestart.findById(created.id))?.state).toBe('pending');
  });

  it('reads queue data through the shared pending_mutation_queue key', async () => {
    const storage = new MemoryStorage();
    const queue = makeQueue(storage);
    await queue.enqueue({ type: 'like', payload: { id: 1 } });

    expect(MUTATION_QUEUE_STORAGE_KEY).toBe('pending_mutation_queue');
    expect(storage.raw(MUTATION_QUEUE_STORAGE_KEY)).not.toBeNull();
  });
});

describe('mutation queue resilience', () => {
  it('returns an empty queue when storage reads reject', async () => {
    const storage: QueueStorage = {
      getItem: () => Promise.reject(new Error('unavailable')),
      setItem: () => Promise.resolve(),
      removeItem: () => Promise.resolve(),
    };
    const queue = createMutationQueue({ storage });

    await expect(queue.getQueue()).resolves.toEqual([]);
    await expect(queue.getSummary()).resolves.toMatchObject({ total: 0 });
  });

  it('surfaces storage write failures to the caller instead of dropping data', async () => {
    const storage: QueueStorage = {
      getItem: () => Promise.resolve(null),
      setItem: () => Promise.reject(new Error('disk full')),
      removeItem: () => Promise.resolve(),
    };
    const queue = createMutationQueue({ storage });

    await expect(queue.enqueue({ type: 'like', payload: {} })).rejects.toThrow('disk full');
  });

  it('recovers from corrupted JSON and from a non-array payload', async () => {
    const storage = new MemoryStorage();
    storage.seed(MUTATION_QUEUE_STORAGE_KEY, '{not json');

    const queue = createMutationQueue({ storage });
    await expect(queue.getQueue()).resolves.toEqual([]);

    const secondStorage = new MemoryStorage();
    secondStorage.seed(MUTATION_QUEUE_STORAGE_KEY, JSON.stringify({ nope: true }));
    const secondQueue = createMutationQueue({ storage: secondStorage });
    await expect(secondQueue.getQueue()).resolves.toEqual([]);
  });

  it('migrates legacy entries that predate the state model', async () => {
    const storage = new MemoryStorage();
    storage.seed(
      MUTATION_QUEUE_STORAGE_KEY,
      JSON.stringify([
        {
          id: 'legacy-1',
          type: 'like',
          payload: { projectId: 3 },
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ]),
    );

    const queue = createMutationQueue({ storage });
    const [legacy] = await queue.getQueue();

    expect(legacy.state).toBe('pending');
    expect(legacy.attempts).toBe(0);
    expect(legacy.lastError).toBeNull();
    expect(legacy.updatedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('drops malformed entries while keeping valid ones', () => {
    const parsed = parseQueuedMutations(
      JSON.stringify([
        null,
        { type: 'no-id', payload: {} },
        { id: 'no-type', payload: {} },
        'not-an-object',
        { id: 'ok', type: 'like', payload: {}, createdAt: '2026-01-01T00:00:00.000Z' },
      ]),
    );

    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe('ok');
    expect(parseQueuedMutations(undefined)).toEqual([]);
    expect(parseQueuedMutations('[]')).toEqual([]);
  });
});

describe('mutation queue replay', () => {
  it('records applied, failed and conflicted results instead of dropping them', async () => {
    const queue = makeQueue();
    const applied = await queue.enqueue({ type: 'like', payload: { id: 1 } });
    const conflicted = await queue.enqueue({ type: 'edit', payload: { title: 'local' } });
    const failed = await queue.enqueue({ type: 'follow', payload: { id: 2 } });

    const report = await queue.replay(
      replayWith({
        [applied.id]: () => ({ status: 'applied' }),
        [conflicted.id]: () => ({
          status: 'conflict',
          serverValue: { title: 'server' },
          message: 'diverged',
        }),
        [failed.id]: () => ({ status: 'failed', error: new Error('offline') }),
      }),
    );

    expect(report).toEqual({ applied: 1, failed: 1, conflicted: 1, skipped: 0 });

    const remaining = await queue.getQueue();
    expect(remaining.map((m) => m.id)).toEqual([conflicted.id, failed.id]);

    const [conflictItem, failedItem] = remaining;
    expect(conflictItem.state).toBe('conflicted');
    expect(conflictItem.localValue).toEqual({ title: 'local' });
    expect(conflictItem.serverValue).toEqual({ title: 'server' });
    expect(conflictItem.conflictMessage).toBe('diverged');

    expect(failedItem.state).toBe('failed');
    expect(failedItem.attempts).toBe(1);
    expect(failedItem.lastError).toBe('offline');
  });

  it('treats a throwing replayer as a failure for that mutation only', async () => {
    const queue = makeQueue();
    const ok = await queue.enqueue({ type: 'like', payload: {} });
    const boom = await queue.enqueue({ type: 'follow', payload: {} });

    const report = await queue.replay(
      replayWith({
        [ok.id]: () => ({ status: 'applied' }),
        [boom.id]: () => {
          throw new Error('unexpected');
        },
      }),
    );

    expect(report).toEqual({ applied: 1, failed: 1, conflicted: 0, skipped: 0 });
    expect((await queue.findById(ok.id))).toBeNull();
    const failedItem = await queue.findById(boom.id);
    expect(failedItem?.state).toBe('failed');
    expect(failedItem?.lastError).toBe('unexpected');
  });

  it('skips non-pending mutations and returns them to pending after a retry', async () => {
    const queue = makeQueue();
    const pending = await queue.enqueue({ type: 'a', payload: {} });
    const failed = await queue.enqueue({ type: 'b', payload: {} });
    await queue.markFailed(failed.id, 'boom');

    const first = await queue.replay(() => ({ status: 'applied' }));
    expect(first).toEqual({ applied: 1, failed: 0, conflicted: 0, skipped: 1 });
    expect(await queue.findById(pending.id)).toBeNull();
    expect((await queue.findById(failed.id))?.state).toBe('failed');

    await queue.retry(failed.id);
    const second = await queue.replay(() => ({ status: 'applied' }));
    expect(second).toEqual({ applied: 1, failed: 0, conflicted: 0, skipped: 0 });
    await expect(queue.getQueue()).resolves.toEqual([]);
  });

  it('reports nothing to do for an empty queue', async () => {
    const queue = makeQueue();
    await expect(queue.replay(() => ({ status: 'applied' }))).resolves.toEqual({
      applied: 0,
      failed: 0,
      conflicted: 0,
      skipped: 0,
    });
  });

  it('runs the replay on every offline -> online transition', async () => {
    const connectivity: {
      listener: ((state: { isConnected: boolean | null }) => void) | null;
    } = { listener: null };
    let unsubscribeCalls = 0;
    const runs: number[] = [];

    const stop = startReplayOnReconnect({
      subscribe: (next) => {
        connectivity.listener = next;
        return () => {
          unsubscribeCalls += 1;
        };
      },
      replay: () => {
        runs.push(1);
        return Promise.resolve();
      },
    });

    // NetInfo emits the initial offline state, then goes online.
    connectivity.listener?.({ isConnected: false });
    expect(runs).toHaveLength(0);
    connectivity.listener?.({ isConnected: true });
    expect(runs).toHaveLength(1);
    // Still online: no duplicate replay.
    connectivity.listener?.({ isConnected: true });
    expect(runs).toHaveLength(1);
    // Drops again, then reconnects.
    connectivity.listener?.({ isConnected: null });
    connectivity.listener?.({ isConnected: true });
    expect(runs).toHaveLength(2);

    stop();
    expect(unsubscribeCalls).toBe(1);
  });
});

describe('mutation queue summary and indicator status', () => {
  it('counts each state and flags the entries needing attention', async () => {
    const queue = makeQueue();
    const pending = await queue.enqueue({ type: 'a', payload: {} });
    const replaying = await queue.enqueue({ type: 'b', payload: {} });
    const failed = await queue.enqueue({ type: 'c', payload: {} });
    const conflicted = await queue.enqueue({ type: 'd', payload: {} });

    await queue.markReplaying(replaying.id);
    await queue.markFailed(failed.id, 'boom');
    await queue.markConflicted(conflicted.id, { localValue: 'l', serverValue: 's' });

    const summary = await queue.getSummary();
    expect(summary).toEqual({
      pending: 1,
      replaying: 1,
      failed: 1,
      conflicted: 1,
      total: 4,
      needsAttention: 2,
    });

    const groups = await queue.groupByState();
    expect(groups.pending.map((m) => m.id)).toEqual([pending.id]);
    expect(groups.replaying.map((m) => m.id)).toEqual([replaying.id]);
    expect(groups.failed.map((m) => m.id)).toEqual([failed.id]);
    expect(groups.conflicted.map((m) => m.id)).toEqual([conflicted.id]);
  });

  it('summarizes and groups a raw queue array', () => {
    const empty = summarizeQueue([]);
    expect(empty).toEqual({
      pending: 0,
      replaying: 0,
      failed: 0,
      conflicted: 0,
      total: 0,
      needsAttention: 0,
    });
    expect(groupQueue([])).toEqual({ pending: [], replaying: [], failed: [], conflicted: [] });
  });

  it('formats the offline indicator text with pending and failure counts', () => {
    const base = summarizeQueue([]);

    expect(formatMutationQueueStatus(base)).toBe('All changes synced');
    expect(formatMutationQueueStatus(base, { isOffline: true })).toBe('No internet connection');

    expect(
      formatMutationQueueStatus(
        { ...base, pending: 2, replaying: 1, failed: 1, conflicted: 1, total: 5, needsAttention: 2 },
        { isOffline: true },
      ),
    ).toBe('No internet connection · 3 changes pending · 1 failed · 1 conflict');

    expect(
      formatMutationQueueStatus({ ...base, pending: 1, total: 1 }),
    ).toBe('1 change pending');
  });

  it('only surfaces the indicator when offline or there is queued work', () => {
    const base = summarizeQueue([]);

    expect(shouldSurfaceMutationQueue(base, false)).toBe(false);
    expect(shouldSurfaceMutationQueue(base, true)).toBe(true);
    expect(shouldSurfaceMutationQueue({ ...base, total: 1, pending: 1 })).toBe(true);
    expect(
      shouldSurfaceMutationQueue({ ...base, total: 1, failed: 1, needsAttention: 1 }),
    ).toBe(true);
  });
});

describe('toErrorMessage', () => {
  it('normalises every error shape a replayer may throw', () => {
    expect(toErrorMessage(new Error('boom'))).toBe('boom');
    expect(toErrorMessage('plain')).toBe('plain');
    expect(toErrorMessage({ message: 'object message' })).toBe('object message');
    expect(toErrorMessage(undefined)).toBe('Unknown error');
    expect(toErrorMessage(null)).toBe('Unknown error');
    expect(toErrorMessage({ code: 42 })).toBe('{"code":42}');
  });
});
