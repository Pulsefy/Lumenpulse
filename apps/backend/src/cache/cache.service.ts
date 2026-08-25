import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { MetricsService } from '../metrics/metrics.service';

export const NEWS_CACHE_KEY = 'news:latest';
export const STELLAR_ASSETS_CACHE_PREFIX = 'stellar:assets';

export const STELLAR_ACCOUNT_BALANCE_PREFIX = 'stellar:account:balance';
export const STELLAR_ACCOUNT_OPERATIONS_PREFIX = 'stellar:account:operations';
export const CONTRACT_READ_PREFIX = 'contract:read';

export interface CacheConfig {
  balanceCacheTTL: number;
  operationsCacheTTL: number;
  contractReadTTL: number;
}

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  constructor(
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    @Optional() private readonly metricsService?: MetricsService,
  ) {}

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
      this.recordCacheHit(key);
      return cached;
    }

    this.logger.debug(`Cache MISS for key: ${key}`);
    this.recordCacheMiss(key);

    const startTime = Date.now();
    const value = await fetcher();
    const fetchDuration = Date.now() - startTime;

    await this.set(key, value, ttl);
    this.recordCacheLatency(key, fetchDuration);
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

  // ── Contract Read Caching ─────────────────────────────────────────────────────

  /**
   * Generate cache key for contract read operations
   */
  getContractReadKey(
    contractId: string,
    method: string,
    args: Record<string, unknown> = {},
  ): string {
    const argsHash = Buffer.from(JSON.stringify(args)).toString('base64');
    return `${CONTRACT_READ_PREFIX}:${contractId}:${method}:${argsHash}`;
  }

  /**
   * Cache contract read method calls with TTL
   */
  async getContractReadCached<T>(
    contractId: string,
    method: string,
    args: Record<string, unknown>,
    fetcher: () => Promise<T>,
  ): Promise<T> {
    const key = this.getContractReadKey(contractId, method, args);
    const ttl = this.cacheConfig?.contractReadTTL ?? 60_000; // Default 1 minute
    return this.getOrSet(key, fetcher, ttl);
  }

  /**
   * Invalidate cache for a specific contract method
   */
  async invalidateContractRead(
    contractId: string,
    method?: string,
  ): Promise<void> {
    try {
      const pattern = method
        ? `${CONTRACT_READ_PREFIX}:${contractId}:${method}:*`
        : `${CONTRACT_READ_PREFIX}:${contractId}:*`;

      interface RedisClient {
        keys: (pattern: string) => Promise<string[]>;
      }
      const store = (this.cacheManager as { store?: { client?: RedisClient } })
        .store;
      const keys = store?.client ? await store.client.keys(pattern) : [];

      if (keys && Array.isArray(keys) && keys.length > 0) {
        for (const key of keys) {
          await this.cacheManager.del(key);
        }
        this.logger.debug(
          `Invalidated ${keys.length} contract read cache entries for ${contractId}${method ? `:${method}` : ''}`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Failed to invalidate contract read cache: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Invalidate all contract read cache for a specific contract ID
   */
  async invalidateContractById(contractId: string): Promise<void> {
    await this.invalidateContractRead(contractId);
  }

  // ── Metrics Recording ───────────────────────────────────────────────────────────

  private recordCacheHit(key: string): void {
    if (!this.metricsService) return;

    const keyType = this.getKeyType(key);
    this.metricsService.incrementCounter('cache_hits_total', {
      key_type: keyType,
    });
  }

  private recordCacheMiss(key: string): void {
    if (!this.metricsService) return;

    const keyType = this.getKeyType(key);
    this.metricsService.incrementCounter('cache_misses_total', {
      key_type: keyType,
    });
  }

  private recordCacheLatency(key: string, durationMs: number): void {
    if (!this.metricsService) return;

    const keyType = this.getKeyType(key);
    this.metricsService.recordHistogram('cache_fetch_duration_ms', durationMs, {
      key_type: keyType,
    });
  }

  private getKeyType(key: string): string {
    if (key.startsWith(STELLAR_ACCOUNT_BALANCE_PREFIX))
      return 'account_balance';
    if (key.startsWith(STELLAR_ACCOUNT_OPERATIONS_PREFIX))
      return 'account_operations';
    if (key.startsWith(CONTRACT_READ_PREFIX)) return 'contract_read';
    if (key.startsWith(STELLAR_ASSETS_CACHE_PREFIX)) return 'stellar_assets';
    if (key.startsWith(NEWS_CACHE_KEY)) return 'news';
    return 'other';
  }

  /**
   * Get cache hit rate for monitoring
   */
  getCacheHitRate(): number {
    if (!this.metricsService) return 0;

    const hits = this.metricsService.getCounterValue('cache_hits_total');
    const misses = this.metricsService.getCounterValue('cache_misses_total');
    const total = hits + misses;

    return total > 0 ? hits / total : 0;
  }
}
