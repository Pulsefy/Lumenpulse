import AsyncStorage from '@react-native-async-storage/async-storage';

import { imageCache } from '../image-cache';
import {
  categorizeKey,
  clearAllLocalData,
  clearLocalDataCategory,
  getLocalDataInventory,
  isProtectedKey,
  utf8ByteLength,
} from '../local-data';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  getAllKeys: jest.fn(),
  multiGet: jest.fn(),
  multiRemove: jest.fn(),
}));

jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn(),
}));

jest.mock('react-native', () => ({
  DeviceEventEmitter: { emit: jest.fn() },
}));

jest.mock('../image-cache', () => ({
  imageCache: {
    getStats: jest.fn(),
    clearAll: jest.fn(),
  },
}));

const mockedStorage = AsyncStorage as unknown as {
  getAllKeys: jest.Mock;
  multiGet: jest.Mock;
  multiRemove: jest.Mock;
};
const mockedImageCache = imageCache as unknown as {
  getStats: jest.Mock;
  clearAll: jest.Mock;
};

/** Builds a store and wires getAllKeys/multiGet to serve it. */
function primeStorage(store: Record<string, string>) {
  const keys = Object.keys(store);
  mockedStorage.getAllKeys.mockResolvedValue(keys);
  mockedStorage.multiGet.mockImplementation((requested: string[]) =>
    Promise.resolve(requested.map((key) => [key, store[key] ?? null])),
  );
}

describe('utf8ByteLength', () => {
  it('counts ASCII as one byte per character', () => {
    expect(utf8ByteLength('hello')).toBe(5);
  });

  it('counts multi-byte characters correctly', () => {
    expect(utf8ByteLength('é')).toBe(2);
    expect(utf8ByteLength('中')).toBe(3);
  });

  it('counts a surrogate pair as a single 4-byte code point', () => {
    expect(utf8ByteLength('😀')).toBe(4);
  });

  it('returns zero for an empty string', () => {
    expect(utf8ByteLength('')).toBe(0);
  });
});

describe('categorizeKey', () => {
  it.each([
    ['cache_news_feed', 'cached_content'],
    ['saved_articles', 'saved_news'],
    ['watchlist_local_cache_user-1', 'watchlists'],
    ['watchlist_last_synced_user-1', 'watchlists'],
    ['img_cache_meta', 'image_cache'],
    ['contribution_draft', 'drafts'],
    ['lumenpulse.analytics.session', 'diagnostics'],
  ])('classifies %s as %s', (key, expected) => {
    expect(categorizeKey(key)).toBe(expected);
  });

  it('returns null for unknown keys so clearing never touches them', () => {
    expect(categorizeKey('some_third_party_key')).toBeNull();
  });

  it('never classifies a protected key into a clearable category', () => {
    expect(categorizeKey('watchlist_pending_sync_user-1')).toBeNull();
    expect(categorizeKey('pending_mutation_queue')).toBeNull();
    expect(categorizeKey('lumenpulse.privacy.analytics_enabled')).toBeNull();
    expect(categorizeKey('auth_token')).toBeNull();
    expect(categorizeKey('wallet_metadata')).toBeNull();
  });
});

describe('isProtectedKey', () => {
  it('protects queued mutations, session state and privacy choices', () => {
    expect(isProtectedKey('pending_mutation_queue')).toBe(true);
    expect(isProtectedKey('watchlist_pending_sync_user-1')).toBe(true);
    expect(isProtectedKey('lumenpulse.privacy.crash_reporting_enabled')).toBe(true);
    expect(isProtectedKey('refresh_token')).toBe(true);
    expect(isProtectedKey('biometric_lock_enabled')).toBe(true);
  });

  it('does not protect ordinary cached content', () => {
    expect(isProtectedKey('cache_portfolio')).toBe(false);
    expect(isProtectedKey('saved_articles')).toBe(false);
  });
});

describe('getLocalDataInventory', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedImageCache.getStats.mockResolvedValue({
      entryCount: 12,
      totalBytes: 2_400_000,
      maxBytes: 52_428_800,
    });
  });

  it('reports a size per category and an overall total', async () => {
    primeStorage({
      cache_news: JSON.stringify({ data: 'a'.repeat(100) }),
      saved_articles: JSON.stringify([{ id: '1' }]),
      'watchlist_local_cache_user-1': JSON.stringify([{ symbol: 'XLM' }]),
      contribution_draft: JSON.stringify({ projectId: 'p1' }),
    });

    const inventory = await getLocalDataInventory();
    const byId = Object.fromEntries(
      inventory.categories.map((category) => [category.id, category]),
    );

    expect(byId.cached_content.entryCount).toBe(1);
    expect(byId.cached_content.bytes).toBeGreaterThan(100);
    expect(byId.saved_news.entryCount).toBe(1);
    expect(byId.watchlists.entryCount).toBe(1);
    expect(byId.drafts.entryCount).toBe(1);
    expect(inventory.totalBytes).toBe(
      inventory.categories.reduce((sum, category) => sum + category.bytes, 0),
    );
  });

  it('lists every category even when nothing is stored', async () => {
    primeStorage({});
    mockedImageCache.getStats.mockResolvedValue({
      entryCount: 0,
      totalBytes: 0,
      maxBytes: 52_428_800,
    });

    const inventory = await getLocalDataInventory();

    expect(inventory.categories).toHaveLength(6);
    expect(inventory.totalBytes).toBe(0);
  });

  it('takes the image cache size from the on-disk stats, not the ledger key', async () => {
    primeStorage({ img_cache_meta: JSON.stringify([{ uri: 'x' }]) });

    const inventory = await getLocalDataInventory();
    const imageCategory = inventory.categories.find((category) => category.id === 'image_cache');

    expect(imageCategory).toEqual({
      id: 'image_cache',
      bytes: 2_400_000,
      entryCount: 12,
    });
  });

  it('counts queued mutations without attributing them to a category', async () => {
    primeStorage({
      pending_mutation_queue: JSON.stringify([{ id: '1' }, { id: '2' }]),
      'watchlist_pending_sync_user-1': JSON.stringify([{ id: '3' }]),
    });

    const inventory = await getLocalDataInventory();

    expect(inventory.queuedMutationCount).toBe(3);
    expect(inventory.totalBytes).toBe(2_400_000); // image cache stats only
  });

  it('tolerates a corrupt queue value instead of throwing', async () => {
    primeStorage({ pending_mutation_queue: 'not-json' });

    const inventory = await getLocalDataInventory();

    expect(inventory.queuedMutationCount).toBe(0);
  });

  it('degrades to zeros when storage reads fail', async () => {
    mockedStorage.getAllKeys.mockRejectedValue(new Error('storage offline'));
    mockedImageCache.getStats.mockRejectedValue(new Error('no stats'));
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const inventory = await getLocalDataInventory();

    expect(inventory.categories).toHaveLength(6);
    expect(inventory.totalBytes).toBe(0);
  });
});

