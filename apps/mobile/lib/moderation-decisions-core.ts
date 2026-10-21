import type { ApiResponse } from './api-client';
import type { ContentReport } from './moderation';
import type { MutationReplayer, QueuedMutation } from './mutation-queue-core';

export const MODERATION_DECISION_MUTATION = 'moderation.decision';
export const MODERATION_HISTORY_LIMIT = 500;
export const MAX_RATIONALE_LENGTH = 2000;

export type ModerationAction = 'approve' | 'reject' | 'escalate';
export type ModerationStatus = 'resolved' | 'dismissed' | 'under_review';
export type DecisionSyncState = 'queued' | 'syncing' | 'failed' | 'applied';
export type RationaleValidationError = 'rationale_required' | 'rationale_too_long';

export const MODERATION_ACTIONS: readonly ModerationAction[] = ['approve', 'reject', 'escalate'];

export const MODERATION_ACTION_STATUS: Record<ModerationAction, ModerationStatus> = {
  approve: 'resolved',
  reject: 'dismissed',
  escalate: 'under_review',
};

export interface ModerationDecisionInput {
  reportId: string;
  action: ModerationAction;
  rationale: string;
}

export interface ModerationDecisionPayload extends ModerationDecisionInput {
  historyId: string;
}

export interface DecisionHistoryEntry {
  id: string;
  reportId: string;
  action: ModerationAction;
  rationale: string;
  createdAt: string;
  state: DecisionSyncState;
  error?: string | null;
}

export interface DecisionHistoryStore {
  load(): Promise<DecisionHistoryEntry[]>;
  save(entries: readonly DecisionHistoryEntry[]): Promise<void>;
}

export interface ModerationDecisionApi {
  updateReport(
    reportId: string,
    updates: { status: ModerationStatus; reviewNotes?: string },
  ): Promise<ApiResponse<ContentReport>>;
}

export interface ModerationDecisionQueue {
  enqueue(mutation: { type: string; payload: Record<string, unknown> }): Promise<QueuedMutation>;
  getQueue(): Promise<QueuedMutation[]>;
}

export interface ModerationDecisionDeps {
  api: ModerationDecisionApi;
  queue: ModerationDecisionQueue;
  historyStore: DecisionHistoryStore;
  isOnline: () => boolean;
  now?: () => Date;
  idFactory?: () => string;
}

export interface ModerationDecisionResult {
  ok: boolean;
  queued: boolean;
  error?: string;
  validationError?: RationaleValidationError | 'unknown_action';
  entry?: DecisionHistoryEntry;
}

export function isModerationAction(value: unknown): value is ModerationAction {
  return value === 'approve' || value === 'reject' || value === 'escalate';
}

export function validateRationale(value: string): RationaleValidationError | null {
  const rationale = value.trim();
  if (!rationale) {
    return 'rationale_required';
  }
  if (rationale.length > MAX_RATIONALE_LENGTH) {
    return 'rationale_too_long';
  }
  return null;
}

export function parseDecisionPayload(
  payload: Record<string, unknown>,
): ModerationDecisionPayload | null {
  const { reportId, action, rationale, historyId } = payload;

  if (
    typeof reportId !== 'string' ||
    !reportId ||
    typeof rationale !== 'string' ||
    validateRationale(rationale) !== null ||
    !isModerationAction(action) ||
    typeof historyId !== 'string'
  ) {
    return null;
  }

  return {
    reportId,
    action,
    rationale: rationale.trim(),
    historyId,
  };
}

export function isDecisionHistoryEntry(value: unknown): value is DecisionHistoryEntry {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === 'string' &&
    typeof entry.reportId === 'string' &&
    isModerationAction(entry.action) &&
    typeof entry.rationale === 'string' &&
    typeof entry.createdAt === 'string' &&
    (entry.state === 'queued' ||
      entry.state === 'syncing' ||
      entry.state === 'failed' ||
      entry.state === 'applied')
  );
}

/**
 * Human readable age for a report, used on the queue card and detail view.
 */
export function formatReportAge(createdAt: string, now: number = Date.now()): string {
  const timestamp = Date.parse(createdAt);
  if (Number.isNaN(timestamp)) {
    return 'unknown';
  }

  const diff = Math.max(0, now - timestamp);
  const minutes = Math.floor(diff / 60_000);

  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  if (days < 30) {
    return `${days}d ago`;
  }

  const months = Math.floor(days / 30);
  if (months < 12) {
    return `${months}mo ago`;
  }

  return `${Math.floor(months / 12)}y ago`;
}

function liveState(mutation: QueuedMutation): DecisionSyncState {
  if (mutation.state === 'replaying') {
    return 'syncing';
  }
  if (mutation.state === 'pending') {
    return 'queued';
  }
  return 'failed';
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'Unable to sync this decision';
}

