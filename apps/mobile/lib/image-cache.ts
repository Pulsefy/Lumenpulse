/**
 * Image cache manager backed by expo-image's native disk cache.
 *
 * expo-image handles the actual on-disk caching automatically (both memory and
 * disk tiers). This module adds a bounded metadata ledger on top so the app can:
 *   - report total estimated cached image bytes in the Settings › Cache screen
 *   - enforce a configurable max byte budget, evicting LRU entries when exceeded
 *   - expose cache statistics without walking the native cache (which is opaque)
 *
 * The metadata record is persisted in AsyncStorage under the key
 * `img_cache_meta`. Each entry stores the URI, an estimated byte size, and an
 * access timestamp used for LRU eviction.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image as ExpoImage } from 'expo-image';

// ── Constants ─────────────────────────────────────────────────────────────

/** Fallback size estimate per image (bytes) when the actual size is unknown. */
export const IMAGE_SIZE_ESTIMATE_BYTES = 80_000; // ~80 KB

/** Default maximum total cache size in bytes (50 MB). */
export const DEFAULT_MAX_CACHE_BYTES = 50 * 1024 * 1024;

const META_STORAGE_KEY = 'img_cache_meta';

// ── Types ─────────────────────────────────────────────────────────────────

export interface ImageCacheEntry {
  /** The remote image URI. */
  uri: string;
  /** Estimated byte size of the cached image. */
  sizeBytes: number;
  /** Unix timestamp (ms) of the last access — used for LRU eviction ordering. */
  lastAccessedAt: number;
}

export interface ImageCacheStats {
  /** Number of images tracked in the metadata ledger. */
  entryCount: number;
  /** Estimated total bytes used by cached images. */
  totalBytes: number;
  /** Configured max bytes before eviction kicks in. */
  maxBytes: number;
}

// ── ImageCacheManager ─────────────────────────────────────────────────────

export class ImageCacheManager {
  private static _instance: ImageCacheManager | null = null;

  private entries: Map<string, ImageCacheEntry> = new Map();
  private maxBytes: number;
  private _loaded = false;

  private constructor(maxBytes: number = DEFAULT_MAX_CACHE_BYTES) {
    this.maxBytes = maxBytes;
  }

  static getInstance(maxBytes?: number): ImageCacheManager {
    if (!ImageCacheManager._instance) {
      ImageCacheManager._instance = new ImageCacheManager(maxBytes);
    }
    return ImageCacheManager._instance;
  }

  // ── Persistence ─────────────────────────────────────────────────────────

  /** Load the metadata ledger from AsyncStorage. Called lazily on first use. */
  private async ensureLoaded(): Promise<void> {
    if (this._loaded) return;
    try {
      const raw = await AsyncStorage.getItem(META_STORAGE_KEY);
      if (raw) {
        const arr: ImageCacheEntry[] = JSON.parse(raw);
        this.entries = new Map(arr.map((e) => [e.uri, e]));
      }
    } catch {
      // Non-fatal: start with an empty ledger if storage fails.
    }
    this._loaded = true;
  }

  private async persist(): Promise<void> {
    try {
      const arr = Array.from(this.entries.values());
      await AsyncStorage.setItem(META_STORAGE_KEY, JSON.stringify(arr));
    } catch {
      // Non-fatal.
    }
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Record that an image has been accessed (or initially cached).
   * Updates the LRU timestamp and estimated size, then triggers eviction if
   * the budget is exceeded.
   */
  async recordAccess(uri: string, sizeBytes: number = IMAGE_SIZE_ESTIMATE_BYTES): Promise<void> {
    await this.ensureLoaded();

    const existing = this.entries.get(uri);
    this.entries.set(uri, {
      uri,
      sizeBytes: existing?.sizeBytes ?? sizeBytes,
      lastAccessedAt: Date.now(),
    });

    await this.evictIfNeeded();
    await this.persist();
  }

  /**
   * Return current cache statistics for display in the Settings screen.
   */
  async getStats(): Promise<ImageCacheStats> {
    await this.ensureLoaded();

    let totalBytes = 0;
    for (const entry of this.entries.values()) {
      totalBytes += entry.sizeBytes;
    }

    return {
      entryCount: this.entries.size,
      totalBytes,
      maxBytes: this.maxBytes,
    };
  }

  /**
   * Clear all image cache metadata AND instruct expo-image to purge its
   * native disk/memory cache.
   */
  async clearAll(): Promise<void> {
    await this.ensureLoaded();
    this.entries.clear();
    await AsyncStorage.removeItem(META_STORAGE_KEY);

    // Ask expo-image to wipe its native caches.
    try {
      await ExpoImage.clearDiskCache();
      await ExpoImage.clearMemoryCache();
    } catch {
      // expo-image may not expose these methods on all platforms; ignore.
    }
  }

  /**
   * Evict the least-recently-used entries until total bytes are under budget.
   * expo-image manages the actual file deletion; we only update our metadata.
   */
  private async evictIfNeeded(): Promise<void> {
    let totalBytes = 0;
    for (const entry of this.entries.values()) {
      totalBytes += entry.sizeBytes;
    }

    if (totalBytes <= this.maxBytes) return;

    // Sort by lastAccessedAt ascending (oldest first).
    const sorted = Array.from(this.entries.values()).sort(
      (a, b) => a.lastAccessedAt - b.lastAccessedAt,
    );

    for (const entry of sorted) {
      if (totalBytes <= this.maxBytes) break;
      totalBytes -= entry.sizeBytes;
      this.entries.delete(entry.uri);
    }
  }
}

/** Singleton instance used throughout the app. */
export const imageCache = ImageCacheManager.getInstance();

// ── Utility ───────────────────────────────────────────────────────────────

/** Format bytes into a human-readable string (e.g. "12.4 MB"). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
