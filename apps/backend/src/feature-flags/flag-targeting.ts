/**
 * Percentage-based targeting for feature flags.
 *
 * This module is deliberately free of Nest/TypeORM imports: bucketing is pure
 * arithmetic over `(flagKey, principalId)`, so it can be reasoned about — and
 * tested — without a database, a cache, or a metrics registry.
 *
 * Evaluation order, highest precedence first:
 *
 *   1. `deny_list`               — the principal is on the deny list  → off
 *   2. `allow_list`              — the principal is on the allow list → on
 *   3. `percentage_included`     — inside the rollout bucket           → on
 *   4. `percentage_excluded`     — outside the rollout bucket          → off
 *   5. `default_state`           — no rollout configured               → `enabled`
 *
 * Deny beats allow so that a single mis-entered ID on both lists cannot grant
 * access. Allow/deny beat percentage so support can hand a flag to one user,
 * or pull it from one user, without disturbing the rollout.
 *
 * A `rolloutPercentage` that is not null fully determines the result — the
 * `enabled` column is deliberately *not* consulted in that case, and 0% is a
 * real value meaning "serve nobody", not a synonym for "unset". Only null
 * leaves the flag on plain on/off.
 *
 * That is what makes a staged rollout possible (`enabled: false,
 * rolloutPercentage: 5` serves exactly 5% of users) while keeping the
 * emergency kill switch a single field: setting `rolloutPercentage: 0` serves
 * nobody regardless of `enabled`, so an admin can never believe they have
 * disabled a canary while a live percentage keeps serving a slice of users.
 * To go back to plain on/off, set the percentage back to null.
 */

import type { FeatureFlag } from './feature-flag.entity';

/**
 * Number of buckets the hash space is divided into.
 *
 * 10 000 gives 0.01% resolution, so a 0.1% canary is expressible. Because
 * `normalizeRolloutPercentage` rounds to a whole number, the threshold
 * `rolloutPercentage * BUCKETS_PER_PERCENT` is always an exact integer and
 * membership is decided by an integer comparison rather than by float
 * arithmetic at the boundary.
 */
export const BUCKET_COUNT = 10_000;

/** Buckets per percentage point, derived so the two can't drift apart. */
const BUCKETS_PER_PERCENT = BUCKET_COUNT / 100;

/** FNV-1a 32-bit offset basis and prime — a small, fast, well-distributed hash. */
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** Lowest / highest accepted `rolloutPercentage`. */
export const MIN_ROLLOUT_PERCENTAGE = 0;
export const MAX_ROLLOUT_PERCENTAGE = 100;

/** Why a flag resolved the way it did — surfaced for debugging. */
export const FLAG_EVALUATION_REASONS = [
  /** No flag with that key exists. */
  'flag_not_found',
  /** The principal is on the deny list. */
  'deny_list',
  /** The principal is on the allow list. */
  'allow_list',
  /** The principal hashed inside the rollout bucket. */
  'percentage_included',
  /** The principal hashed outside the rollout bucket. */
  'percentage_excluded',
  /** No rollout configured; the flag's stored `enabled` state applied. */
  'default_state',
  /** Targeting is configured but the caller supplied no principal to bucket. */
  'no_principal',
] as const;

export type FlagEvaluationReason = (typeof FLAG_EVALUATION_REASONS)[number];

/** Targeting configuration of a single flag. */
export interface FlagTargeting {
  rolloutPercentage: number | null;
  allowList: readonly string[];
  denyList: readonly string[];
}

/** Mutable form accepted from callers (DTOs) before it reaches the entity. */
export interface FlagTargetingInput {
  rolloutPercentage?: number | null;
  allowList?: readonly string[] | null;
  denyList?: readonly string[] | null;
}

/** The outcome of evaluating a flag for one principal. */
export interface FlagResolution {
  enabled: boolean;
  reason: FlagEvaluationReason;
  /** Hash bucket in [0, BUCKET_COUNT); null when no bucket was computed. */
  bucket: number | null;
}

/**
 * FNV-1a 32-bit hash of the FNV-1a message `flagKey:principalId`.
 *
 * The flag key is part of the input so two flags rolled out to the same
 * percentage select *different* users. Without it, every canary would land on
 * the same 5% of the population, which defeats the purpose of staging a
 * migration across independent flags.
 */
