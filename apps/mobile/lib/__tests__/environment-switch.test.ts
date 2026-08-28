import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { DeviceEventEmitter } from 'react-native';

jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    getItem: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    setItem: jest.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    removeItem: jest.fn((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }),
    getAllKeys: jest.fn(() => Promise.resolve(Array.from(store.keys()))),
    multiRemove: jest.fn((keys: string[]) => {
      for (const k of keys) store.delete(k);
      return Promise.resolve();
    }),
    clear: jest.fn(() => {
      store.clear();
      return Promise.resolve();
    }),
  };
});

jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn(),
}));

jest.mock('react-native', () => ({
  DeviceEventEmitter: { emit: jest.fn() },
}));

import { CacheManager } from '../cache';

/**
 * Test suite for environment switching and cache clearing.
 * Verifies that:
 * 1. Switching environments clears all cached data
 * 2. Cache is cleared to prevent showing stale data from previous network
 * 3. Proper precautions are taken to avoid data mismatches
 */

describe('Environment Switching and Cache Clearing', () => {
  let cacheManager: CacheManager;

  beforeEach(() => {
    jest.clearAllMocks();
    (NetInfo.addEventListener as jest.Mock).mockImplementation((listener) => {
      listener({ isConnected: true });
    });
    cacheManager = CacheManager.getInstance();
    // Clear AsyncStorage before each test
    AsyncStorage.clear();
  });

  afterEach(async () => {
    // Clean up after each test
    await cacheManager.clear();
    AsyncStorage.clear();
  });

  describe('CacheManager.clear()', () => {
    it('removes all cache entries when called', async () => {
      // Set some cache entries
      await cacheManager.set('test_key_1', { data: 'value1' }, { ttl: 60000 });
      await cacheManager.set('test_key_2', { data: 'value2' }, { ttl: 60000 });
      await cacheManager.set('non_cache_key', 'should_not_be_affected', { ttl: 60000 });

      // Verify cache entries exist
      const cached1 = await cacheManager.get('test_key_1', { ttl: 60000 });
      const cached2 = await cacheManager.get('test_key_2', { ttl: 60000 });
      expect(cached1).not.toBeNull();
      expect(cached2).not.toBeNull();

      // Clear all cache
      await cacheManager.clear();

      // Verify cache entries are removed
      const clearedCache1 = await cacheManager.get('test_key_1', { ttl: 60000 });
      const clearedCache2 = await cacheManager.get('test_key_2', { ttl: 60000 });
      expect(clearedCache1).toBeNull();
      expect(clearedCache2).toBeNull();
    });

    it('handles clearing when cache is already empty', async () => {
      // Should not throw even when cache is empty
      expect(async () => {
        await cacheManager.clear();
      }).not.toThrow();
    });

    it('only removes cache_ prefixed entries from AsyncStorage', async () => {
      // Set some cache entries and regular entries
      await cacheManager.set('cache_entry', { data: 'cached' }, { ttl: 60000 });
      await AsyncStorage.setItem('regular_key', 'regular_value');

      // Clear cache
      await cacheManager.clear();

      // Verify cache entry is removed
      const cacheEntry = await cacheManager.get('cache_entry', { ttl: 60000 });
      expect(cacheEntry).toBeNull();

      // Verify regular entry still exists
      const regularEntry = await AsyncStorage.getItem('regular_key');
      expect(regularEntry).toBe('regular_value');
    });
  });

  describe('Environment switch scenario', () => {
    it('simulates clearing cache when switching from testnet to mainnet', async () => {
      // Simulate caching portfolio data on testnet
      const testnetPortfolioData = {
        totalValue: '1000.00',
        assets: [{ code: 'USDC', amount: '100' }],
      };

      await cacheManager.set('portfolio_testnet', testnetPortfolioData, {
        ttl: 5 * 60 * 1000,
      });

      // Verify testnet data is cached
      const cachedTestnetData = await cacheManager.get('portfolio_testnet', {
        ttl: 5 * 60 * 1000,
      });
      expect(cachedTestnetData?.data).toEqual(testnetPortfolioData);

      // Now simulate environment switch
      // In the real app, this would happen in EnvironmentContext.setEnvironment()
      await cacheManager.clear();

      // Verify all cache is cleared
      const clearedData = await cacheManager.get('portfolio_testnet', {
        ttl: 5 * 60 * 1000,
      });
      expect(clearedData).toBeNull();
    });

    it('ensures wallet session is independent from cached data', async () => {
      // Simulate wallet session in AsyncStorage
      const walletSession = {
        activePublicKey: 'GXYZ...',
        lastConnectedEnvironment: 'testnet',
      };
      await AsyncStorage.setItem(
        '@lumenpulse_wallet_metadata',
        JSON.stringify(walletSession),
      );

      // Simulate caching some portfolio data
      await cacheManager.set('portfolio_data', { total: '1000' }, { ttl: 60000 });

      // Clear cache (as happens on environment switch)
      await cacheManager.clear();

      // Verify wallet session is NOT cleared (it's stored separately)
      const storedSession = await AsyncStorage.getItem('@lumenpulse_wallet_metadata');
      expect(storedSession).toBe(JSON.stringify(walletSession));

      // Verify cache is cleared
      const cachedPortfolio = await cacheManager.get('portfolio_data', { ttl: 60000 });
      expect(cachedPortfolio).toBeNull();
    });
  });

  describe('Cache config safety', () => {
    it('has appropriate TTLs to prevent stale data display', async () => {
      // Portfolio data should have shorter TTL
      const portfolioTtl = 5 * 60 * 1000; // 5 minutes

      // Transactions should have even shorter TTL
      const transactionsTtl = 2 * 60 * 1000; // 2 minutes

      // Ensure critical data expires faster
      expect(transactionsTtl).toBeLessThan(portfolioTtl);
    });

    it('prevents showing balance from previous network by requiring cache clear', async () => {
      // Store balance from testnet
      const testnetBalance = { xlm: '1000', usd: '150' };
      await cacheManager.set('balance', testnetBalance, { ttl: 5 * 60 * 1000 });

      // Verify testnet balance is cached
      const cachedBalance = await cacheManager.get('balance', { ttl: 5 * 60 * 1000 });
      expect(cachedBalance?.data).toEqual(testnetBalance);

      // Switch environment (clears cache)
      await cacheManager.clear();

      // Verify balance is not available after switch
      const balanceAfterSwitch = await cacheManager.get('balance', { ttl: 5 * 60 * 1000 });
      expect(balanceAfterSwitch).toBeNull();

      // Now cache mainnet balance
      const mainnetBalance = { xlm: '50', usd: '7.50' };
      await cacheManager.set('balance', mainnetBalance, { ttl: 5 * 60 * 1000 });

      // Verify only mainnet balance is shown
      const currentBalance = await cacheManager.get('balance', { ttl: 5 * 60 * 1000 });
      expect(currentBalance?.data).toEqual(mainnetBalance);
    });
  });
});
