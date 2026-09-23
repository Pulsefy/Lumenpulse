import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { MetricsService } from '../metrics/metrics.service';
import {
  CACHE_NAMES,
  LEGACY_STELLAR_CONFIG_CACHE_KEY,
  classifyCacheKey,
  CONTRACT_READ_PREFIX,
  DEFAULT_TTLS,
  EXCHANGE_RATE_CACHE_PREFIX,
  NEWS_CACHE_KEY,
  STELLAR_BALANCES_HTTP_CACHE_PREFIX,
  STELLAR_TRANSACTIONS_HTTP_CACHE_PREFIX,
  STELLAR_ACCOUNT_BALANCE_PREFIX,
  STELLAR_ACCOUNT_OPERATIONS_PREFIX,
  STELLAR_ASSETS_CACHE_PREFIX,
  type CacheName,
} from './cache.constants';

// Re-export the original constants for callers that imported them from this
// service before the cache inventory was centralised.
export {
  CACHE_NAMES,
  CONTRACT_READ_PREFIX,
  NEWS_CACHE_KEY,
  STELLAR_ACCOUNT_BALANCE_PREFIX,
  STELLAR_ACCOUNT_OPERATIONS_PREFIX,
  STELLAR_ASSETS_CACHE_PREFIX,
  type CacheName,
} from './cache.constants';

export interface CacheConfig {
  balanceCacheTTL: number;
  operationsCacheTTL: number;
  contractReadTTL: number;
}

type CacheResult = 'hit' | 'miss';
type InvalidationResult = 'success' | 'error';

interface CacheStoreWithIterator {
  iterator?: () => AsyncIterable<[string, unknown]>;
  namespace?: string;
  client?: {
    keys?: (pattern: string) => Promise<string[]>;
  };
}

interface CacheManagerWithStores {
  stores?: CacheStoreWithIterator[];
  store?: {
    namespace?: string;
    client?: {
      keys?: (pattern: string) => Promise<string[]>;
    };
  };
}

const MAX_TRACKED_KEYS = 10_000;

