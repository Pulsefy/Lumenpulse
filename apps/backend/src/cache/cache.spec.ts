import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { CacheService } from './cache.service';

const mockCacheManager = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
};

describe('CacheService (read-through)', () => {
  let service: CacheService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CacheService,
        { provide: CACHE_MANAGER, useValue: mockCacheManager },
      ],
    }).compile();
    service = module.get<CacheService>(CacheService);
  });

  it('returns cached value on hit', async () => {
    mockCacheManager.get.mockResolvedValue({ price: 0.12 });
    const result = await service.get<{ price: number }>('stellar:assets:XLM');
    expect(result).toEqual({ price: 0.12 });
    expect(mockCacheManager.get).toHaveBeenCalledWith('stellar:assets:XLM');
  });

  it('returns undefined on cache miss', async () => {
    mockCacheManager.get.mockResolvedValue(undefined);
    const result = await service.get('stellar:assets:MISSING');
    expect(result).toBeUndefined();
  });

  it('sets value with TTL', async () => {
    mockCacheManager.set.mockResolvedValue(undefined);
    await service.set('stellar:assets:XLM', { price: 0.12 }, 30_000);
    expect(mockCacheManager.set).toHaveBeenCalledWith(
      'stellar:assets:XLM',
      { price: 0.12 },
      30_000,
    );
  });

  it('deletes a key', async () => {
    mockCacheManager.del.mockResolvedValue(undefined);
    await service.del('stellar:assets:XLM');
    expect(mockCacheManager.del).toHaveBeenCalledWith('stellar:assets:XLM');
  });

  it('invalidates news cache key', async () => {
    mockCacheManager.del.mockResolvedValue(undefined);
    await service.invalidateNewsCache();
    expect(mockCacheManager.del).toHaveBeenCalledWith('news:latest');
  });

  it('health check returns true when redis responds', async () => {
    mockCacheManager.set.mockResolvedValue(undefined);
    mockCacheManager.get.mockResolvedValue('ok');
    mockCacheManager.del.mockResolvedValue(undefined);
    const healthy = await service.checkHealth();
    expect(healthy).toBe(true);
  });

  it('health check returns false on redis error', async () => {
    mockCacheManager.set.mockRejectedValue(new Error('connection refused'));
    const healthy = await service.checkHealth();
    expect(healthy).toBe(false);
  });
});
