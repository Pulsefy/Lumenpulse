import { Injectable, Inject, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';

export const NEWS_CACHE_KEY = 'news:latest';
export const STELLAR_ASSETS_CACHE_PREFIX = 'stellar:assets';

export const STELLAR_ACCOUNT_BALANCE_PREFIX = 'stellar:account:balance';
export const STELLAR_ACCOUNT_OPERATIONS_PREFIX = 'stellar:account:operations';

export interface CacheConfig {
  balanceCacheTTL: number;
  operationsCacheTTL: number;
}

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  constructor(@Inject(CACHE_MANAGER) private readonly cacheManager: Cache) {}

  cacheConfig?: CacheConfig;

  setCacheConfig(config: CacheConfig): void {
    this.cacheConfig = config;
  }

  async get<T>(key: string): Promise<T | undefined> {
    return this.cacheManager.get<T>(key);
  }

  async set(key: string, value: unknown, ttl?: number): Promise<void> {
    await this.cacheManager.set(key, value, ttl);
  }

  async del(key: string): Promise<void> {
    await this.cacheManager.del(key);
  }

  getAccountBalanceKey(publicKey: string): string {
    return `${STELLAR_ACCOUNT_BALANCE_PREFIX}:${publicKey}`;
  }

  getAccountOperationsKey(
    publicKey: string,
    limit: number,
    cursor?: string,
  ): string {
    const cursorPart = cursor ? `:${cursor}` : '';
    return `${STELLAR_ACCOUNT_OPERATIONS_PREFIX}:${publicKey}:${limit}${cursorPart}`;
  }

  async getOrSet<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttl?: number,
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== undefined) {
      this.logger.debug(`Cache HIT for key: ${key}`);
      return cached;
    }

    this.logger.debug(`Cache MISS for key: ${key}`);
    const value = await fetcher();
    await this.set(key, value, ttl);
    return value;
  }

  async getAccountBalanceCached<T>(
    publicKey: string,
    fetcher: () => Promise<T>,
  ): Promise<T> {
    const key = this.getAccountBalanceKey(publicKey);
    const ttl = this.cacheConfig?.balanceCacheTTL ?? 30_000;
    return this.getOrSet(key, fetcher, ttl);
  }

  async getAccountOperationsCached<T>(
    publicKey: string,
    limit: number,
    fetcher: () => Promise<T>,
    cursor?: string,
  ): Promise<T> {
    const key = this.getAccountOperationsKey(publicKey, limit, cursor);
    const ttl = this.cacheConfig?.operationsCacheTTL ?? 15_000;
    return this.getOrSet(key, fetcher, ttl);
  }

  async invalidateAccountBalance(publicKey: string): Promise<void> {
    const key = this.getAccountBalanceKey(publicKey);
    await this.del(key);
    this.logger.debug(`Invalidated account balance cache for: ${publicKey}`);
  }

  async invalidateAccountOperations(publicKey: string): Promise<void> {
    try {
      // Access Redis client via store for pattern-based key deletion
      interface RedisClient {
        keys: (pattern: string) => Promise<string[]>;
      }
      const store = (this.cacheManager as { store?: { client?: RedisClient } })
        .store;
      const keys = store?.client
        ? await store.client.keys(
            `${STELLAR_ACCOUNT_OPERATIONS_PREFIX}:${publicKey}:*`,
          )
        : [];
      if (keys && Array.isArray(keys)) {
        for (const key of keys) {
          await this.cacheManager.del(key);
        }
        this.logger.debug(
          `Invalidated ${keys.length} operations cache entries for: ${publicKey}`,
        );
      }
    } catch {
      this.logger.debug(
        `Could not invalidate operations cache for: ${publicKey} (Redis client not available or keys not supported)`,
      );
    }
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
