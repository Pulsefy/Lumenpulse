/**
 * Market signals feed (issue #1405).
 *
 * `GET /signals/latest` (`apps/backend/src/signals/signals.controller.ts`,
 * response `UserSignalsResponseDto`) has had no mobile consumer: the discover
 * tab rendered a static asset list while the platform's computed signals went
 * unused on the surface users check most often.
 *
 * This module is the mobile counterpart. It owns:
 *  1. The wire types for a signal and its feed (`UserSignal`, `SignalsFeed`).
 *  2. `fetchSignals` — the typed read used by `lib/cached-api.ts` so the feed
 *     can be viewed offline.
 *  3. The derivation helpers the discover tab renders: the signal's subject
 *     (which asset the signal is about), its strength, its age and whether it
 *     is stale, and the deep link that opens the relevant screen through the
 *     route table in `lib/deep-links.ts`.
 *
 * Because the backend is free to introduce new category/severity values, every
 * payload is normalized here instead of being trusted: unknown enum values are
 * dropped rather than rendered as `undefined`.
 */

import { apiClient, ApiResponse } from './api-client';
import { buildDeepLinkUrl } from './deep-links';

/** `SignalCategory` in `apps/backend/src/signals/dto/signals.dto.ts`. */
export type SignalCategory = 'holdings' | 'activity' | 'risk' | 'fallback';

/** `SignalSeverity` in `apps/backend/src/signals/dto/signals.dto.ts`. */
export type SignalSeverity = 'low' | 'medium' | 'high';

/** One computed signal, as returned inside `UserSignalsResponseDto.signals`. */
export interface UserSignal {
  category: SignalCategory;
  severity: SignalSeverity;
  title: string;
  detail: string;
  /**
   * Asset code the signal is about, when the payload carries one explicitly.
   * The backend currently only mentions it inside `title`/`detail`, so this is
   * optional and `signalSubject` falls back to parsing those strings.
   */
  assetCode?: string;
}

/** The latest signal summary for the authenticated user. */
export interface SignalsFeed {
  userId: string;
  /** ISO 8601 timestamp of when the backend generated the feed, or null. */
  generatedAt: string | null;
  signals: UserSignal[];
}

/** Signals older than this are labelled as stale in the UI. */
export const SIGNAL_STALE_AFTER_MS = 60 * 60 * 1000; // 1 hour

/** Ordering weight for a severity — higher is more important. */
export const SIGNAL_SEVERITY_WEIGHT: Record<SignalSeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

/** Human-readable label for a signal category (the signal's "type"). */
export const SIGNAL_CATEGORY_LABELS: Record<SignalCategory, string> = {
  holdings: 'Holdings',
  activity: 'Activity',
  risk: 'Risk',
  fallback: 'General',
};

/** Human-readable label for a signal severity (the signal's "strength"). */
export const SIGNAL_SEVERITY_LABELS: Record<SignalSeverity, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

const CATEGORIES: SignalCategory[] = ['holdings', 'activity', 'risk', 'fallback'];
const SEVERITIES: SignalSeverity[] = ['low', 'medium', 'high'];

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

export function isSignalCategory(value: unknown): value is SignalCategory {
  return typeof value === 'string' && (CATEGORIES as string[]).includes(value);
}

export function isSignalSeverity(value: unknown): value is SignalSeverity {
  return typeof value === 'string' && (SEVERITIES as string[]).includes(value);
}

/**
 * Keeps only well-formed signals. A signal without a title or detail cannot be
 * rendered, so it is dropped; an unknown category/severity is dropped rather
 * than coerced into a wrong label.
 */
export function normalizeSignals(value: unknown): UserSignal[] {
  if (!Array.isArray(value)) return [];

  const signals: UserSignal[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    if (!record) continue;

    const title = readString(record.title);
    const detail = readString(record.detail);
    if (!title || !detail) continue;
    if (!isSignalCategory(record.category) || !isSignalSeverity(record.severity)) continue;

    const assetCode = readString(record.assetCode) ?? readString(record.subject);
    signals.push({
      category: record.category,
      severity: record.severity,
      title,
      detail,
      ...(assetCode ? { assetCode } : {}),
    });
  }

  return signals;
}

/** Normalizes any `/signals/latest` payload into a `SignalsFeed`. */
export function toSignalsFeed(payload: unknown): SignalsFeed {
  const record = asRecord(payload) ?? {};
  return {
    userId: readString(record.userId) ?? '',
    generatedAt: readString(record.generatedAt),
    signals: normalizeSignals(record.signals),
  };
}

/**
 * Reads the latest signals for the authenticated user.
 * Never throws: transport failures come back as `{ success: false, error }`.
 */
