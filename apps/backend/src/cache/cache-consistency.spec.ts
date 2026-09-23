import type { Cache } from 'cache-manager';
import { MetricsService } from '../metrics/metrics.service';
import {
  buildNewsCacheKey,
  buildStellarHttpCacheKey,
  NEWS_CACHE_KEY,
  WARM_CACHE_KEY_GRANTS_LEADERBOARD,
  WARM_CACHE_KEY_GRANTS_ROUNDS,
} from './cache.constants';
import { CacheService } from './cache.service';

class MemoryCache {
  readonly values = new Map<string, unknown>();

  get<T>(key: string): Promise<T | undefined> {
    return Promise.resolve(this.values.get(key) as T | undefined);
  }

  set(key: string, value: unknown, ttl?: number): Promise<unknown> {
    void ttl;
    this.values.set(key, value);
    return Promise.resolve(value);
  }

  del(key: string): Promise<boolean> {
    return Promise.resolve(this.values.delete(key));
  }
}

class DelayedReadMemoryCache extends MemoryCache {
  private delayed = false;
  private releaseRead!: () => void;
  private markReadStarted!: () => void;
  readonly readStarted: Promise<void>;

  constructor() {
    super();
    this.readStarted = new Promise<void>((resolve) => {
      this.markReadStarted = resolve;
    });
  }

  get<T>(key: string): Promise<T | undefined> {
    if (!this.delayed) {
      this.delayed = true;
      return new Promise<T | undefined>((resolve) => {
        this.releaseRead = () => resolve(this.values.get(key) as T | undefined);
        this.markReadStarted();
      });
    }
    return super.get(key);
  }

  release(): void {
    this.releaseRead();
  }
}

function createService(metrics?: MetricsService): {
  service: CacheService;
  cache: MemoryCache;
} {
  const cache = new MemoryCache();
  const service = new CacheService(cache as unknown as Cache, metrics);
  return { service, cache };
}

