/**
 * Data & Privacy — per-category storage accounting and safe clear operations.
 *
 * Design rules:
 *  1. Auth keys live in expo-secure-store and are NEVER touched by any clear
 *     operation in this module. clearAll is non-destructive to the session.
 *  2. clearAll waits for the mutation queue to drain (or times out) before
 *     wiping anything, so we never delete locally-cached changes that haven't
 *     reached the server yet.
 *  3. Every helper is pure-async so the UI can call them from any context
 *     without worrying about React state.
 *  4. Size estimation serialises stored JSON and measures UTF-8 bytes to give
 *     an accurate-enough number for display purposes.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { cache } from './cache';
import { clearWatchlistData } from './watchlist';
import { storage } from './storage';
import { mutationQueue } from './mutation-queue';
import { CONTRIBUTION_DRAFT_STORAGE_KEY } from './contribution-drafts';
import { errorReporter } from './error-reporting';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Prefix used by CacheManager for all cached API responses. */
const CACHE_KEY_PREFIX = 'cache_';

/** Watchlist-related AsyncStorage key prefixes (from lib/watchlist.ts). */
const WATCHLIST_KEY_PREFIXES = [
  'watchlist_local_cache',
  'watchlist_pending_sync',
  'watchlist_last_synced',
];

/** Analytics opt-out preference key. */
export const ANALYTICS_OPT_OUT_KEY = 'analytics_opt_out';

/** Crash-reporting opt-out preference key. */
export const CRASH_REPORTING_OPT_OUT_KEY = 'crash_reporting_opt_out';

/**
 * Maximum milliseconds we wait for the mutation queue to drain before
 * clearing anyway. Prevents a frozen queue from blocking the user.
 */
const DRAIN_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DataCategory =
  | 'api_cache'
  | 'saved_news'
  | 'watchlist'
  | 'contribution_drafts'
  | 'analytics';

export interface CategorySize {
  category: DataCategory;
  /** Estimated size in bytes. */
  bytes: number;
  /** Whether computation succeeded; false → display as "unknown". */
  computed: boolean;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Estimate the UTF-8 byte size of one AsyncStorage value. */
async function storedByteSize(key: string): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return 0;
    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(raw).byteLength;
    }
    // Fallback: conservative UTF-16 estimate
    return raw.length * 2;
  } catch {
    return 0;
  }
}

/** Sum sizes of every AsyncStorage key that starts with `prefix`. */
async function prefixedByteSize(prefix: string): Promise<number> {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const matching = allKeys.filter((k) => k.startsWith(prefix));
    const sizes = await Promise.all(matching.map((k) => storedByteSize(k)));
    return sizes.reduce((sum, s) => sum + s, 0);
  } catch {
    return 0;
  }
}

/** Sum sizes for multiple prefixes. */
async function multiPrefixByteSize(prefixes: string[]): Promise<number> {
  const sizes = await Promise.all(prefixes.map((p) => prefixedByteSize(p)));
  return sizes.reduce((sum, s) => sum + s, 0);
}

/**
 * Poll until the mutation queue is empty or DRAIN_TIMEOUT_MS elapses.
 * Returns true if the queue drained cleanly.
 */
async function waitForMutationQueueDrain(): Promise<boolean> {
  const deadline = Date.now() + DRAIN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const queue = await mutationQueue.getQueue();
    if (queue.length === 0) return true;
    await new Promise<void>((r) => setTimeout(r, 250));
  }
  return false;
}

// ---------------------------------------------------------------------------
// Public API — size estimation
// ---------------------------------------------------------------------------

/** Compute the estimated byte size for every tracked data category. */
export async function getAllCategorySizes(): Promise<CategorySize[]> {
  const categories: DataCategory[] = [
    'api_cache',
    'saved_news',
    'watchlist',
    'contribution_drafts',
    'analytics',
  ];

  const results = await Promise.allSettled([
    prefixedByteSize(CACHE_KEY_PREFIX),
    storedByteSize('saved_articles'),
    multiPrefixByteSize(WATCHLIST_KEY_PREFIXES),
    storedByteSize(CONTRIBUTION_DRAFT_STORAGE_KEY),
    Promise.all([
      storedByteSize(ANALYTICS_OPT_OUT_KEY),
      storedByteSize(CRASH_REPORTING_OPT_OUT_KEY),
    ]).then(([a, b]) => a + b),
  ]);

  return categories.map((category, i) => {
    const result = results[i];
    if (result.status === 'fulfilled') {
      return { category, bytes: result.value as number, computed: true };
    }
    return { category, bytes: 0, computed: false };
  });
}

