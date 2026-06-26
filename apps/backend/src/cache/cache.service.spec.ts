import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  CacheService,
  NEWS_CACHE_KEY,
  STELLAR_ACCOUNT_BALANCE_PREFIX,
  STELLAR_ACCOUNT_OPERATIONS_PREFIX,
} from './cache.service';

const mockCacheManager = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  store: {
    client: {
      keys: jest.fn(),
    },
  },
};

describe('CacheService', () => {
  let service: CacheService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CacheService,
        { provide: CACHE_MANAGER, useValue: mockCacheManager },
      ],
    }).compile();

    service = module.get<CacheService>(CacheService);
    jest.clearAllMocks();
    service.setCacheConfig({
      balanceCacheTTL: 30_000,
      operationsCacheTTL: 15_000,
    });
  });

  describe('setCacheConfig', () => {
    it('sets cache configuration', () => {
      const newConfig = { balanceCacheTTL: 60_000, operationsCacheTTL: 30_000 };
      service.setCacheConfig(newConfig);
      expect(service.cacheConfig).toEqual(newConfig);
    });
  });

  describe('getAccountBalanceKey', () => {
    it('generates correct cache key for account balances', () => {
      const key = service.getAccountBalanceKey(
        'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      );
      expect(key).toBe(
        `${STELLAR_ACCOUNT_BALANCE_PREFIX}:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`,
      );
    });
  });

  describe('getAccountOperationsKey', () => {
    it('generates correct cache key without cursor', () => {
      const key = service.getAccountOperationsKey('GA5Z...', 10);
      expect(key).toBe(`${STELLAR_ACCOUNT_OPERATIONS_PREFIX}:GA5Z...:10`);
    });

    it('generates correct cache key with cursor', () => {
      const key = service.getAccountOperationsKey('GA5Z...', 10, 'cursor123');
      expect(key).toBe(
        `${STELLAR_ACCOUNT_OPERATIONS_PREFIX}:GA5Z...:10:cursor123`,
      );
    });
  });

  describe('getOrSet', () => {
    it('returns cached value when key exists', async () => {
      mockCacheManager.get.mockResolvedValue({ data: 'cached' });
      const fetcher = jest.fn().mockResolvedValue({ data: 'fresh' });

      const result = await service.getOrSet('some-key', fetcher, 5000);

      expect(result).toEqual({ data: 'cached' });
      expect(fetcher).not.toHaveBeenCalled();
      expect(mockCacheManager.set).not.toHaveBeenCalled();
    });

    it('fetches and caches value when key does not exist', async () => {
      mockCacheManager.get.mockResolvedValue(undefined);
      mockCacheManager.set.mockResolvedValue(undefined);
      const fetcher = jest.fn().mockResolvedValue({ data: 'fresh' });

      const result = await service.getOrSet('some-key', fetcher, 5000);

      expect(result).toEqual({ data: 'fresh' });
      expect(fetcher).toHaveBeenCalled();
      expect(mockCacheManager.set).toHaveBeenCalledWith(
        'some-key',
        { data: 'fresh' },
        5000,
      );
    });
  });

  describe('getAccountBalanceCached', () => {
    it('uses correct key and TTL for account balance caching', async () => {
      const publicKey =
        'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
      const cachedResult = { balances: [], publicKey };
      mockCacheManager.get.mockResolvedValue(undefined);
      mockCacheManager.set.mockResolvedValue(undefined);

      const fetcher = jest.fn().mockResolvedValue(cachedResult);
      const result = await service.getAccountBalanceCached(publicKey, fetcher);

      expect(mockCacheManager.set).toHaveBeenCalledWith(
        expect.stringContaining(publicKey),
        cachedResult,
        30_000,
      );
      expect(result).toEqual(cachedResult);
    });
  });

  describe('getAccountOperationsCached', () => {
    it('uses correct key and TTL for account operations caching', async () => {
      const publicKey =
        'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
      const cachedResult = { transactions: [], nextPage: undefined };
      mockCacheManager.get.mockResolvedValue(undefined);
      mockCacheManager.set.mockResolvedValue(undefined);

      const fetcher = jest.fn().mockResolvedValue(cachedResult);
      const result = await service.getAccountOperationsCached(
        publicKey,
        10,
        fetcher,
        'cursor123',
      );

      expect(mockCacheManager.set).toHaveBeenCalledWith(
        expect.stringContaining(publicKey),
        cachedResult,
        15_000,
      );
      expect(result).toEqual(cachedResult);
    });
  });

  describe('invalidateAccountBalance', () => {
    it('deletes the account balance cache key', async () => {
      mockCacheManager.del.mockResolvedValue(undefined);
      await service.invalidateAccountBalance('GA5Z...');
      expect(mockCacheManager.del).toHaveBeenCalledWith(
        `${STELLAR_ACCOUNT_BALANCE_PREFIX}:GA5Z...`,
      );
    });
  });

  describe('invalidateAccountOperations', () => {
    it('deletes operations cache entries for an account', async () => {
      const mockKeys = ['key1', 'key2'];
      mockCacheManager.store.client.keys.mockResolvedValue(mockKeys);
      mockCacheManager.del.mockResolvedValue(undefined);

      await service.invalidateAccountOperations('GA5Z...');

      expect(mockCacheManager.store.client.keys).toHaveBeenCalledWith(
        expect.stringContaining('GA5Z...'),
      );
      expect(mockCacheManager.del).toHaveBeenCalledTimes(2);
    });
  });

  describe('get', () => {
    it('returns cached value when key exists', async () => {
      mockCacheManager.get.mockResolvedValue({ data: 'test' });
      const result = await service.get('some-key');
      expect(result).toEqual({ data: 'test' });
      expect(mockCacheManager.get).toHaveBeenCalledWith('some-key');
    });

    it('returns undefined when key does not exist', async () => {
      mockCacheManager.get.mockResolvedValue(undefined);
      const result = await service.get('missing-key');
      expect(result).toBeUndefined();
    });
  });

  describe('set', () => {
    it('stores a value with the given key', async () => {
      mockCacheManager.set.mockResolvedValue(undefined);
      await service.set('my-key', { foo: 'bar' }, 5000);
      expect(mockCacheManager.set).toHaveBeenCalledWith(
        'my-key',
        { foo: 'bar' },
        5000,
      );
    });

    it('stores a value without TTL', async () => {
      mockCacheManager.set.mockResolvedValue(undefined);
      await service.set('my-key', 'value');
      expect(mockCacheManager.set).toHaveBeenCalledWith(
        'my-key',
        'value',
        undefined,
      );
    });
  });

  describe('del', () => {
    it('deletes the given key', async () => {
      mockCacheManager.del.mockResolvedValue(undefined);
      await service.del('some-key');
      expect(mockCacheManager.del).toHaveBeenCalledWith('some-key');
    });
  });

  describe('checkHealth', () => {
    it('returns true when Redis read/write succeeds', async () => {
      mockCacheManager.set.mockResolvedValue(undefined);
      mockCacheManager.get.mockResolvedValue('ok');
      mockCacheManager.del.mockResolvedValue(undefined);

      await expect(service.checkHealth()).resolves.toBe(true);
      expect(mockCacheManager.set).toHaveBeenCalled();
      expect(mockCacheManager.get).toHaveBeenCalled();
      expect(mockCacheManager.del).toHaveBeenCalled();
    });

    it('returns false when Redis operations fail', async () => {
      mockCacheManager.set.mockRejectedValue(new Error('Redis unavailable'));

      await expect(service.checkHealth()).resolves.toBe(false);
    });
  });

  describe('invalidateNewsCache', () => {
    it('deletes the news cache key', async () => {
      mockCacheManager.del.mockResolvedValue(undefined);
      await service.invalidateNewsCache();
      expect(mockCacheManager.del).toHaveBeenCalledWith(NEWS_CACHE_KEY);
    });

    it('does not throw when cache deletion fails', async () => {
      mockCacheManager.del.mockRejectedValue(
        new Error('Redis connection lost'),
      );
      await expect(service.invalidateNewsCache()).resolves.not.toThrow();
    });
  });
});
