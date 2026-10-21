import {
  MODERATION_DECISION_MUTATION,
  createModerationDecisionService,
  formatReportAge,
  isDecisionHistoryEntry,
  parseDecisionPayload,
  validateRationale,
  type DecisionHistoryEntry,
  type DecisionHistoryStore,
  type ModerationAction,
  type ModerationStatus,
} from '../moderation-decisions-core';
import type { ApiResponse } from '../api-client';
import type { ContentReport } from '../moderation';
import { createMutationQueue, type MutationQueue, type QueueStorage } from '../mutation-queue-core';

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
}

const makeHistoryStore = (): DecisionHistoryStore & { entries: DecisionHistoryEntry[] } => {
  const store = {
    entries: [] as DecisionHistoryEntry[],
    load: async (): Promise<DecisionHistoryEntry[]> => store.entries,
    save: async (next: readonly DecisionHistoryEntry[]): Promise<void> => {
      store.entries = [...next];
    },
  };
  return store;
};

type ApiMode = 'success' | 'server-error' | 'network-error';

const makeApi = () => {
  const state = {
    mode: 'success' as ApiMode,
    calls: [] as { reportId: string; status: ModerationStatus; reviewNotes?: string }[],
  };

  const updateReport = async (
    reportId: string,
    updates: { status: ModerationStatus; reviewNotes?: string },
  ): Promise<ApiResponse<ContentReport>> => {
    state.calls.push({ reportId, ...updates });

    if (state.mode === 'server-error') {
      return { success: false, error: { message: 'Forbidden', statusCode: 403 } };
    }
    if (state.mode === 'network-error') {
      return { success: false, error: { message: 'Network request failed' } };
    }

    return { success: true, data: { id: reportId } as ContentReport };
  };

  return { state, updateReport };
};

const makeClock = () => {
  let tick = 0;
  return () => new Date(1_700_000_000_000 + (tick += 1) * 60_000);
};

const makeService = (options?: { online?: boolean }) => {
  const api = makeApi();
  const historyStore = makeHistoryStore();
  let counter = 0;
  const queue: MutationQueue = createMutationQueue({
    storage: new MemoryStorage(),
    now: makeClock(),
    idFactory: () => `mut-${++counter}`,
  });

  const service = createModerationDecisionService({
    api,
    queue,
    historyStore,
    isOnline: () => options?.online ?? true,
    now: () => new Date(1_700_000_000_000),
    idFactory: () => `decision-${++counter}`,
  });

  return { service, api, queue, historyStore };
};

describe('validateRationale', () => {
  it('requires a non-empty rationale', () => {
    expect(validateRationale('')).toBe('rationale_required');
    expect(validateRationale('   \n ')).toBe('rationale_required');
    expect(validateRationale('clear spam campaign')).toBeNull();
  });

  it('caps the rationale length', () => {
    expect(validateRationale('x'.repeat(2001))).toBe('rationale_too_long');
    expect(validateRationale('x'.repeat(2000))).toBeNull();
  });
});

describe('formatReportAge', () => {
  const now = Date.parse('2026-10-19T12:00:00.000Z');

  it('formats ages across the expected buckets', () => {
    expect(formatReportAge('2026-10-19T11:59:30.000Z', now)).toBe('just now');
    expect(formatReportAge('2026-10-19T11:40:00.000Z', now)).toBe('20m ago');
    expect(formatReportAge('2026-10-19T07:00:00.000Z', now)).toBe('5h ago');
    expect(formatReportAge('2026-10-17T12:00:00.000Z', now)).toBe('2d ago');
    expect(formatReportAge('2026-07-20T12:00:00.000Z', now)).toBe('3mo ago');
    expect(formatReportAge('2024-10-19T12:00:00.000Z', now)).toBe('2y ago');
  });

  it('never reports a negative age and handles unparseable input', () => {
    expect(formatReportAge('2026-10-19T13:00:00.000Z', now)).toBe('just now');
    expect(formatReportAge('not-a-date', now)).toBe('unknown');
  });
});

describe('payload parsing', () => {
  it('accepts a well formed decision payload', () => {
    const payload = parseDecisionPayload({
      reportId: 'report-1',
      action: 'approve',
      rationale: 'Confirms the claim',
      historyId: 'decision-1',
    });

    expect(payload).toEqual({
      reportId: 'report-1',
      action: 'approve',
      rationale: 'Confirms the claim',
      historyId: 'decision-1',
    });
  });

  it('rejects payloads with a missing or empty rationale', () => {
    expect(
      parseDecisionPayload({ reportId: 'report-1', action: 'approve', historyId: 'd' }),
    ).toBeNull();
    expect(
      parseDecisionPayload({
        reportId: 'report-1',
        action: 'approve',
        rationale: '   ',
        historyId: 'd',
      }),
    ).toBeNull();
  });

  it('rejects unknown actions', () => {
    expect(
      parseDecisionPayload({
        reportId: 'report-1',
        action: 'ignore',
        rationale: 'looks fine',
        historyId: 'd',
      }),
    ).toBeNull();
  });
});

describe('isDecisionHistoryEntry', () => {
  it('accepts stored entries and rejects junk', () => {
    expect(
      isDecisionHistoryEntry({
        id: 'd-1',
        reportId: 'report-1',
        action: 'reject',
        rationale: 'spam',
        createdAt: '2026-10-19T12:00:00.000Z',
        state: 'applied',
      }),
    ).toBe(true);

    expect(isDecisionHistoryEntry({ id: 'd-1' })).toBe(false);
    expect(isDecisionHistoryEntry(null)).toBe(false);
    expect(
      isDecisionHistoryEntry({
        id: 'd-1',
        reportId: 'report-1',
        action: 'ignore',
        rationale: 'spam',
        createdAt: '2026-10-19T12:00:00.000Z',
        state: 'applied',
      }),
    ).toBe(false);
  });
});

