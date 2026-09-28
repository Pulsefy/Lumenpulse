import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  addRecentSearch,
  clearRecentSearches,
  getRecentSearches,
  MAX_RECENT_SEARCHES,
  RECENT_SEARCHES_STORAGE_KEY,
} from '../search-history';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

const storage = AsyncStorage as unknown as {
  getItem: jest.Mock;
  setItem: jest.Mock;
  removeItem: jest.Mock;
};

describe('recent searches', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    storage.getItem.mockResolvedValue(null);
    storage.setItem.mockResolvedValue(undefined);
    storage.removeItem.mockResolvedValue(undefined);
  });

  it('loads valid stored recent searches and ignores malformed entries', async () => {
    storage.getItem.mockResolvedValue(JSON.stringify(['Stellar', null, '', 'Lumen']));

    await expect(getRecentSearches()).resolves.toEqual(['Stellar', 'Lumen']);
  });

  it('puts new searches first, de-duplicates case-insensitively, and caps the list', async () => {
    storage.getItem.mockResolvedValue(
      JSON.stringify([
        'stellar',
        ...Array.from({ length: MAX_RECENT_SEARCHES - 1 }, (_, index) => `query-${index}`),
      ]),
    );

    const result = await addRecentSearch(' Stellar ');

    expect(result).toHaveLength(MAX_RECENT_SEARCHES);
    expect(result[0]).toBe('Stellar');
    expect(result).not.toContain('stellar');
    expect(storage.setItem).toHaveBeenCalledWith(
      RECENT_SEARCHES_STORAGE_KEY,
      JSON.stringify(result),
    );
  });

  it('removes recent searches when cleared', async () => {
    await clearRecentSearches();

    expect(storage.removeItem).toHaveBeenCalledWith(RECENT_SEARCHES_STORAGE_KEY);
  });
});
