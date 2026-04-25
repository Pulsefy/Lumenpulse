import { Injectable, Inject, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from '@nestjs/cache-manager';

export const NEWS_CACHE_KEY = 'news:latest';
export const STELLAR_ASSETS_CACHE_PREFIX = 'stellar:assets';

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  constructor(@Inject(CACHE_MANAGER) private readonly cacheManager: Cache) {}

  async get<T>(key: string): Promise<T | undefined> {
    return this.cacheManager.get<T>(key);
  }

  async set(key: string, value: unknown, ttl?: number): Promise<void> {
    await this.cacheManager.set(key, value, ttl);
  }

  async del(key: string): Promise<void> {
    await this.cacheManager.del(key);
  }

  async checkHealth(): Promise<boolean> {
    const healthCheckKey = `health:redis:${Date.now()}`;

    try {
      await this.cacheManager.set(healthCheckKey, 'ok', 1000);
      const cachedValue = await this.cacheManager.get<string>(healthCheckKey);
      await this.cacheManager.del(healthCheckKey);

      return cachedValue === 'ok';
    } catch (error) {
      this.logger.warn(
        `Redis health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return false;
    }
  }

  /**
   * Invalidates all cached news responses.
   * Called whenever news articles are created or updated.
   */
  async invalidateNewsCache(): Promise<void> {
    try {
      await this.cacheManager.del(NEWS_CACHE_KEY);
      this.logger.debug(`Cache invalidated for key: ${NEWS_CACHE_KEY}`);
    } catch (error) {
      this.logger.warn(
        `Failed to invalidate news cache: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }
}