describe('moderation decision service', () => {
  it('refuses to submit a decision without a rationale', async () => {
    const { service, api, queue } = makeService();

    const result = await service.submitDecision({
      reportId: 'report-1',
      action: 'approve',
      rationale: '  ',
    });

    expect(result.ok).toBe(false);
    expect(result.validationError).toBe('rationale_required');
    expect(api.state.calls).toHaveLength(0);
    expect(await queue.getQueue()).toHaveLength(0);
  });

  it('maps each action onto its report status and records the rationale', async () => {
    const cases: { action: ModerationAction; status: ModerationStatus }[] = [
      { action: 'approve', status: 'resolved' },
      { action: 'reject', status: 'dismissed' },
      { action: 'escalate', status: 'under_review' },
    ];

    for (const testCase of cases) {
      const { service, api, historyStore } = makeService();

      const result = await service.submitDecision({
        reportId: 'report-1',
        action: testCase.action,
        rationale: 'Investigated and confirmed',
      });

      expect(result.ok).toBe(true);
      expect(result.queued).toBe(false);
      expect(api.state.calls[0]).toEqual({
        reportId: 'report-1',
        status: testCase.status,
        reviewNotes: 'Investigated and confirmed',
      });
      expect(historyStore.entries[0].state).toBe('applied');
      expect(historyStore.entries[0].rationale).toBe('Investigated and confirmed');
    }
  });

  it('queues the decision while offline instead of dropping it', async () => {
    const { service, api, queue, historyStore } = makeService({ online: false });

    const result = await service.submitDecision({
      reportId: 'report-1',
      action: 'reject',
      rationale: 'Obvious phishing link',
    });

    expect(result.ok).toBe(true);
    expect(result.queued).toBe(true);
    expect(api.state.calls).toHaveLength(0);

    const queued = await queue.getQueue();
    expect(queued).toHaveLength(1);
    expect(queued[0].type).toBe(MODERATION_DECISION_MUTATION);
    expect(queued[0].payload).toMatchObject({
      reportId: 'report-1',
      action: 'reject',
      rationale: 'Obvious phishing link',
    });
    expect(historyStore.entries[0].state).toBe('queued');
  });

  it('queues the decision when the request fails without a status code', async () => {
    const { service, api, queue } = makeService();
    api.state.mode = 'network-error';

    const result = await service.submitDecision({
      reportId: 'report-1',
      action: 'escalate',
      rationale: 'Needs a second pair of eyes',
    });

    expect(result.ok).toBe(true);
    expect(result.queued).toBe(true);
    expect(await queue.getQueue()).toHaveLength(1);
  });

  it('surfaces a server rejection without queueing anything', async () => {
    const { service, api, queue, historyStore } = makeService();
    api.state.mode = 'server-error';

    const result = await service.submitDecision({
      reportId: 'report-1',
      action: 'approve',
      rationale: 'Looks good',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Forbidden');
    expect(await queue.getQueue()).toHaveLength(0);
    expect(historyStore.entries).toHaveLength(0);
  });

  it('surfaces live queue state in the decision history', async () => {
    const { service, queue } = makeService({ online: false });

    await service.submitDecision({
      reportId: 'report-1',
      action: 'approve',
      rationale: 'Verified on chain',
    });

    expect((await service.getHistory('report-1'))[0].state).toBe('queued');
    expect(await service.getHistory('report-2')).toHaveLength(0);

    const [queued] = await queue.getQueue();
    await queue.markReplaying(queued.id);
    expect((await service.getHistory('report-1'))[0].state).toBe('syncing');

    await queue.markFailed(queued.id, new Error('offline again'));
    const [failed] = await service.getHistory('report-1');
    expect(failed.state).toBe('failed');
    expect(failed.error).toBe('offline again');
  });

  it('replays a queued decision through the mutation queue', async () => {
    const { service, api, queue, historyStore } = makeService({ online: false });

    await service.submitDecision({
      reportId: 'report-1',
      action: 'reject',
      rationale: 'Duplicate of report-2',
    });

    const report = await queue.replay(service.replay);

    expect(report.applied).toBe(1);
    expect(await queue.getQueue()).toHaveLength(0);
    expect(api.state.calls[0].status).toBe('dismissed');
    expect(historyStore.entries[0].state).toBe('applied');
  });

  it('marks a queued decision as failed when the server rejects it', async () => {
    const { service, api, queue, historyStore } = makeService({ online: false });

    await service.submitDecision({
      reportId: 'report-1',
      action: 'approve',
      rationale: 'Looks good',
    });
    api.state.mode = 'server-error';

    const report = await queue.replay(service.replay);

    expect(report.failed).toBe(1);
    const [mutation] = await queue.getQueue();
    expect(mutation.state).toBe('failed');
    expect(mutation.lastError).toBe('Forbidden');
    expect(historyStore.entries[0].state).toBe('failed');
    expect(historyStore.entries[0].error).toBe('Forbidden');
  });

  it('keeps decisions for different reports separated', async () => {
    const { service } = makeService({ online: false });

    await service.submitDecision({ reportId: 'report-1', action: 'approve', rationale: 'a' });
    await service.submitDecision({ reportId: 'report-2', action: 'reject', rationale: 'b' });

    expect(await service.getHistory('report-1')).toHaveLength(1);
    expect(await service.getHistory('report-2')).toHaveLength(1);
  });
});
