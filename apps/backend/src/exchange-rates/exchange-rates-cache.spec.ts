import type { Cache } from 'cache-manager';
import { ExchangeRatesService } from './exchange-rates.service';
import { CacheService } from '../cache/cache.service';

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

describe('ExchangeRatesService cache consistency', () => {
  it('canonicalizes currency keys and invalidates a lowercase read', async () => {
    const cache = new MemoryCache();
    const cacheService = new CacheService(cache as unknown as Cache);
    const httpGet = jest.fn().mockReturnValue({
      toPromise: jest.fn().mockResolvedValue({ data: { rates: { eur: 0.9 } } }),
    });
    const service = new ExchangeRatesService(
      { get: httpGet } as never,
      cacheService,
    );

    await expect(service.getExchangeRate('usd', 'eur')).resolves.toBe(0.9);
    await expect(service.getExchangeRate('usd', 'eur')).resolves.toBe(0.9);
    expect(httpGet).toHaveBeenCalledTimes(1);

    await cacheService.invalidateExchangeRate('USD', 'EUR');
    await expect(service.getExchangeRate('usd', 'eur')).resolves.toBe(0.9);
    expect(httpGet).toHaveBeenCalledTimes(2);
  });
});