describe('cache read-after-write consistency', () => {
  it('reflects an account balance write after invalidation', async () => {
    const { service } = createService();
    let sourceBalance = 'old-balance';
    const fetcher = jest.fn(() => Promise.resolve(sourceBalance));

    await expect(
      service.getAccountBalanceCached('G-ACCOUNT', fetcher),
    ).resolves.toBe('old-balance');
    sourceBalance = 'new-balance';
    await service.invalidateAccountBalance('G-ACCOUNT');

    await expect(
      service.getAccountBalanceCached('G-ACCOUNT', fetcher),
    ).resolves.toBe('new-balance');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('invalidates every paginated operations key for an account', async () => {
    const { service } = createService();
    let source = { page: 1 };
    const fetcher = jest.fn(() => Promise.resolve(source));

    await service.getAccountOperationsCached(
      'G-ACCOUNT',
      10,
      fetcher,
      'cursor-1',
    );
    await service.getAccountOperationsCached(
      'G-ACCOUNT',
      10,
      fetcher,
      'cursor-2',
    );
    await service.getAccountOperationsCached('G-ACCOUNT', 20, fetcher);
    source = { page: 2 };
    await service.invalidateAccountOperations('G-ACCOUNT');

    await expect(
      service.getAccountOperationsCached('G-ACCOUNT', 10, fetcher, 'cursor-1'),
    ).resolves.toEqual({ page: 2 });
    await expect(
      service.getAccountOperationsCached('G-ACCOUNT', 10, fetcher, 'cursor-2'),
    ).resolves.toEqual({ page: 2 });
    await expect(
      service.getAccountOperationsCached('G-ACCOUNT', 20, fetcher),
    ).resolves.toEqual({ page: 2 });
    expect(fetcher).toHaveBeenCalledTimes(6);
  });

  it('invalidates the transaction HTTP representation for an account', async () => {
    const { service, cache } = createService();
    const key = buildStellarHttpCacheKey('transactions', {
      publicKey: 'G-ACCOUNT',
      limit: 50,
      cursor: 'next-page',
    });

    await service.set(key, { transactions: [] }, 60_000);
    await service.invalidateAccountOperations('G-ACCOUNT');

    await expect(service.get(key)).resolves.toBeUndefined();
    expect(cache.values.has(key)).toBe(false);
  });

  it('reflects a contract-read write after invalidation', async () => {
    const { service } = createService();
    let state = 'before';
    const fetcher = jest.fn(() => Promise.resolve(state));

    await service.getContractReadCached('C-CONTRACT', 'get_state', {}, fetcher);
    state = 'after';
    await service.invalidateContractById('C-CONTRACT');

    await expect(
      service.getContractReadCached('C-CONTRACT', 'get_state', {}, fetcher),
    ).resolves.toBe('after');
  });

  it.each([
    [
      'news',
      () => buildNewsCacheKey({ limit: 10, lang: 'EN' }),
      (service: CacheService) => service.invalidateNewsCache(),
    ],
    [
      'exchange rate',
      () => 'exchange-rates:USD_EUR',
      (service: CacheService) => service.invalidateExchangeRate('USD', 'EUR'),
    ],
    [
      'contributor address',
      () => 'contributor-registry:address:G-CONTRIBUTOR',
      (service: CacheService) =>
        service.invalidateContributorCaches('G-CONTRIBUTOR'),
    ],
    [
      'warm grants rounds',
      () => WARM_CACHE_KEY_GRANTS_ROUNDS,
      (service: CacheService) => service.invalidateWarmGrantsCaches(),
    ],
    [
      'warm grants leaderboard',
      () => WARM_CACHE_KEY_GRANTS_LEADERBOARD,
      (service: CacheService) => service.invalidateWarmGrantsCaches(),
    ],
  ])(
    'reflects a %s write after invalidation',
    async (_name, keyFactory, invalidate) => {
      const { service } = createService();
      const key = keyFactory();
      let value = 'before';
      const fetcher = jest.fn(() => Promise.resolve(value));

      await service.getOrSet(key, fetcher, 60_000);
      value = 'after';
      await invalidate(service);

      await expect(service.getOrSet(key, fetcher, 60_000)).resolves.toBe(
        'after',
      );
      expect(fetcher).toHaveBeenCalledTimes(2);
    },
  );

  it('does not let an in-flight pre-write fetch repopulate the cache', async () => {
    const { service } = createService();
    const key = NEWS_CACHE_KEY;
    let source = 'before';
    let release!: (value: string) => void;
    const fetcher = jest
      .fn<Promise<string>, []>()
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            release = resolve;
          }),
      )
      .mockImplementation(() => Promise.resolve(source));

    const pending = service.getOrSet(key, fetcher, 60_000);
    await Promise.resolve();
    source = 'after';
    await service.invalidateNewsCache();
    release('before');

    await expect(pending).resolves.toBe('after');
    expect(fetcher).toHaveBeenCalledTimes(2);
    await expect(service.getOrSet(key, fetcher, 60_000)).resolves.toBe('after');
  });

  it('does not coalesce a pre-write fill with a post-invalidation request', async () => {
    const { service } = createService();
    const key = NEWS_CACHE_KEY;
    let source = 'before';
    let release!: (value: string) => void;
    let started!: () => void;
    const fetchStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const fetcher = jest
      .fn<Promise<string>, []>()
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            release = resolve;
            started();
          }),
      )
      .mockImplementation(() => Promise.resolve(source));

    const first = service.getOrSet(key, fetcher, 60_000);
    await fetchStarted;
    source = 'after';
    await service.invalidateNewsCache();
    const second = service.getOrSet(key, fetcher, 60_000);
    release('before');

    await expect(first).resolves.toBe('after');
    await expect(second).resolves.toBe('after');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('does not serve a cache value when invalidation overlaps the cache read', async () => {
    const cache = new DelayedReadMemoryCache();
    const service = new CacheService(cache as unknown as Cache);
    const key = buildNewsCacheKey({ limit: 10 });
    cache.values.set(key, 'before');

    const pending = service.getOrSet(
      key,
      () => Promise.resolve('after'),
      60_000,
    );
    await cache.readStarted;
    await service.invalidateNewsCache();
    cache.release();

    await expect(pending).resolves.toBe('after');
  });

  it('exports bounded per-cache hit and staleness metrics', async () => {
    const metrics = new MetricsService();
    const { service } = createService(metrics);
    let value = 'one';
    const key = service.getAccountBalanceKey('G-METRIC');

    await service.getOrSet(key, () => Promise.resolve(value), 30_000);
    value = 'two';
    await service.invalidateAccountBalance('G-METRIC');
    await service.getOrSet(key, () => Promise.resolve(value), 30_000);
    await service.getOrSet(key, () => Promise.resolve(value), 30_000);

    const output = await metrics.getMetrics();
    expect(output).toMatch(
      /cache_reads_total\{cache="stellar_account_balance",result="hit"\}/,
    );
    expect(output).toMatch(
      /cache_reads_total\{cache="stellar_account_balance",result="miss"\}/,
    );
    expect(output).toContain(
      'cache_staleness_seconds{cache="stellar_account_balance"}',
    );
    expect(output).not.toContain('G-METRIC');
  });
});
