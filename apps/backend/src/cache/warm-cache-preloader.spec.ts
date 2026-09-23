import type { Cache } from 'cache-manager';
import { WarmCachePreloaderService } from './warm-cache-preloader.service';
import { WarmCacheRegistry } from './warm-cache.registry';
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

describe('WarmCachePreloaderService', () => {
  it('does not write a precomputed value after its cache generation changes', async () => {
    const cache = new MemoryCache();
    const cacheService = new CacheService(cache as unknown as Cache);
    const registry = new WarmCacheRegistry();
    let release!: (value: string) => void;
    let markLoaderStarted!: () => void;
    const loaderStarted = new Promise<void>((resolve) => {
      markLoaderStarted = resolve;
    });
    registry.register({
      name: 'test-route',
      cacheKey: 'warm:grants:rounds',
      ttlMs: 60_000,
      loader: () =>
        new Promise<string>((resolve) => {
          release = resolve;
          markLoaderStarted();
        }),
    });
    const preloader = new WarmCachePreloaderService(cacheService, registry);

    const pending = preloader.forceRefresh('test');
    await loaderStarted;
    await cacheService.invalidateWarmGrantsCaches();
    release('stale-value');
    const report = await pending;

    expect(report.succeeded).toBe(0);
    expect(report.failed).toBe(1);
    expect(await cache.get('warm:grants:rounds')).toBeUndefined();
  });
});