/**
 * Application cache facade.
 *
 * All read-through caches use this service.  It centralises three important
 * properties that were previously independent per module:
 *
 *  - physical-key classification for bounded metrics;
 *  - invalidation generation checks, so a fetch that started before a write
 *    cannot write its old result back after the write; and
 *  - checked Redis-key discovery through Keyv's SCAN-backed iterator.
 *
 * The generation is an in-process concurrency guard.  Redis deletion remains
 * the cross-process invalidation mechanism; the guard closes the in-flight
 * fill race in the process that performed the write.
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  /** A bounded local index supplements Keyv's iterator for test/in-memory use. */
  private readonly knownKeys = new Map<string, CacheName>();
  private readonly keyLoadedAt = new Map<string, number>();
  private readonly keyGenerations = new Map<string, number>();
  private readonly prefixGenerations = new Map<string, number>();
  private readonly keyFillGenerations = new Map<string, number>();
  private readonly inFlight = new Map<
    string,
    { generation: number; promise: Promise<unknown> }
  >();
  private readonly sourceLoadedAt = new Map<CacheName, number>();
  private readonly invalidatedAt = new Map<CacheName, number>();

  constructor(
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    @Optional() private readonly metricsService?: MetricsService,
  ) {}

  cacheConfig?: CacheConfig;

  setCacheConfig(config: CacheConfig): void {
    this.cacheConfig = config;
  }

  /** Return the bounded metric/cache name for a physical key. */
  getCacheName(key: string): CacheName {
    return classifyCacheKey(key);
  }

  /** Public hooks used by the observed HTTP cache interceptor. */
  recordCacheHit(key: string): void {
    this.trackKey(key);
    this.recordRead(key, 'hit');
  }

  recordCacheMiss(key: string): void {
    this.trackKey(key);
    this.recordRead(key, 'miss');
  }

  recordCacheFill(key: string): void {
    this.trackKey(key);
    this.recordFill(key);
  }

  recordCacheFillRacePrevented(key: string): void {
    const cacheName = this.getCacheName(key);
    this.safeMetrics(() =>
      this.metricsService?.recordCacheFillRacePrevented(cacheName),
    );
  }

  /** Record a key that may need prefix invalidation even before it is stored. */
  trackKey(key: string, cacheName = this.getCacheName(key)): void {
    this.knownKeys.delete(key);
    this.knownKeys.set(key, cacheName);
    while (this.knownKeys.size > MAX_TRACKED_KEYS) {
      const oldest = [...this.knownKeys.keys()].find(
        (candidate) => !this.inFlight.has(candidate),
      );
      if (oldest === undefined) break;
      this.knownKeys.delete(oldest);
      this.keyLoadedAt.delete(oldest);
      this.keyGenerations.delete(oldest);
      this.keyFillGenerations.delete(oldest);
    }
  }

  private rememberKeyGeneration(key: string): void {
    const next = (this.keyGenerations.get(key) ?? 0) + 1;
    this.keyGenerations.delete(key);
    this.keyGenerations.set(key, next);
    while (this.keyGenerations.size > MAX_TRACKED_KEYS) {
      const oldest = this.keyGenerations.keys().next().value as
        | string
        | undefined;
      if (oldest === undefined || this.inFlight.has(oldest)) break;
      this.keyGenerations.delete(oldest);
    }
  }

  /**
   * Return the current invalidation generation for a key.  Consumers that
   * perform an asynchronous fill should retain this value and check
   * `isGenerationCurrent` before writing.
   */
  getGeneration(key: string): number {
    let generation = this.keyGenerations.get(key) ?? 0;
    for (const [prefix, prefixGeneration] of this.prefixGenerations) {
      if (key.startsWith(prefix)) generation += prefixGeneration;
    }
    return generation;
  }

  isGenerationCurrent(key: string, generation: number): boolean {
    return this.getGeneration(key) === generation;
  }

  /** Whether the physical value belongs to the current invalidation generation. */
  isKeyFresh(key: string): boolean {
    const fillGeneration = this.keyFillGenerations.get(key);
    return fillGeneration === undefined
      ? this.getGeneration(key) === 0
      : fillGeneration === this.getGeneration(key);
  }

  /** Read a value while recording hit/miss and staleness telemetry. */
  async get<T>(key: string): Promise<T | undefined> {
    this.trackKey(key);
    const readGeneration = this.getGeneration(key);
    const value = await this.cacheManager.get<T>(key);
    const generationCurrent = this.isGenerationCurrent(key, readGeneration);
    if (value !== undefined && generationCurrent && this.isKeyFresh(key)) {
      this.recordRead(key, 'hit');
      return value;
    }
    if (value !== undefined && generationCurrent) {
      await this.cacheManager.del(key);
      this.keyFillGenerations.delete(key);
      this.keyLoadedAt.delete(key);
    }
    this.recordRead(key, 'miss');
    return undefined;
  }

  /** Store a value and mark the corresponding source generation as fresh. */
  async set(key: string, value: unknown, ttl?: number): Promise<void> {
    this.trackKey(key);
    const generation = this.getGeneration(key);
    await this.cacheManager.set(key, value, ttl);
    if (!this.isGenerationCurrent(key, generation)) {
      // A source write invalidated this key while the physical set was in
      // flight. Do not let the old value become a fresh hit in this process.
      try {
        await this.cacheManager.del(key);
      } catch (error) {
        this.logger.warn(
          `Failed to remove a raced cache fill for ${this.getCacheName(key)}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
      }
      this.keyFillGenerations.delete(key);
      this.keyLoadedAt.delete(key);
      this.safeMetrics(() =>
        this.metricsService?.recordCacheFillRacePrevented(
          this.getCacheName(key),
        ),
      );
      return;
    }
    this.keyFillGenerations.set(key, generation);
    this.recordFill(key);
  }

  /**
   * Store a precomputed value only if the invalidation generation captured by
   * the caller is still current. This is used by the warm-cache preloader so
   * a refresh cannot overwrite a grant write that happened during its loader.
   */
  async setIfCurrent(
    key: string,
    value: unknown,
    ttl: number | undefined,
    generation: number,
  ): Promise<boolean> {
    if (!this.isGenerationCurrent(key, generation)) {
      this.safeMetrics(() =>
        this.metricsService?.recordCacheFillRacePrevented(
          this.getCacheName(key),
        ),
      );
      return false;
    }
    await this.cacheManager.set(key, value, ttl);
    if (!this.isGenerationCurrent(key, generation)) {
      await this.cacheManager.del(key);
      this.keyFillGenerations.delete(key);
      this.keyLoadedAt.delete(key);
      this.safeMetrics(() =>
        this.metricsService?.recordCacheFillRacePrevented(
          this.getCacheName(key),
        ),
      );
      return false;
    }
    this.trackKey(key);
    this.keyFillGenerations.set(key, generation);
    this.recordFill(key);
    return true;
  }

  /** Delete one key and advance its invalidation generation. */
  async del(key: string): Promise<void> {
    const cacheName = this.getCacheName(key);
    this.rememberKeyGeneration(key);
    this.rememberInvalidation(cacheName);
    try {
      await this.cacheManager.del(key);
      this.knownKeys.delete(key);
      this.keyFillGenerations.delete(key);
      this.keyLoadedAt.delete(key);
      this.recordInvalidation(cacheName, 'success');
    } catch (error) {
      this.recordInvalidation(cacheName, 'error');
      throw error;
    }
  }

  /**
   * Read-through cache with in-flight coalescing and a write-race guard.
   * A miss is fetched at most once per key at a time.  If an invalidation
   * occurs while the fetch is running, the result is discarded and fetched
   * again once before being returned without caching if writes keep racing.
   */
  async getOrSet<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttl?: number,
  ): Promise<T> {
    this.trackKey(key);
    const readGeneration = this.getGeneration(key);
    const cached = await this.cacheManager.get<T>(key);
    const generationCurrent = this.isGenerationCurrent(key, readGeneration);
    if (cached !== undefined && generationCurrent && this.isKeyFresh(key)) {
      this.recordRead(key, 'hit');
      return cached;
    }
    if (cached !== undefined && generationCurrent) {
      await this.cacheManager.del(key);
      this.keyFillGenerations.delete(key);
      this.keyLoadedAt.delete(key);
    }

    this.recordRead(key, 'miss');
    const generation = this.getGeneration(key);
    const existing = this.inFlight.get(key);
    if (existing && existing.generation === generation) {
      return existing.promise as Promise<T>;
    }

    const load = this.loadAndCache(key, fetcher, ttl);
    this.inFlight.set(key, {
      generation,
      promise: load as Promise<unknown>,
    });
    try {
      return await load;
    } finally {
      if (this.inFlight.get(key)?.promise === load) {
        this.inFlight.delete(key);
      }
    }
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

  async getAccountBalanceCached<T>(
    publicKey: string,
    fetcher: () => Promise<T>,
  ): Promise<T> {
    const key = this.getAccountBalanceKey(publicKey);
    const ttl =
      this.cacheConfig?.balanceCacheTTL ?? DEFAULT_TTLS.accountBalance;
    return this.getOrSet(key, fetcher, ttl);
  }

  async getAccountOperationsCached<T>(
    publicKey: string,
    limit: number,
    fetcher: () => Promise<T>,
    cursor?: string,
  ): Promise<T> {
    const key = this.getAccountOperationsKey(publicKey, limit, cursor);
    const ttl =
      this.cacheConfig?.operationsCacheTTL ?? DEFAULT_TTLS.accountOperations;
    return this.getOrSet(key, fetcher, ttl);
  }

  async invalidateAccountBalance(publicKey: string): Promise<void> {
    await this.invalidateAll([
      this.del(this.getAccountBalanceKey(publicKey)),
      this.invalidatePrefix(
        `${STELLAR_BALANCES_HTTP_CACHE_PREFIX}publicKey=${encodeURIComponent(publicKey)}`,
      ),
    ]);
  }

  async invalidateAccountOperations(publicKey: string): Promise<void> {
    await this.invalidateAll([
      this.invalidatePrefix(
        `${STELLAR_ACCOUNT_OPERATIONS_PREFIX}:${publicKey}:`,
      ),
      this.invalidatePrefix(
        `${STELLAR_TRANSACTIONS_HTTP_CACHE_PREFIX}publicKey=${encodeURIComponent(publicKey)}`,
      ),
    ]);
  }

  async checkHealth(): Promise<boolean> {
    const healthCheckKey = `health:redis:${Date.now()}`;

    try {
      await this.cacheManager.set(healthCheckKey, 'ok', 1_000);
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

  /** Invalidate the base key and all filtered latest-news variants. */
  async invalidateNewsCache(): Promise<void> {
    try {
      await this.invalidatePrefix(NEWS_CACHE_KEY);
      // Keep the explicit legacy deletion for stores which do not expose a
      // Keyv iterator and for deployments upgrading from the old key layout.
      // The call is idempotent when prefix discovery already removed it.
      if (this.cacheManagerHasNoStoreDiscovery()) {
        try {
          await this.cacheManager.del(NEWS_CACHE_KEY);
        } catch (error) {
          this.recordInvalidation(CACHE_NAMES.NEWS, 'error');
          throw error;
        }
      }
    } catch (error) {
      this.logger.warn(
        `Failed to invalidate news cache: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw error;
    }
  }

  // ── Contract Read Caching ─────────────────────────────────────────────────

  getContractReadKey(
    contractId: string,
    method: string,
    args: Record<string, unknown> = {},
  ): string {
    const argsHash = Buffer.from(JSON.stringify(args)).toString('base64');
    return `${CONTRACT_READ_PREFIX}:${contractId}:${method}:${argsHash}`;
  }

  async getContractReadCached<T>(
    contractId: string,
    method: string,
    args: Record<string, unknown>,
    fetcher: () => Promise<T>,
  ): Promise<T> {
    const key = this.getContractReadKey(contractId, method, args);
    const ttl = this.cacheConfig?.contractReadTTL ?? DEFAULT_TTLS.contractRead;
    return this.getOrSet(key, fetcher, ttl);
  }

  async invalidateContractRead(
    contractId: string,
    method?: string,
  ): Promise<void> {
    const pattern = method
      ? `${CONTRACT_READ_PREFIX}:${contractId}:${method}:`
      : `${CONTRACT_READ_PREFIX}:${contractId}:`;
    await this.invalidatePrefix(pattern);
  }

  async invalidateContractById(contractId: string): Promise<void> {
    await this.invalidateContractRead(contractId);
  }

  /** Invalidate configuration and capability-catalog response caches. */
  async invalidateConfigCaches(): Promise<void> {
    await this.invalidateAll([
      this.invalidatePrefix('stellar:config'),
      this.del(LEGACY_STELLAR_CONFIG_CACHE_KEY),
      this.invalidatePrefix('contracts:capabilities'),
      // Contract IDs are part of the source version for generic contract reads.
      this.invalidatePrefix(`${CONTRACT_READ_PREFIX}:`),
    ]);
  }

  async invalidateExchangeRate(
    fromCurrency: string,
    toCurrency: string,
  ): Promise<void> {
    void fromCurrency;
    void toCurrency;
    // Clear the family so pre-canonicalization keys such as `usd_eur` cannot
    // survive a source refresh after deployment.
    await this.invalidatePrefix(`${EXCHANGE_RATE_CACHE_PREFIX}:`);
  }

  async invalidateContributorCaches(
    address?: string,
    githubHandle?: string,
    broad = false,
  ): Promise<void> {
    const prefixes = [
      'contributor-registry:address:',
      'contributor-registry:reputation:',
      'contributor-registry:nonce:',
      'contributor-registry:github:',
    ];

    if (broad || !address || !githubHandle) {
      // A chain event may omit the subject or may refer to an old GitHub
      // handle. Namespace invalidation is the only safe way to cover every
      // representation without maintaining a reverse address/handle index.
      await this.invalidateAll(
        prefixes.map((prefix) => this.invalidatePrefix(prefix)),
      );
      return;
    }

    const keys = [
      `contributor-registry:address:${address}`,
      `contributor-registry:reputation:${address}`,
      `contributor-registry:nonce:${address}`,
      `contributor-registry:github:${githubHandle.toLowerCase()}`,
    ];
    await this.invalidateAll(keys.map((key) => this.del(key)));
  }

  /** Invalidate all warm-cache entries owned by the grants read paths. */
  async invalidateWarmGrantsCaches(): Promise<void> {
    await this.invalidateAll([
      this.invalidatePrefix('warm:grants:rounds'),
      this.invalidatePrefix('warm:grants:leaderboard'),
    ]);
  }

  /**
   * Synchronously advances the warm-cache generation while the Redis deletion
   * completes in the background. This lets legacy synchronous grant mutation
   * methods provide read-after-write semantics without changing their public
   * API; the next cached read is forced to miss even if deletion is delayed.
   */
  invalidateWarmGrantsCachesSoon(): void {
    void this.invalidateWarmGrantsCaches().catch((error: unknown) => {
      this.logger.warn(
        `Warm grant cache invalidation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    });
  }

  /** Run independent invalidation boundaries together and surface failures. */
  private async invalidateAll(operations: Promise<void>[]): Promise<void> {
    const results = await Promise.allSettled(operations);
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (failure) throw failure.reason;
  }

  /**
   * Invalidate every physical key beginning with `prefix`.  Keyv's iterator
   * uses SCAN for Redis, so this does not issue a blocking Redis KEYS call.
   */
  async invalidatePrefix(prefix: string): Promise<void> {
    const cacheName = this.getCacheName(prefix);
    const nextPrefixGeneration = (this.prefixGenerations.get(prefix) ?? 0) + 1;
    this.prefixGenerations.delete(prefix);
    this.prefixGenerations.set(prefix, nextPrefixGeneration);
    while (this.prefixGenerations.size > MAX_TRACKED_KEYS) {
      const oldest = [...this.prefixGenerations.keys()].find(
        (prefix) =>
          ![...this.inFlight.keys()].some((key) => key.startsWith(prefix)),
      );
      if (oldest === undefined) break;
      this.prefixGenerations.delete(oldest);
    }
    this.rememberInvalidation(cacheName);

    try {
      const keys = await this.findKeys(prefix);
      const deletions = await Promise.allSettled(
        keys.map(async (key) => {
          await this.cacheManager.del(key);
          this.knownKeys.delete(key);
          this.keyFillGenerations.delete(key);
          this.keyLoadedAt.delete(key);
        }),
      );
      const failure = deletions.find(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected',
      );
      if (failure) throw failure.reason;
      this.recordInvalidation(cacheName, 'success');
      this.logger.debug(
        `Invalidated ${keys.length} cache entr${keys.length === 1 ? 'y' : 'ies'} for ${cacheName}`,
      );
    } catch (error) {
      this.recordInvalidation(cacheName, 'error');
      throw error;
    }
  }

  // ── Metrics Recording ─────────────────────────────────────────────────────

  private async loadAndCache<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttl?: number,
  ): Promise<T> {
    let value: T | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const generation = this.getGeneration(key);
      const startTime = Date.now();
      value = await fetcher();
      const fetchDuration = Date.now() - startTime;

      if (!this.isGenerationCurrent(key, generation)) {
        this.safeMetrics(() =>
          this.metricsService?.recordCacheFillRacePrevented(
            this.getCacheName(key),
          ),
        );
        continue;
      }

      await this.cacheManager.set(key, value, ttl);
      if (!this.isGenerationCurrent(key, generation)) {
        await this.cacheManager.del(key);
        this.keyFillGenerations.delete(key);
        this.keyLoadedAt.delete(key);
        this.safeMetrics(() =>
          this.metricsService?.recordCacheFillRacePrevented(
            this.getCacheName(key),
          ),
        );
        continue;
      }
      this.trackKey(key);
      this.keyFillGenerations.set(key, generation);
      this.recordFill(key);
      this.recordCacheLatency(key, fetchDuration);
      return value;
    }

    // A continuously invalidating source must not receive a stale fill.  The
    // value is still returned to the caller that requested it, but it is not
    // persisted; the next request will retry against the latest generation.
    return value as T;
  }

  private recordRead(key: string, result: CacheResult): void {
    const cacheName = this.getCacheName(key);
    const staleness = this.getCacheStaleness(cacheName, key);
    this.safeMetrics(() =>
      this.metricsService?.recordCacheRead(cacheName, result, staleness),
    );
    if (result === 'hit' && this.invalidatedAt.get(cacheName) !== undefined) {
      const invalidatedAt = this.invalidatedAt.get(cacheName) ?? 0;
      const loadedAt =
        this.keyLoadedAt.get(key) ?? this.sourceLoadedAt.get(cacheName) ?? 0;
      if (invalidatedAt > loadedAt) {
        this.safeMetrics(() =>
          this.metricsService?.recordStaleCacheServing(cacheName),
        );
      }
    }

    // Preserve the existing aggregate counters used by current dashboards.
    if (this.metricsService) {
      const labels = { key_type: this.getKeyType(key) };
      this.safeMetrics(() => {
        if (result === 'hit') {
          this.metricsService?.incrementCounter('cache_hits_total', labels);
        } else {
          this.metricsService?.incrementCounter('cache_misses_total', labels);
        }
      });
    }
  }

  private recordFill(key: string): void {
    const cacheName = this.getCacheName(key);
    const loadedAt = Date.now();
    this.keyFillGenerations.set(key, this.getGeneration(key));
    this.keyLoadedAt.set(key, loadedAt);
    this.sourceLoadedAt.set(cacheName, loadedAt);
    this.safeMetrics(() =>
      this.metricsService?.setCacheStaleness(cacheName, 0),
    );
  }

  private recordCacheLatency(key: string, durationMs: number): void {
    if (!this.metricsService) return;
    this.safeMetrics(() =>
      this.metricsService?.recordHistogram(
        'cache_fetch_duration_ms',
        durationMs,
        {
          key_type: this.getKeyType(key),
        },
      ),
    );
  }

  private rememberInvalidation(cacheName: CacheName): void {
    this.invalidatedAt.set(cacheName, Date.now());
  }

  private getCacheStaleness(cacheName: CacheName, key?: string): number {
    const loadedAt =
      (key ? this.keyLoadedAt.get(key) : undefined) ??
      this.sourceLoadedAt.get(cacheName) ??
      0;
    const invalidatedAt = this.invalidatedAt.get(cacheName) ?? 0;
    const generationStart = Math.max(loadedAt, invalidatedAt);
    if (generationStart === 0) return 0;
    return Math.max(0, (Date.now() - generationStart) / 1_000);
  }

  private recordInvalidation(
    cacheName: CacheName,
    result: InvalidationResult,
  ): void {
    this.safeMetrics(() =>
      this.metricsService?.recordCacheInvalidation(cacheName, result),
    );
  }

  private safeMetrics(action: () => void): void {
    try {
      action();
    } catch {
      // Telemetry must never change cache correctness or availability.
    }
  }

  private async findKeys(prefix: string): Promise<string[]> {
    const keys = new Set<string>();
    for (const key of this.knownKeys.keys()) {
      if (key.startsWith(prefix)) keys.add(key);
    }

    const discoveryErrors: unknown[] = [];
    const manager = this.cacheManager as unknown as CacheManagerWithStores;
    const stores = manager.stores ?? [];
    for (const store of stores) {
      let iteratorError: unknown;
      if (typeof store.iterator === 'function') {
        try {
          for await (const entry of store.iterator()) {
            const key = Array.isArray(entry) ? String(entry[0]) : String(entry);
            const normalized = this.normalizeKey(key, store.namespace);
            if (normalized.startsWith(prefix)) keys.add(normalized);
          }
          continue;
        } catch (error) {
          iteratorError = error;
          this.logger.debug(
            `Cache key iterator failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          );
        }
      }

      // Fall back to the adapter's key operation when an iterator is
      // unavailable or fails. The fallback is retained for older adapters;
      // production Keyv uses the SCAN-backed iterator above.
      const client = store.client;
      if (client?.keys) {
        try {
          const patterns = store.namespace
            ? [
                `${store.namespace}::${prefix}*`,
                `${store.namespace}:${prefix}*`,
              ]
            : [`${prefix}*`];
          const discovered: string[] = [];
          for (const pattern of patterns) {
            const result = (await client.keys(pattern)) ?? [];
            if (!Array.isArray(result)) {
              throw new Error('Cache key discovery did not return an array');
            }
            discovered.push(...result);
          }
          for (const key of discovered) {
            const normalized = this.normalizeKey(key, store.namespace);
            if (normalized.startsWith(prefix)) keys.add(normalized);
          }
        } catch (error) {
          this.logger.debug(
            `Cache key client fallback failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          );
          discoveryErrors.push(error);
        }
      } else if (iteratorError !== undefined) {
        discoveryErrors.push(iteratorError);
      } else {
        discoveryErrors.push(
          new Error('Cache store does not expose key discovery'),
        );
      }
    }

    // Compatibility with the old CacheManager v5 shape used by older
    // deployments/tests.  The Keyv iterator above is preferred in production.
    if (stores.length === 0 && manager.store?.client?.keys) {
      try {
        const namespace = manager.store.namespace;
        const patterns = namespace
          ? [`${namespace}::${prefix}*`, `${namespace}:${prefix}*`]
          : [`${prefix}*`];
        const discovered: string[] = [];
        for (const pattern of patterns) {
          const result = (await manager.store.client.keys(pattern)) ?? [];
          if (!Array.isArray(result)) {
            throw new Error('Cache key discovery did not return an array');
          }
          discovered.push(...result);
        }
        for (const key of discovered) {
          const normalized = this.normalizeKey(key, namespace);
          if (normalized.startsWith(prefix)) keys.add(normalized);
        }
      } catch (error) {
        discoveryErrors.push(error);
      }
    }

    if (discoveryErrors.length > 0) {
      throw discoveryErrors[0];
    }

    return [...keys];
  }

  private normalizeKey(key: string, namespace?: string): string {
    if (!namespace) return key;
    // Keyv's Redis adapter uses `namespace::key`, while older adapters and
    // test doubles commonly expose `namespace:key`. Accept both forms when
    // normalizing iterator/client discovery results.
    for (const separator of ['::', ':']) {
      const prefix = `${namespace}${separator}`;
      if (key.startsWith(prefix)) return key.slice(prefix.length);
    }
    return key;
  }

  private cacheManagerHasNoStoreDiscovery(): boolean {
    const manager = this.cacheManager as unknown as CacheManagerWithStores;
    return !manager.stores?.some(
      (store) => typeof store.iterator === 'function',
    );
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

  /** Get the aggregate hit rate retained for existing monitoring callers. */
  getCacheHitRate(): number {
    if (!this.metricsService) return 0;

    const hits = this.metricsService.getCounterValue('cache_hits_total');
    const misses = this.metricsService.getCounterValue('cache_misses_total');
    const total = hits + misses;
    return total > 0 ? hits / total : 0;
  }
}
