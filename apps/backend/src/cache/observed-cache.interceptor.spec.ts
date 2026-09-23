import type { Cache } from 'cache-manager';
import { CACHE_KEY_METADATA, CACHE_TTL_METADATA } from '@nestjs/cache-manager';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of } from 'rxjs';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { CacheService } from './cache.service';
import { ObservedCacheInterceptor } from './observed-cache.interceptor';

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

describe('ObservedCacheInterceptor', () => {
  it('populates a route cache and forces a fresh read after invalidation', async () => {
    const cache = new MemoryCache();
    const cacheService = new CacheService(cache as unknown as Cache);
    const request = {
      method: 'GET',
      query: {},
      params: {},
      url: '/v1/config/stellar',
    };
    const response = {};
    const reflector = {
      get: jest.fn((metadata: string) => {
        if (metadata === CACHE_KEY_METADATA) return 'stellar:config';
        if (metadata === CACHE_TTL_METADATA) return 300_000;
        return undefined;
      }),
    } as unknown as Reflector;
    const adapter = {
      getRequestMethod: jest.fn(() => 'GET'),
      getRequestUrl: jest.fn(() => request.url),
      setHeader: jest.fn(),
    };
    const interceptor = new ObservedCacheInterceptor(
      cache as unknown as Cache,
      reflector,
      { httpAdapter: adapter } as never,
      cacheService,
    );
    const handler = () => undefined;
    const context = {
      getHandler: () => handler,
      getClass: () => class TestController {},
      getArgByIndex: () => request,
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as unknown as ExecutionContext;

    let value = { contract: 'before' };
    const next: CallHandler = {
      handle: jest.fn(() => of(value)),
    };

    await expect(
      firstValueFrom(await interceptor.intercept(context, next)),
    ).resolves.toEqual({
      contract: 'before',
    });
    await Promise.resolve();
    expect(next.handle).toHaveBeenCalledTimes(1);

    await expect(
      firstValueFrom(await interceptor.intercept(context, next)),
    ).resolves.toEqual({
      contract: 'before',
    });
    expect(next.handle).toHaveBeenCalledTimes(1);

    value = { contract: 'after' };
    await cacheService.invalidateConfigCaches();
    await expect(
      firstValueFrom(await interceptor.intercept(context, next)),
    ).resolves.toEqual({
      contract: 'after',
    });
    expect(next.handle).toHaveBeenCalledTimes(2);
    expect(adapter.setHeader).toHaveBeenLastCalledWith(
      response,
      'X-Cache',
      'MISS',
    );
  });
});
