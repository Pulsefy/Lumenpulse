import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { CacheService, NEWS_CACHE_KEY } from './cache.service';

const mockCacheManager = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
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

  describe('invalidateNewsCache', () => {
    it('deletes the news cache key', async () => {
      mockCacheManager.del.mockResolvedValue(undefined);
      await service.invalidateNewsCache();
      expect(mockCacheManager.del).toHaveBeenCalledWith(NEWS_CACHE_KEY);
    });

    it('does not throw when cache deletion fails', async () => {
      mockCacheManager.del.mockRejectedValue(new Error('Redis connection lost'));
      await expect(service.invalidateNewsCache()).resolves.not.toThrow();
    });
  });
});