describe('clearLocalDataCategory', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedImageCache.getStats.mockResolvedValue({
      entryCount: 0,
      totalBytes: 0,
      maxBytes: 52_428_800,
    });
    mockedStorage.multiRemove.mockResolvedValue(undefined);
  });

  it('removes only the keys the category owns', async () => {
    primeStorage({
      saved_articles: '[]',
      cache_news: '{}',
      pending_mutation_queue: '[]',
    });

    await clearLocalDataCategory('saved_news');

    expect(mockedStorage.multiRemove).toHaveBeenCalledWith(['saved_articles']);
  });

  it('preserves pending watchlist syncs when clearing watchlists', async () => {
    primeStorage({
      'watchlist_local_cache_user-1': '[]',
      'watchlist_last_synced_user-1': '2026-08-29T00:00:00.000Z',
      'watchlist_pending_sync_user-1': JSON.stringify([{ id: '1' }]),
    });

    await clearLocalDataCategory('watchlists');

    const removed = mockedStorage.multiRemove.mock.calls[0][0] as string[];
    expect(removed).toEqual(
      expect.arrayContaining(['watchlist_local_cache_user-1', 'watchlist_last_synced_user-1']),
    );
    expect(removed).not.toContain('watchlist_pending_sync_user-1');
  });

  it('delegates the image cache to the native purge', async () => {
    mockedImageCache.clearAll.mockResolvedValue(undefined);

    await clearLocalDataCategory('image_cache');

    expect(mockedImageCache.clearAll).toHaveBeenCalledTimes(1);
    expect(mockedStorage.multiRemove).not.toHaveBeenCalled();
  });

  it('is a no-op when the category has nothing stored', async () => {
    primeStorage({ cache_news: '{}' });

    await clearLocalDataCategory('drafts');

    expect(mockedStorage.multiRemove).not.toHaveBeenCalled();
  });
});

describe('clearAllLocalData', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedStorage.multiRemove.mockResolvedValue(undefined);
    mockedImageCache.clearAll.mockResolvedValue(undefined);
    mockedImageCache.getStats.mockResolvedValue({
      entryCount: 0,
      totalBytes: 0,
      maxBytes: 52_428_800,
    });
  });

  it('clears every category and reports them', async () => {
    primeStorage({ saved_articles: '[]', contribution_draft: '{}' });

    const result = await clearAllLocalData();

    expect(result.cleared).toHaveLength(6);
    expect(result.failed).toHaveLength(0);
  });

  it('never removes session or queued-mutation keys', async () => {
    primeStorage({
      cache_news: '{}',
      saved_articles: '[]',
      auth_token: 'jwt-token',
      refresh_token: 'refresh-token',
      wallet_metadata: '{}',
      pending_mutation_queue: JSON.stringify([{ id: '1' }]),
      'watchlist_pending_sync_user-1': JSON.stringify([{ id: '2' }]),
      'lumenpulse.privacy.analytics_enabled': 'false',
    });

    const result = await clearAllLocalData();

    const removed = mockedStorage.multiRemove.mock.calls.flatMap((call) => call[0] as string[]);
    expect(removed).not.toContain('auth_token');
    expect(removed).not.toContain('refresh_token');
    expect(removed).not.toContain('wallet_metadata');
    expect(removed).not.toContain('pending_mutation_queue');
    expect(removed).not.toContain('watchlist_pending_sync_user-1');
    expect(removed).not.toContain('lumenpulse.privacy.analytics_enabled');
    expect(result.preservedQueuedMutations).toBe(2);
  });

  it('leaves unrecognised third-party keys untouched', async () => {
    primeStorage({ saved_articles: '[]', some_other_library_key: 'value' });

    await clearAllLocalData();

    const removed = mockedStorage.multiRemove.mock.calls.flatMap((call) => call[0] as string[]);
    expect(removed).not.toContain('some_other_library_key');
  });

  it('continues past a failing category and reports it', async () => {
    primeStorage({ saved_articles: '[]', contribution_draft: '{}' });
    mockedImageCache.clearAll.mockRejectedValue(new Error('disk busy'));
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const result = await clearAllLocalData();

    expect(result.failed).toEqual(['image_cache']);
    expect(result.cleared).toHaveLength(5);
  });
});