export function createModerationDecisionService(deps: ModerationDecisionDeps) {
  const now = deps.now ?? (() => new Date());
  const idFactory =
    deps.idFactory ??
    (() => `moderation-decision-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

  const writeEntry = async (entry: DecisionHistoryEntry): Promise<void> => {
    const entries = await deps.historyStore.load();
    const next = [entry, ...entries.filter((existing) => existing.id !== entry.id)].slice(
      0,
      MODERATION_HISTORY_LIMIT,
    );
    await deps.historyStore.save(next);
  };

  const updateEntry = async (
    id: string,
    patch: Partial<Pick<DecisionHistoryEntry, 'state' | 'error'>>,
  ): Promise<void> => {
    const entries = await deps.historyStore.load();
    let found = false;
    const next = entries.map((entry) => {
      if (entry.id !== id) {
        return entry;
      }
      found = true;
      return { ...entry, ...patch };
    });

    if (found) {
      await deps.historyStore.save(next);
    }
  };

  const enqueueDecision = async (
    entry: DecisionHistoryEntry,
  ): Promise<ModerationDecisionResult> => {
    await deps.queue.enqueue({
      type: MODERATION_DECISION_MUTATION,
      payload: {
        reportId: entry.reportId,
        action: entry.action,
        rationale: entry.rationale,
        historyId: entry.id,
      },
    });
    await writeEntry(entry);
    return { ok: true, queued: true, entry };
  };

  const submitDecision = async (
    input: ModerationDecisionInput,
  ): Promise<ModerationDecisionResult> => {
    const rationale = input.rationale.trim();
    const validationError = validateRationale(rationale);
    if (validationError) {
      return { ok: false, queued: false, validationError };
    }

    if (!isModerationAction(input.action)) {
      return { ok: false, queued: false, validationError: 'unknown_action' };
    }

    const entry: DecisionHistoryEntry = {
      id: idFactory(),
      reportId: input.reportId,
      action: input.action,
      rationale,
      createdAt: now().toISOString(),
      state: 'queued',
      error: null,
    };

    if (!deps.isOnline()) {
      return enqueueDecision(entry);
    }

    let response: ApiResponse<ContentReport>;
    try {
      response = await deps.api.updateReport(input.reportId, {
        status: MODERATION_ACTION_STATUS[input.action],
        reviewNotes: rationale,
      });
    } catch {
      return enqueueDecision(entry);
    }

    if (response.success) {
      const applied: DecisionHistoryEntry = { ...entry, state: 'applied' };
      await writeEntry(applied);
      return { ok: true, queued: false, entry: applied };
    }

    if (response.error?.statusCode) {
      return {
        ok: false,
        queued: false,
        error: response.error.message,
      };
    }

    return enqueueDecision(entry);
  };

  const getHistory = async (reportId: string): Promise<DecisionHistoryEntry[]> => {
    const [entries, queue] = await Promise.all([
      deps.historyStore.load(),
      deps.queue.getQueue().catch(() => [] as QueuedMutation[]),
    ]);

    const liveByHistoryId = new Map<string, QueuedMutation>();
    for (const mutation of queue) {
      if (mutation.type !== MODERATION_DECISION_MUTATION) {
        continue;
      }
      const historyId = mutation.payload.historyId;
      if (typeof historyId === 'string') {
        liveByHistoryId.set(historyId, mutation);
      }
    }

    return entries
      .filter((entry) => entry.reportId === reportId)
      .map((entry) => {
        const live = liveByHistoryId.get(entry.id);
        if (!live) {
          return entry;
        }
        return {
          ...entry,
          state: liveState(live),
          error: live.lastError ?? entry.error ?? null,
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  };

  const replay: MutationReplayer = async (mutation) => {
    const payload = parseDecisionPayload(mutation.payload);
    if (!payload) {
      return { status: 'failed', error: 'Invalid moderation decision payload' };
    }

    let response: ApiResponse<ContentReport>;
    try {
      response = await deps.api.updateReport(payload.reportId, {
        status: MODERATION_ACTION_STATUS[payload.action],
        reviewNotes: payload.rationale,
      });
    } catch (error) {
      return { status: 'failed', error: errorMessage(error) };
    }

    if (response.success) {
      await updateEntry(payload.historyId, { state: 'applied', error: null });
      return { status: 'applied' };
    }

    const message = response.error?.message ?? 'Unable to sync this decision';
    await updateEntry(payload.historyId, { state: 'failed', error: message });
    return { status: 'failed', error: message };
  };

  return {
    submitDecision,
    getHistory,
    replay,
  };
}

export type ModerationDecisionService = ReturnType<typeof createModerationDecisionService>;