function fnv1a(input: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < input.length; i++) {
    // `^=` on a value that has overflowed into the sign bit yields a negative
    // int32; `Math.imul` treats its operands as int32 and `>>> 0` normalises
    // the result back to uint32, so the accumulator stays unsigned throughout.
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Maps a principal to a stable bucket in [0, BUCKET_COUNT) for a given flag.
 *
 * Stable means: the same `(flagKey, principalId)` always yields the same
 * bucket, in this process, in a later process, and after a restart — because
 * it depends on nothing but its arguments. That is what stops a user flipping
 * between states as the rollout is widened.
 */
export function bucketFor(flagKey: string, principalId: string): number {
  return fnv1a(`${flagKey}:${principalId}`) % BUCKET_COUNT;
}

/**
 * Coerces a stored value into a list of principal IDs.
 *
 * The allow/deny lists are `jsonb`, so a row written by hand, an older release,
 * or a direct SQL edit can hold `null`, a non-array, or an array of non-strings.
 * Evaluation must degrade to "no list" rather than throw, because a malformed
 * row would otherwise take down every request behind a feature flag.
 */
export function normalizePrincipalList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

/**
 * Coerces a stored value into a rollout percentage.
 *
 * Anything non-finite, fractional, or outside 0-100 is treated as "no
 * rollout", so a bad value fails towards the flag's plain on/off state instead
 * of accidentally serving everyone.
 */
export function normalizeRolloutPercentage(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (rounded < MIN_ROLLOUT_PERCENTAGE || rounded > MAX_ROLLOUT_PERCENTAGE) {
    return null;
  }
  return rounded;
}

/** Reads the normalized targeting configuration off a flag row. */
export function readTargeting(flag: FeatureFlag): FlagTargeting {
  return {
    rolloutPercentage: normalizeRolloutPercentage(flag.rolloutPercentage),
    allowList: normalizePrincipalList(flag.allowList),
    denyList: normalizePrincipalList(flag.denyList),
  };
}

/** The targeting configuration with no rollout and no lists. */
export const EMPTY_TARGETING: FlagTargeting = {
  rolloutPercentage: null,
  allowList: [],
  denyList: [],
};

/**
 * True when nothing narrows the flag, i.e. plain on/off evaluation applies.
 *
 * A percentage of 0 counts as targeting: it forces the flag off for everyone,
 * which is not the same as leaving it on plain on/off.
 */
export function isTargetingEmpty(targeting: FlagTargeting): boolean {
  return (
    targeting.rolloutPercentage === null &&
    targeting.allowList.length === 0 &&
    targeting.denyList.length === 0
  );
}

/**
 * Resolves a flag for one principal.
 *
 * `flag` may be null/undefined, in which case the flag is treated as absent.
 * `principalId` may be null/undefined for unauthenticated callers; targeting
 * cannot be applied without one, so the result falls back to `enabled` and the
 * reason says so.
 */
export function resolveFlag(
  flag: FeatureFlag | null | undefined,
  principalId: string | null | undefined,
): FlagResolution {
  if (!flag) {
    return { enabled: false, reason: 'flag_not_found', bucket: null };
  }

  const { rolloutPercentage, allowList, denyList } = readTargeting(flag);
  const baseState = flag.enabled === true;
  const principal = typeof principalId === 'string' ? principalId.trim() : '';

  // Explicit lists win over the rollout, and deny wins over allow.
  if (principal !== '' && denyList.includes(principal)) {
    return { enabled: false, reason: 'deny_list', bucket: null };
  }
  if (principal !== '' && allowList.includes(principal)) {
    return { enabled: true, reason: 'allow_list', bucket: null };
  }

  // A percentage that was explicitly set is authoritative, including 0%:
  // the flag's `enabled` column is ignored so that "off" cannot be a
  // half-applied state. Only null (never configured) falls back to `enabled`.
  if (rolloutPercentage === null) {
    return { enabled: baseState, reason: 'default_state', bucket: null };
  }

  // A rollout is configured but the caller is anonymous: bucketing needs a
  // principal, so fall back to the flag's stored state rather than guessing.
  if (principal === '') {
    return { enabled: baseState, reason: 'no_principal', bucket: null };
  }

  const bucket = bucketFor(flag.key, principal);
  const included = bucket < rolloutPercentage * BUCKETS_PER_PERCENT;
  return {
    enabled: included,
    reason: included ? 'percentage_included' : 'percentage_excluded',
    bucket,
  };
}

/** Targeting after sanitization — ready to be written to the entity. */
export interface SanitizedTargeting {
  rolloutPercentage: number | null;
  allowList: string[];
  denyList: string[];
}

/**
 * Normalizes caller-supplied targeting into the shape stored on the entity.
 *
 * Absent lists become `[]` rather than null so the caller never has to
 * distinguish "cleared" from "not supplied" on the way back out.
 */
export function sanitizeTargetingInput(
  input: FlagTargetingInput | undefined,
): SanitizedTargeting {
  return {
    rolloutPercentage: normalizeRolloutPercentage(input?.rolloutPercentage),
    allowList: normalizePrincipalList(input?.allowList),
    denyList: normalizePrincipalList(input?.denyList),
  };
}

/**
 * Plain-object snapshot of a flag's targeting, written to the audit log so a
 * rollout change is as reviewable as an on/off change.
 */
export function snapshotTargeting(
  targeting: FlagTargeting | null | undefined,
): Record<string, unknown> | null {
  if (!targeting) return null;
  return {
    rolloutPercentage: targeting.rolloutPercentage ?? null,
    allowList: [...targeting.allowList],
    denyList: [...targeting.denyList],
  };
}
