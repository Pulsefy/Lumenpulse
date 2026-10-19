/**
 * Vesting and treasury claims (issue #1409).
 *
 * The backend exposes the read side of both schedules
 * (`apps/backend/src/vesting-wallet/vesting-wallet.controller.ts` →
 * `GET /vesting-wallet/vesting/:beneficiary` and
 * `GET /vesting-wallet/vesting/:beneficiary/claimable`;
 * `apps/backend/src/treasury/treasury.controller.ts` →
 * `GET /treasury/streams/:beneficiary`), but nothing on mobile consumed them: a
 * beneficiary carrying their wallet on their phone could not see or claim what
 * they are owed.
 *
 * This module owns:
 *  1. The wire types for a vesting schedule, a read-only claimable preview and
 *     a treasury stream, plus the typed reads.
 *  2. The state derivations the claim screen renders: how much is claimable,
 *     why a zero-claimable schedule is zero (not started / fully claimed /
 *     milestone-gated / unreadable), and the unmet milestone condition.
 *  3. `claim` — the submit path: biometric step-up, build the claim envelope,
 *     sign through the existing wallet adapter, and map the wallet's
 *     success/pending/rejection into a transaction receipt.
 *
 * Amounts are i128 stroops on the wire; they are only converted to display
 * units at the edge (`formatClaimAmount`) so arithmetic stays exact.
 */

import { apiClient, ApiResponse } from './api-client';
import { requireBiometricConfirmation } from './biometric-lock';
import type { WalletAdapter } from './wallet/types';

/** Stroops per unit (Stellar's 7 decimal places). */
export const STROOPS_PER_UNIT = 10_000_000;

/** Where a claim is drawn from. */
export type ClaimSource = 'vesting' | 'treasury';

/** `VestingDataDto` from `apps/backend/src/vesting-wallet/dto/vesting-response.dto.ts`. */
export interface VestingSchedule {
  beneficiary: string;
  /** All amounts are stroops, as strings, to preserve i128 precision. */
  totalAmount: string;
  claimedAmount: string;
  claimableAmount: string;
  remainingAmount: string;
  /** Unix seconds. */
  startTime: number;
  /** Seconds. */
  duration: number;
  hasMilestoneRequirement: boolean;
  vaultContract: string | null;
  projectId: number | null;
  milestoneId: number | null;
}

/** `StreamStateDto` from `apps/backend/src/treasury/dto/stream-response.dto.ts`. */
export interface TreasuryStream {
  beneficiary: string;
  totalAmount: string;
  claimedAmount: string;
  unlockedAmount: string;
  remainingAmount: string;
  startTime: number;
  duration: number;
}

/** The `GET /vesting-wallet/vesting/:beneficiary/claimable` payload. */
export interface ClaimablePreview {
  beneficiary: string;
  totalAmount: string;
  claimedAmount: string;
  claimableAmount: string;
  remainingAmount: string;
  startTime: number;
  duration: number;
}

/** Why a schedule has nothing to claim, when it has nothing to claim. */
export type VestingState =
  | 'claimable'
  | 'not-started'
  | 'fully-claimed'
  | 'milestone-locked'
  | 'unavailable';

export interface VestingStateSummary {
  state: VestingState;
  /** Claimable amount in stroops. */
  claimable: number;
  /** Whether the claim button should be enabled. */
  canClaim: boolean;
  /** Explanation shown in place of a dead button, or null when claimable. */
  reason: string | null;
}

/** Reads the vesting schedule for a beneficiary. */
export const vestingApi = {
  async getSchedule(beneficiary: string): Promise<ApiResponse<VestingSchedule>> {
    return apiClient.get<VestingSchedule>(
      `/vesting-wallet/vesting/${encodeURIComponent(beneficiary)}`,
    );
  },

  /** Read-only preview of the claimable amount (fast, no state change). */
  async getClaimablePreview(beneficiary: string): Promise<ApiResponse<ClaimablePreview>> {
    return apiClient.get<ClaimablePreview>(
      `/vesting-wallet/vesting/${encodeURIComponent(beneficiary)}/claimable`,
    );
  },
};

/** Reads the treasury stream for a beneficiary. */
export const treasuryApi = {
  async getStream(beneficiary: string): Promise<ApiResponse<TreasuryStream>> {
    return apiClient.get<TreasuryStream>(`/treasury/streams/${encodeURIComponent(beneficiary)}`);
  },
};

