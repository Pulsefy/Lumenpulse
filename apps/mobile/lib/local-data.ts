/**
 * Inventory and teardown for everything the app keeps on the device.
 *
 * Backs Settings › Data & Privacy: it groups AsyncStorage keys into the
 * categories a user actually recognises, measures each one, and clears them
 * individually or all at once.
 *
 * Two invariants hold throughout:
 *
 *  1. **Nothing that would sign the user out is ever cleared.** Session tokens
 *     and wallet metadata live in SecureStore and are never touched here; the
 *     legacy plaintext copies that may still sit in AsyncStorage are treated as
 *     protected so a clear-all cannot strand a logged-in session.
 *  2. **Queued mutations survive.** Offline writes waiting to sync are the one
 *     thing a user cannot recreate, so they are protected from every clear
 *     path — including clear-all — and surfaced in the inventory instead.
 *
 * Keys that match no category are left alone. Clearing only ever removes what
 * this module can name.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { cache } from './cache';
import { CONTRIBUTION_DRAFT_STORAGE_KEY } from './contribution-drafts';
import { imageCache } from './image-cache';
import { PRIVACY_KEY_PREFIX } from './privacy-preferences';

// ── Categories ─────────────────────────────────────────────────────────────

export type LocalDataCategoryId =
  'cached_content' | 'saved_news' | 'watchlists' | 'image_cache' | 'drafts' | 'diagnostics';

/** Ordered as the settings screen renders them. */
export const LOCAL_DATA_CATEGORY_IDS: LocalDataCategoryId[] = [
  'cached_content',
  'saved_news',
  'watchlists',
  'image_cache',
  'drafts',
  'diagnostics',
];

/**
 * Keys no clear path may remove.
 *
 * `watchlist_pending_sync` and `pending_mutation_queue` hold offline writes
 * that have not reached the server yet — dropping them would silently discard
 * the user's work. The rest keep the current session and the user's own
 * privacy choices intact.
 */
const PROTECTED_KEY_PREFIXES = [
  // Queued offline mutations — unrecoverable if dropped.
  'watchlist_pending_sync',
  'pending_mutation_queue',
  // Privacy choices must outlive a data wipe, or clearing would silently
  // opt the user back in to reporting they had turned off.
  PRIVACY_KEY_PREFIX,
  // Session state. Current tokens live in SecureStore; these are the legacy
  // plaintext keys that may still linger in AsyncStorage.
  'auth_token',
  'refresh_token',
  'token',
  'user',
  'wallet_metadata',
  'biometric_lock_enabled',
  // Stable device identity for push delivery — not user content.
  'lumenpulse.push.device-id',
];

const CACHE_KEY_PREFIX = 'cache_';
const SAVED_ARTICLES_KEY = 'saved_articles';
const IMAGE_CACHE_META_KEY = 'img_cache_meta';
const WATCHLIST_LOCAL_PREFIX = 'watchlist_local_cache';
const WATCHLIST_LAST_SYNCED_PREFIX = 'watchlist_last_synced';
const WATCHLIST_PENDING_PREFIX = 'watchlist_pending_sync';
const MUTATION_QUEUE_KEY = 'pending_mutation_queue';
const DIAGNOSTICS_KEY_PREFIXES = ['lumenpulse.analytics.', 'lumenpulse.diagnostics.'];

export function isProtectedKey(key: string): boolean {
  return PROTECTED_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/**
 * Maps a storage key to its category, or `null` when the key is protected or
 * belongs to no category. Protection is checked first so a key can never be
 * classified into something clearable by accident.
 */
export function categorizeKey(key: string): LocalDataCategoryId | null {
  if (isProtectedKey(key)) return null;

  if (key.startsWith(CACHE_KEY_PREFIX)) return 'cached_content';
  if (key === SAVED_ARTICLES_KEY) return 'saved_news';
  if (key === IMAGE_CACHE_META_KEY) return 'image_cache';
  if (key === CONTRIBUTION_DRAFT_STORAGE_KEY) return 'drafts';
  if (key.startsWith(WATCHLIST_LOCAL_PREFIX) || key.startsWith(WATCHLIST_LAST_SYNCED_PREFIX)) {
    return 'watchlists';
  }
  if (DIAGNOSTICS_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) {
    return 'diagnostics';
  }

  return null;
}

// ── Sizing ─────────────────────────────────────────────────────────────────

/**
 * UTF-8 byte length of a string without depending on `Buffer` or `TextEncoder`,
 * neither of which is guaranteed on every React Native runtime.
 */
export function utf8ByteLength(value: string): number {
  let bytes = 0;

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);

    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      // Surrogate pair — one 4-byte code point spanning two UTF-16 units.
      bytes += 4;
      index += 1;
    } else {
      bytes += 3;
    }
  }

  return bytes;
}