/** Compute the size for a single category. */
export async function getCategorySize(category: DataCategory): Promise<CategorySize> {
  try {
    let bytes = 0;
    switch (category) {
      case 'api_cache':
        bytes = await prefixedByteSize(CACHE_KEY_PREFIX);
        break;
      case 'saved_news':
        bytes = await storedByteSize('saved_articles');
        break;
      case 'watchlist':
        bytes = await multiPrefixByteSize(WATCHLIST_KEY_PREFIXES);
        break;
      case 'contribution_drafts':
        bytes = await storedByteSize(CONTRIBUTION_DRAFT_STORAGE_KEY);
        break;
      case 'analytics':
        bytes =
          (await storedByteSize(ANALYTICS_OPT_OUT_KEY)) +
          (await storedByteSize(CRASH_REPORTING_OPT_OUT_KEY));
        break;
    }
    return { category, bytes, computed: true };
  } catch {
    return { category, bytes: 0, computed: false };
  }
}

// ---------------------------------------------------------------------------
// Public API — individual category clears
// ---------------------------------------------------------------------------

/** Clear all API response cache entries. */
export async function clearApiCache(): Promise<void> {
  await cache.clear();
}

/** Clear saved news articles from local storage. */
export async function clearSavedNews(): Promise<void> {
  await AsyncStorage.removeItem('saved_articles');
}

/**
 * Clear the watchlist local cache and pending-sync queue.
 * The server-side watchlist is unaffected.
 */
export async function clearWatchlist(userId?: string): Promise<void> {
  await clearWatchlistData(userId);
}

/** Clear any saved contribution draft. */
export async function clearContributionDrafts(): Promise<void> {
  await storage.clearContributionDraft();
}

// ---------------------------------------------------------------------------
// Public API — analytics / crash-reporting preferences
// ---------------------------------------------------------------------------

/** Returns true when the user has opted out of analytics collection. */
export async function getAnalyticsOptOut(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(ANALYTICS_OPT_OUT_KEY);
    return raw === 'true';
  } catch {
    return false;
  }
}

/** Persist the analytics opt-out preference and update the error reporter. */
export async function setAnalyticsOptOut(optOut: boolean): Promise<void> {
  await AsyncStorage.setItem(ANALYTICS_OPT_OUT_KEY, String(optOut));
  errorReporter.init({ optOut });
}

/** Returns true when the user has opted out of crash reporting. */
export async function getCrashReportingOptOut(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(CRASH_REPORTING_OPT_OUT_KEY);
    return raw === 'true';
  } catch {
    return false;
  }
}

/** Persist the crash-reporting opt-out preference and update the error reporter. */
export async function setCrashReportingOptOut(optOut: boolean): Promise<void> {
  await AsyncStorage.setItem(CRASH_REPORTING_OPT_OUT_KEY, String(optOut));
  errorReporter.init({ optOut });
}

// ---------------------------------------------------------------------------
// Public API — clear all (safe, session-preserving)
// ---------------------------------------------------------------------------

export interface ClearAllResult {
  /** True when the mutation queue was empty or drained before clearing. */
  queueDrained: boolean;
  /**
   * True when clearing proceeded despite a non-empty queue (timeout hit).
   * The UI should surface a warning in this case.
   */
  clearedWithPendingMutations: boolean;
  /** Categories that were cleared successfully. */
  cleared: DataCategory[];
  /** Categories that failed to clear (partial success is still reported). */
  failed: DataCategory[];
}

/**
 * Clear all local data except:
 *  - Auth tokens & wallet metadata (SecureStore — session is preserved).
 *  - Biometric lock preference (security setting, not user data).
 *  - Analytics / crash-reporting opt-out preferences (privacy choice should
 *    survive a data reset by design).
 *
 * Waits up to {@link DRAIN_TIMEOUT_MS} for pending mutations to flush before
 * proceeding, preventing deletion of optimistic state not yet on the server.
 */
export async function clearAll(userId?: string): Promise<ClearAllResult> {
  // Step 1 — wait for in-flight mutations.
  const queueDrained = await waitForMutationQueueDrain();
  const clearedWithPendingMutations = !queueDrained;

  const cleared: DataCategory[] = [];
  const failed: DataCategory[] = [];

  const ops: Array<{ category: DataCategory; fn: () => Promise<void> }> = [
    { category: 'api_cache', fn: clearApiCache },
    { category: 'saved_news', fn: clearSavedNews },
    { category: 'watchlist', fn: () => clearWatchlist(userId) },
    { category: 'contribution_drafts', fn: clearContributionDrafts },
    // 'analytics' preferences are intentionally excluded from clearAll.
  ];

  for (const { category, fn } of ops) {
    try {
      await fn();
      cleared.push(category);
    } catch (err) {
      console.error(`[data-privacy] Failed to clear "${category}":`, err);
      failed.push(category);
    }
  }

  return { queueDrained, clearedWithPendingMutations, cleared, failed };
}

// ---------------------------------------------------------------------------
// Utility — byte formatting
// ---------------------------------------------------------------------------

/**
 * Format a byte count into a compact human-readable string.
 * Examples: "0 B", "< 1 KB", "4.2 KB", "1.1 MB"
 */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1) return '< 1 KB';
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}