/** Parses a stroop amount that may arrive as a string or a number. */
export function parseStroops(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const amount = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

/** Stroops → XLM string with up to 7 decimals and no trailing zeros. */
export function formatClaimAmount(raw: string | number | null | undefined): string {
  const units = parseStroops(raw) / STROOPS_PER_UNIT;
  const fixed = units.toFixed(7).replace(/0+$/, '').replace(/\.$/, '');
  const [whole = '0', fraction = ''] = fixed.split('.');
  const grouped = Number(whole).toLocaleString('en-US');
  return fraction ? `${grouped}.${fraction}` : grouped;
}

/** `1.5 XLM` — the amount label on the claim button and the receipt. */
export function formatClaimAmountWithAsset(
  raw: string | number | null | undefined,
  assetCode = 'XLM',
): string {
  return `${formatClaimAmount(raw)} ${assetCode}`;
}

/** Unix seconds for a `Date` (vesting timestamps are in seconds). */
export function toUnixSeconds(now: Date): number {
  return Math.floor(now.getTime() / 1000);
}

/**
 * Fraction of the schedule that has vested by `now`, clamped to 0–1.
 * A zero-duration schedule is treated as fully vested.
 */
export function vestedFraction(
  schedule: Pick<VestingSchedule, 'startTime' | 'duration'>,
  nowSeconds: number,
): number {
  if (schedule.duration <= 0) return 1;
  const elapsed = nowSeconds - schedule.startTime;
  if (elapsed <= 0) return 0;
  if (elapsed >= schedule.duration) return 1;
  return elapsed / schedule.duration;
}

/** ISO timestamp at which the schedule finishes vesting. */
export function vestingEndsAt(schedule: Pick<VestingSchedule, 'startTime' | 'duration'>): string {
  return new Date((schedule.startTime + schedule.duration) * 1000).toISOString();
}

/** The unmet milestone condition, or null when the schedule is not gated. */
export function describeMilestoneCondition(schedule: VestingSchedule): string | null {
  if (!schedule.hasMilestoneRequirement) return null;

  const milestone =
    schedule.milestoneId === null ? 'the linked milestone' : `milestone #${schedule.milestoneId}`;
  const project = schedule.projectId === null ? 'the crowdfund vault' : `project #${schedule.projectId}`;

  return `Claiming unlocks once ${milestone} of ${project} is approved in the crowdfund vault.`;
}

/** Short label for the state badge. */
export function vestingStateLabel(state: VestingState): string {
  switch (state) {
    case 'claimable':
      return 'Claimable';
    case 'not-started':
      return 'Not started';
    case 'fully-claimed':
      return 'Fully claimed';
    case 'milestone-locked':
      return 'Milestone pending';
    case 'unavailable':
      return 'Unavailable';
  }
}

/**
 * Derives what the screen should show for a vesting schedule.
 *
 * The zero-claimable case is the important one: the screen must explain *why*
 * there is nothing to claim instead of rendering a dead button, so each cause
 * (not started, fully claimed, milestone-gated, unreadable) gets its own
 * message.
 */
export function summarizeVesting(
  schedule: VestingSchedule,
  nowSeconds: number,
): VestingStateSummary {
  const claimable = parseStroops(schedule.claimableAmount);
  const remaining = parseStroops(schedule.remainingAmount);

  if (claimable > 0) {
    return { state: 'claimable', claimable, canClaim: true, reason: null };
  }

  if (remaining <= 0) {
    return {
      state: 'fully-claimed',
      claimable: 0,
      canClaim: false,
      reason: 'Every vested token on this schedule has already been claimed.',
    };
  }

  if (nowSeconds < schedule.startTime) {
    return {
      state: 'not-started',
      claimable: 0,
      canClaim: false,
      reason: `Vesting starts on ${new Date(schedule.startTime * 1000).toLocaleDateString()}.`,
    };
  }

  const milestone = describeMilestoneCondition(schedule);
  if (milestone) {
    return { state: 'milestone-locked', claimable: 0, canClaim: false, reason: milestone };
  }

  return {
    state: 'unavailable',
    claimable: 0,
    canClaim: false,
    reason: 'Nothing is unlocked yet. Pull to refresh once the next vesting step passes.',
  };
}

/** Same derivation for a treasury stream (no milestone gate). */
export function summarizeTreasury(
  stream: TreasuryStream,
  nowSeconds: number,
): VestingStateSummary {
  return summarizeVesting(
    {
      ...stream,
      claimableAmount: stream.unlockedAmount,
      hasMilestoneRequirement: false,
      vaultContract: null,
      projectId: null,
      milestoneId: null,
    },
    nowSeconds,
  );
}

// ─── Claim submission ─────────────────────────────────────────────────────────

export type ClaimOutcomeKind = 'success' | 'pending' | 'rejected' | 'failed' | 'cancelled';

export interface ClaimOutcome {
  kind: ClaimOutcomeKind;
  txHash?: string;
  message?: string;
}

export interface ClaimRequest {
  source: ClaimSource;
  beneficiary: string;
  /** Contract the claim is submitted to (vesting wallet or treasury). */
  contractId: string;
  /** Amount label shown on the receipt, e.g. `1.5 XLM`. */
  amountLabel: string;
  /** Wallet adapter used to sign (see `lib/wallet/registry.ts`). */
  adapter: Pick<WalletAdapter, 'signXdr'>;
  /**
   * Builds the base64 claim envelope. Injected because envelope construction
   * needs a Soroban RPC simulation, which the caller owns.
   */
  buildClaimXdr: (request: {
    source: ClaimSource;
    beneficiary: string;
    contractId: string;
  }) => Promise<string>;
  /** Biometric step-up gate. Defaults to the shared biometric prompt. */
  requireStepUp?: (promptMessage: string) => Promise<boolean>;
  now?: () => Date;
}

/** Prompt shown by the biometric step-up before a claim is signed. */
export function claimStepUpPrompt(source: ClaimSource, amountLabel: string): string {
  const label = source === 'treasury' ? 'treasury stream' : 'vesting schedule';
  return `Confirm claiming ${amountLabel} from your ${label}`;
}

/** Human-readable transaction type shown on the receipt. */
export function claimTxType(source: ClaimSource): string {
  return source === 'treasury' ? 'Treasury claim' : 'Vesting claim';
}

/**
 * Runs a claim end to end: step-up → build → sign.
 *
 * Returns an outcome rather than throwing so the caller can always route to a
 * receipt (including the rejection and failure cases). A declined biometric
 * prompt is `cancelled` — nothing was signed, so there is no receipt to show.
 */
export async function claim(request: ClaimRequest): Promise<ClaimOutcome> {
  const requireStepUp = request.requireStepUp ?? requireBiometricConfirmation;

  let approved: boolean;
  try {
    approved = await requireStepUp(claimStepUpPrompt(request.source, request.amountLabel));
  } catch {
    approved = false;
  }
  if (!approved) {
    return { kind: 'cancelled', message: 'Claim cancelled before signing.' };
  }

  let xdr: string;
  try {
    xdr = await request.buildClaimXdr({
      source: request.source,
      beneficiary: request.beneficiary,
      contractId: request.contractId,
    });
  } catch (error) {
    return {
      kind: 'failed',
      message: error instanceof Error ? error.message : 'Could not build the claim transaction.',
    };
  }

  const signed = await request.adapter.signXdr(xdr);
  switch (signed.status) {
    case 'success':
      return { kind: 'success', txHash: signed.txHash };
    case 'pending':
      // Deep-link adapters (SEP-0007) return before the wallet replies; the
      // signed envelope arrives through the app's URL handler.
      return { kind: 'pending' };
    case 'rejected':
      return { kind: 'rejected', message: signed.error?.message ?? 'The wallet rejected the claim.' };
    default:
      return { kind: 'failed', message: signed.error?.message ?? 'The wallet could not sign the claim.' };
  }
}

/**
 * Expo Router params for the existing `/transaction-receipt` screen, or null
 * when the claim produced nothing to show (a cancelled step-up).
 */
export function claimReceiptParams(
  outcome: ClaimOutcome,
  context: { source: ClaimSource; amountLabel: string; now?: () => Date },
): Record<string, string> | null {
  if (outcome.kind === 'cancelled') return null;

  const now = context.now ?? (() => new Date());
  const params: Record<string, string> = {
    status: outcome.kind === 'success' ? 'success' : outcome.kind === 'pending' ? 'pending' : 'failed',
    timestamp: now().toISOString(),
    amount: context.amountLabel,
    txType: claimTxType(context.source),
  };

  if (outcome.txHash) params.txHash = outcome.txHash;
  if (outcome.message && outcome.kind !== 'success' && outcome.kind !== 'pending') {
    params.errorDetail = outcome.message;
  }

  return params;
}

/** Route object for `router.push`, or null for a cancelled claim. */
export function claimReceiptRoute(
  outcome: ClaimOutcome,
  context: { source: ClaimSource; amountLabel: string; now?: () => Date },
): { pathname: '/transaction-receipt'; params: Record<string, string> } | null {
  const params = claimReceiptParams(outcome, context);
  if (!params) return null;
  return { pathname: '/transaction-receipt', params };
}