export async function fetchSignals(): Promise<ApiResponse<SignalsFeed>> {
  const response = await apiClient.get<unknown>('/signals/latest');
  if (!response.success) return { success: false, error: response.error };
  return { success: true, data: toSignalsFeed(response.data) };
}

/** What a signal is about — drives both the label and the deep link. */
export type SignalSubject =
  | { kind: 'asset'; code: string }
  | { kind: 'portfolio' }
  | { kind: 'activity' }
  | { kind: 'none' };

/**
 * Patterns the backend's signal copy uses to name an asset. The service emits
 * `"...holds only XLM, which may..."` and `"...value is held in XLM."`, so the
 * subject is parsed from those sentences rather than guessed from any
 * upper-case-looking token (which would misread words like "API").
 */
const ASSET_MENTION_PATTERNS: RegExp[] = [
  /holds only\s+([A-Za-z][A-Za-z0-9]{1,11})\b/,
  /held in\s+([A-Za-z][A-Za-z0-9]{1,11})\b/,
];

/** Extracts the asset code a signal is about, if it names one. */
export function extractAssetCode(signal: UserSignal): string | null {
  const explicit = readString(signal.assetCode);
  if (explicit) return explicit.trim().toUpperCase();

  for (const text of [signal.title, signal.detail]) {
    for (const pattern of ASSET_MENTION_PATTERNS) {
      const match = pattern.exec(text);
      if (match?.[1]) return match[1].toUpperCase();
    }
  }

  return null;
}

/** Classifies what a signal is about. */
export function signalSubject(signal: UserSignal): SignalSubject {
  const code = extractAssetCode(signal);
  if (code) return { kind: 'asset', code };

  switch (signal.category) {
    case 'holdings':
    case 'risk':
      return { kind: 'portfolio' };
    case 'activity':
      return { kind: 'activity' };
    default:
      return { kind: 'none' };
  }
}

/** Short label for the subject row (e.g. `XLM`, `Portfolio`, `Activity`). */
export function signalSubjectLabel(signal: UserSignal): string {
  const subject = signalSubject(signal);
  switch (subject.kind) {
    case 'asset':
      return subject.code;
    case 'portfolio':
      return 'Portfolio';
    case 'activity':
      return 'Activity';
    default:
      return 'General';
  }
}

/**
 * The screen a signal should open, built through the deep link route table so
 * a renamed route cannot silently produce a dead tap.
 *  - asset subjects open the discover tab with the asset preselected;
 *  - everything else opens the notification inbox, where the detail lives.
 */
export function signalDeepLink(signal: UserSignal): string {
  const subject = signalSubject(signal);
  if (subject.kind === 'asset') {
    return buildDeepLinkUrl('discover', { asset: subject.code });
  }
  return buildDeepLinkUrl('notifications');
}

/** Formats how long ago the feed was generated. */
export function formatSignalAge(generatedAt: string | null, now: number = Date.now()): string {
  if (!generatedAt) return 'age unknown';

  const timestamp = Date.parse(generatedAt);
  if (Number.isNaN(timestamp)) return 'age unknown';

  const elapsed = now - timestamp;
  if (elapsed < 60 * 1000) return 'just now';

  const minutes = Math.floor(elapsed / (60 * 1000));
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return `${Math.floor(days / 7)}w ago`;
}

/**
 * Whether the feed is old enough to be labelled as stale. An unparseable or
 * missing timestamp counts as stale: showing an unknown-age feed as fresh is
 * the more misleading failure.
 */
export function isSignalStale(
  generatedAt: string | null,
  now: number = Date.now(),
  thresholdMs: number = SIGNAL_STALE_AFTER_MS,
): boolean {
  if (!generatedAt) return true;
  const timestamp = Date.parse(generatedAt);
  if (Number.isNaN(timestamp)) return true;
  return now - timestamp > thresholdMs;
}

/**
 * Strongest signal first, keeping the backend's order within a severity.
 * The ordered list is what the discover tab renders at the top of the feed.
 */
export function sortSignalsByStrength(signals: UserSignal[]): UserSignal[] {
  return signals
    .map((signal, index) => ({ signal, index }))
    .sort((a, b) => {
      const weight =
        SIGNAL_SEVERITY_WEIGHT[b.signal.severity] - SIGNAL_SEVERITY_WEIGHT[a.signal.severity];
      return weight !== 0 ? weight : a.index - b.index;
    })
    .map((entry) => entry.signal);
}

/** Stable list key: signals carry no id, so the copy identifies the row. */
export function signalKey(signal: UserSignal, index: number): string {
  return `${signal.category}-${signal.severity}-${index}-${signal.title}`;
}
