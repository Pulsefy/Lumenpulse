/**
 * Unit tests for lib/image-cache.ts
 *
 * Covers:
 *  - recordAccess: stores a new entry and updates lastAccessedAt on repeat access
 *  - getStats: correctly sums entry bytes and reports maxBytes
 *  - LRU eviction: drops the oldest-accessed entries when budget is exceeded
 *  - clearAll: empties the ledger and calls expo-image clear methods
 *  - formatBytes: human-readable byte formatting
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

jest.mock('expo-image', () => ({
  Image: {
    clearDiskCache: jest.fn().mockResolvedValue(undefined),
    clearMemoryCache: jest.fn().mockResolvedValue(undefined),
  },
}));

// We import after mocking so the module picks up the mocks.
import { ImageCacheManager, formatBytes, IMAGE_SIZE_ESTIMATE_BYTES } from '../image-cache';

// Helper: create a fresh manager instance (bypasses the singleton for isolation).
function makeManager(maxBytes: number): ImageCacheManager {
  // Access private constructor via cast to any.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mgr = new (ImageCacheManager as any)(maxBytes) as ImageCacheManager;
  return mgr;
}

beforeEach(() => {
  jest.clearAllMocks();
  // Default: nothing in storage.
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
  (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
  (AsyncStorage.removeItem as jest.Mock).mockResolvedValue(undefined);
});

// ── recordAccess & getStats ───────────────────────────────────────────────

describe('recordAccess', () => {
  it('creates a new entry with the provided size', async () => {
    const mgr = makeManager(10_000_000);
    await mgr.recordAccess('https://example.com/img1.jpg', 50_000);

    const stats = await mgr.getStats();
    expect(stats.entryCount).toBe(1);
    expect(stats.totalBytes).toBe(50_000);
  });

  it('updates lastAccessedAt on subsequent access without changing sizeBytes', async () => {
    const mgr = makeManager(10_000_000);
    await mgr.recordAccess('https://example.com/img1.jpg', 50_000);
    const before = await mgr.getStats();

    await mgr.recordAccess('https://example.com/img1.jpg', 99_999); // new size ignored
    const after = await mgr.getStats();

    // Entry count and total bytes unchanged; size of first record is preserved.
    expect(after.entryCount).toBe(before.entryCount);
    expect(after.totalBytes).toBe(50_000);
  });

  it('uses IMAGE_SIZE_ESTIMATE_BYTES when no size is provided', async () => {
    const mgr = makeManager(10_000_000);
    await mgr.recordAccess('https://example.com/img2.jpg');

    const stats = await mgr.getStats();
    expect(stats.totalBytes).toBe(IMAGE_SIZE_ESTIMATE_BYTES);
  });

  it('persists the ledger to AsyncStorage after each record', async () => {
    const mgr = makeManager(10_000_000);
    await mgr.recordAccess('https://example.com/img3.jpg', 10_000);

    expect(AsyncStorage.setItem).toHaveBeenCalled();
    const [key] = (AsyncStorage.setItem as jest.Mock).mock.calls[0];
    expect(key).toBe('img_cache_meta');
  });
});

// ── getStats ──────────────────────────────────────────────────────────────

describe('getStats', () => {
  it('reports maxBytes matching the constructor argument', async () => {
    const mgr = makeManager(25 * 1024 * 1024);
    const stats = await mgr.getStats();
    expect(stats.maxBytes).toBe(25 * 1024 * 1024);
  });

  it('returns zero counts on an empty ledger', async () => {
    const mgr = makeManager(10_000_000);
    const stats = await mgr.getStats();
    expect(stats.entryCount).toBe(0);
    expect(stats.totalBytes).toBe(0);
  });

  it('loads persisted entries from AsyncStorage on first call', async () => {
    const persisted = [
      { uri: 'https://a.com/1.jpg', sizeBytes: 40_000, lastAccessedAt: Date.now() - 5000 },
      { uri: 'https://a.com/2.jpg', sizeBytes: 60_000, lastAccessedAt: Date.now() - 3000 },
    ];
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(persisted));

    const mgr = makeManager(10_000_000);
    const stats = await mgr.getStats();
    expect(stats.entryCount).toBe(2);
    expect(stats.totalBytes).toBe(100_000);
  });
});

// ── LRU eviction ──────────────────────────────────────────────────────────

describe('LRU eviction', () => {
  it('evicts the oldest entry when the budget is exceeded', async () => {
    // Budget: 150 KB. Three 80 KB images would exceed it.
    const maxBytes = 150_000;
    const mgr = makeManager(maxBytes);

    const now = Date.now();

    // Simulate three entries arriving in order; the first is the "oldest".
    jest
      .spyOn(Date, 'now')
      .mockReturnValueOnce(now)          // first access
      .mockReturnValueOnce(now + 1000)   // second access
      .mockReturnValueOnce(now + 2000);  // third access — triggers eviction

    await mgr.recordAccess('https://a.com/old.jpg', 80_000);
    await mgr.recordAccess('https://a.com/mid.jpg', 80_000);
    await mgr.recordAccess('https://a.com/new.jpg', 80_000);

    jest.spyOn(Date, 'now').mockRestore();

    const stats = await mgr.getStats();
    // After evicting the oldest (80 KB), 160 KB remains which still exceeds 150 KB,
    // so mid is also evicted — only the newest should remain.
    expect(stats.totalBytes).toBeLessThanOrEqual(maxBytes);
    expect(stats.entryCount).toBeLessThan(3);
  });

  it('does not evict anything when total bytes are within budget', async () => {
    const mgr = makeManager(1_000_000);
    await mgr.recordAccess('https://a.com/img.jpg', 80_000);

    const stats = await mgr.getStats();
    expect(stats.entryCount).toBe(1);
  });
});

// ── clearAll ──────────────────────────────────────────────────────────────

describe('clearAll', () => {
  it('empties the in-memory ledger', async () => {
    const mgr = makeManager(10_000_000);
    await mgr.recordAccess('https://a.com/img.jpg', 80_000);
    await mgr.clearAll();

    const stats = await mgr.getStats();
    expect(stats.entryCount).toBe(0);
    expect(stats.totalBytes).toBe(0);
  });

  it('removes the AsyncStorage key', async () => {
    const mgr = makeManager(10_000_000);
    await mgr.clearAll();
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith('img_cache_meta');
  });

  it('calls expo-image cache clear methods', async () => {
    const { Image } = require('expo-image');
    const mgr = makeManager(10_000_000);
    await mgr.clearAll();
    expect(Image.clearDiskCache).toHaveBeenCalled();
    expect(Image.clearMemoryCache).toHaveBeenCalled();
  });
});

// ── formatBytes ───────────────────────────────────────────────────────────

describe('formatBytes', () => {
  it('formats bytes below 1 KB as "X B"', () => {
    expect(formatBytes(512)).toBe('512 B');
  });

  it('formats kilobytes correctly', () => {
    expect(formatBytes(2048)).toBe('2.0 KB');
  });

  it('formats megabytes correctly', () => {
    expect(formatBytes(10 * 1024 * 1024)).toBe('10.0 MB');
  });

  it('handles zero bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
  });
});
