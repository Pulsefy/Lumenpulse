import type { Cache } from 'cache-manager';
import { buildNewsCacheKey } from '../cache/cache.constants';
import { CacheService } from '../cache/cache.service';
import { NewsService } from './news.service';

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

describe('news cache read-after-write consistency', () => {
  it('invalidates the filtered news response after an update and remove', async () => {
    const cache = new MemoryCache();
    const cacheService = new CacheService(cache as unknown as Cache);
    const article = { id: 'article-1', title: 'old title' };
    const repository = {
      create: jest.fn((value: unknown) => value),
      save: jest.fn((value: unknown) => Promise.resolve(value)),
      update: jest.fn(() => Promise.resolve(undefined)),
      delete: jest.fn(() => Promise.resolve(undefined)),
      findOne: jest.fn(() => Promise.resolve(article)),
    };
    const service = new NewsService(
      repository as never,
      {} as never,
      cacheService,
      {} as never,
      {} as never,
      {} as never,
    );
    const key = buildNewsCacheKey({ limit: 10, lang: 'EN' });

    await cacheService.set(key, { title: 'old title' }, 300_000);
    await service.update('article-1', { title: 'new title' });
    article.title = 'new title';

    await expect(
      cacheService.getOrSet(key, () => Promise.resolve(article), 300_000),
    ).resolves.toEqual(article);

    await service.remove('article-1');
    await expect(cacheService.get(key)).resolves.toBeUndefined();
  });
});