export interface LocalDataCategorySize {
  id: LocalDataCategoryId;
  /** Estimated bytes on device. */
  bytes: number;
  /** Number of stored entries (images, for the image cache). */
  entryCount: number;
}

export interface LocalDataInventory {
  categories: LocalDataCategorySize[];
  totalBytes: number;
  /**
   * Offline writes still waiting to sync. Never cleared — shown so the user
   * knows a clear will not discard them.
   */
  queuedMutationCount: number;
}

const emptyCategories = (): Record<LocalDataCategoryId, LocalDataCategorySize> =>
  LOCAL_DATA_CATEGORY_IDS.reduce(
    (acc, id) => {
      acc[id] = { id, bytes: 0, entryCount: 0 };
      return acc;
    },
    {} as Record<LocalDataCategoryId, LocalDataCategorySize>,
  );

/**
 * Measures every category. Failures degrade to zeros rather than throwing —
 * the screen must still render (and still offer clearing) if sizing fails.
 */
export async function getLocalDataInventory(): Promise<LocalDataInventory> {
  const categories = emptyCategories();
  let queuedMutationCount = 0;

  try {
    const keys = await AsyncStorage.getAllKeys();
    const entries = await AsyncStorage.multiGet([...keys]);

    for (const [key, value] of entries) {
      const size = utf8ByteLength(key) + utf8ByteLength(value ?? '');
      const category = categorizeKey(key);

      if (category) {
        categories[category].bytes += size;
        categories[category].entryCount += 1;
      }

      queuedMutationCount += countQueuedMutations(key, value);
    }
  } catch (error) {
    console.error('Error reading local data inventory:', error);
  }

  // The image cache's real weight is on disk, not in its AsyncStorage ledger.
  try {
    const stats = await imageCache.getStats();
    categories.image_cache = {
      id: 'image_cache',
      bytes: stats.totalBytes,
      entryCount: stats.entryCount,
    };
  } catch {
    // Non-fatal — the ledger-derived figure above stands in.
  }

  const list = LOCAL_DATA_CATEGORY_IDS.map((id) => categories[id]);

  return {
    categories: list,
    totalBytes: list.reduce((total, category) => total + category.bytes, 0),
    queuedMutationCount,
  };
}

/** Counts pending operations held in a queue key, tolerating corrupt values. */
function countQueuedMutations(key: string, value: string | null): number {
  const isQueueKey = key === MUTATION_QUEUE_KEY || key.startsWith(WATCHLIST_PENDING_PREFIX);

  if (!isQueueKey || !value) return 0;

  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

// ── Clearing ───────────────────────────────────────────────────────────────

/** Removes the keys a category owns, skipping anything protected. */
async function removeKeysForCategory(id: LocalDataCategoryId): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const targets = keys.filter((key) => categorizeKey(key) === id);

  if (targets.length > 0) {
    await AsyncStorage.multiRemove(targets);
  }
}

/**
 * Clears one category. Safe to call when the category is already empty.
 *
 * Never touches queued mutations, session state, or the user's privacy
 * choices — see {@link isProtectedKey}.
 */
export async function clearLocalDataCategory(id: LocalDataCategoryId): Promise<void> {
  switch (id) {
    case 'cached_content':
      // Delegated so the cache manager can drop in-memory bookkeeping too.
      await cache.clear();
      return;
    case 'image_cache':
      // Also purges expo-image's native disk and memory caches.
      await imageCache.clearAll();
      return;
    case 'saved_news':
    case 'watchlists':
    case 'drafts':
    case 'diagnostics':
      await removeKeysForCategory(id);
      return;
  }
}

export interface ClearAllResult {
  cleared: LocalDataCategoryId[];
  failed: LocalDataCategoryId[];
  /** Queued mutations deliberately left in place. */
  preservedQueuedMutations: number;
}

/**
 * Clears every category.
 *
 * Categories are cleared independently so one failure cannot abort the rest,
 * and the result reports exactly which ones did not clear. The user stays
 * signed in and queued mutations remain intact.
 */
export async function clearAllLocalData(): Promise<ClearAllResult> {
  const { queuedMutationCount } = await getLocalDataInventory();
  const cleared: LocalDataCategoryId[] = [];
  const failed: LocalDataCategoryId[] = [];

  for (const id of LOCAL_DATA_CATEGORY_IDS) {
    try {
      await clearLocalDataCategory(id);
      cleared.push(id);
    } catch (error) {
      console.error(`Error clearing local data category '${id}':`, error);
      failed.push(id);
    }
  }

  return {
    cleared,
    failed,
    preservedQueuedMutations: queuedMutationCount,
  };
}
