/**
 * Contribution Draft — offline state for interrupted contributions.
 *
 * This module is intentionally pure (no React Native / storage imports) so
 * the parsing, staleness and resumability rules can be unit tested in
 * isolation. Persistence lives in `lib/storage.ts`; UI wiring lives in
 * `components/ContributionModal.tsx` and the project detail screen.
 */

export const CONTRIBUTION_DRAFT_STORAGE_KEY = 'contribution_draft';

/**
 * Drafts older than this are considered stale: they are never auto-restored
 * and can only be discarded. 7 days by default.
 */
export const DEFAULT_DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface ContributionDraft {
  projectId: number;
  amount: string;
  /** ISO timestamp of the last edit to this draft. */
  savedAt: string;
}

/**
 * Why a stored draft cannot be offered back to the user.
 * - `malformed`: persisted payload failed validation on read.
 * - `stale`: draft is older than {@link DEFAULT_DRAFT_MAX_AGE_MS}.
 * - `invalid_amount`: amount no longer passes contribution validation.
 * - `testnet_config_missing`: required testnet config is unavailable.
 */
export type ContributionDraftBlocker =
  | 'malformed'
  | 'stale'
  | 'invalid_amount'
  | 'testnet_config_missing';

export interface ContributionDraftEvaluation {
  /**
   * True only when the draft may be prefilled into the contribution form.
   * Restoring a draft must never trigger a submission on its own — the user
   * still has to review and confirm explicitly.
   */
  resumable: boolean;
  blocker: ContributionDraftBlocker | null;
}

/**
 * Defensively validate an unknown parsed value as a contribution draft so a
 * corrupted or tampered persistence entry can never leak into the form.
 */
export function parseContributionDraft(raw: unknown): ContributionDraft | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const candidate = raw as Record<string, unknown>;

  const projectId = candidate.projectId;
  if (typeof projectId !== 'number' || !Number.isFinite(projectId) || projectId <= 0) {
    return null;
  }

  const amount = candidate.amount;
  if (typeof amount !== 'string' || !amount.trim()) {
    return null;
  }

  const savedAt = candidate.savedAt;
  if (typeof savedAt !== 'string' || !savedAt || Number.isNaN(new Date(savedAt).getTime())) {
    return null;
  }

  return { projectId, amount: amount.trim(), savedAt };
}

/**
 * A draft is stale once it has not been touched for longer than `maxAgeMs`.
 */
export function isContributionDraftStale(
  draft: ContributionDraft,
  now: number = Date.now(),
  maxAgeMs: number = DEFAULT_DRAFT_MAX_AGE_MS,
): boolean {
  const savedTime = new Date(draft.savedAt).getTime();
  if (Number.isNaN(savedTime)) {
    return true;
  }
  return now - savedTime > maxAgeMs;
}

/**
 * Decide whether a draft may be restored into the contribution form.
 *
 * Order matters: environment problems win over content problems, because a
 * valid draft is still useless when the testnet configuration it depends on
 * has disappeared.
 */
export function evaluateContributionDraft(
  draft: ContributionDraft,
  deps: {
    /** Whether the testnet environment currently has required config. */
    isTestnetConfigReady: boolean;
    /** Amount validator; returns an error message or null when valid. */
    isValidAmount: (amount: string) => string | null;
    now?: number;
    maxAgeMs?: number;
  },
): ContributionDraftEvaluation {
  if (!deps.isTestnetConfigReady) {
    return { resumable: false, blocker: 'testnet_config_missing' };
  }

  if (isContributionDraftStale(draft, deps.now ?? Date.now(), deps.maxAgeMs)) {
    return { resumable: false, blocker: 'stale' };
  }

  if (deps.isValidAmount(draft.amount)) {
    return { resumable: false, blocker: 'invalid_amount' };
  }

  return { resumable: true, blocker: null };
}
