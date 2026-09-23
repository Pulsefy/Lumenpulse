import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FeatureFlag } from './feature-flag.entity';
import { FlagAuditLog } from './entities/flag-audit-log.entity';
import { MetricsService } from '../metrics/metrics.service';
import { CACHE_NAMES, DEFAULT_TTLS } from '../cache/cache.constants';

/** Short TTL (ms) for cached flag evaluations. */
const CACHE_TTL_MS = DEFAULT_TTLS.featureFlag;

interface CacheEntry {
  value: FeatureFlag | null;
  expiresAt: number;
  loadedAt: number;
}

@Injectable()
export class FeatureFlagsService implements OnModuleInit {
  private readonly logger = new Logger(FeatureFlagsService.name);

  /**
   * In-memory cache with TTL entries.
   * Each entry holds the flag value and the timestamp at which it expires.
   * Entries are invalidated immediately on every write (upsert / remove).
   */
  private cache = new Map<string, CacheEntry>();
  private readonly writeLocks = new Map<string, Promise<void>>();
  private cacheGeneration = 0;

  // ── Prometheus metrics ────────────────────────────────────────────────────

  private readonly evalHits: ReturnType<MetricsService['getOrCreateCounter']>;
  private readonly evalMisses: ReturnType<MetricsService['getOrCreateCounter']>;
  private readonly evalLatency: ReturnType<
    MetricsService['getOrCreateHistogram']
  >;

  constructor(
    @InjectRepository(FeatureFlag)
    private readonly repo: Repository<FeatureFlag>,

    @InjectRepository(FlagAuditLog)
    private readonly auditRepo: Repository<FlagAuditLog>,

    private readonly metrics: MetricsService,
  ) {
    this.evalHits = this.metrics.getOrCreateCounter(
      'feature_flag_cache_hits_total',
      'Total feature-flag evaluation cache hits',
    );

    this.evalMisses = this.metrics.getOrCreateCounter(
      'feature_flag_cache_misses_total',
      'Total feature-flag evaluation cache misses (DB round-trips)',
    );

    this.evalLatency = this.metrics.getOrCreateHistogram(
      'feature_flag_evaluation_duration_seconds',
      'End-to-end latency of feature-flag evaluations',
      [],
      [0.0001, 0.0005, 0.001, 0.005, 0.01, 0.05, 0.1],
    );
  }

  async onModuleInit() {
    await this.refreshCache();
  }

  /** Warms the in-memory cache from DB. */
  async refreshCache() {
    const generation = ++this.cacheGeneration;
    const all = await this.repo.find();
    if (generation !== this.cacheGeneration) return;
    this.cache.clear();
    const now = Date.now();
    for (const f of all) {
      this.cache.set(f.key, {
        value: { ...f },
        expiresAt: now + CACHE_TTL_MS,
        loadedAt: now,
      });
    }
    // Reads that began while the refresh query was in flight captured the
    // generation from its start. Advance once more after publishing the new
    // map so those reads cannot cache a pre-refresh value.
    this.cacheGeneration += 1;
    this.markCacheFresh();
    this.logger.log(`Loaded ${all.length} feature flags into cache`);
  }

  async listFlags(): Promise<FeatureFlag[]> {
    return this.repo.find();
  }

  /**
   * Returns the FeatureFlag or null.
   *
   * Cache lookup is attempted first; on a miss (expired or absent) the DB is
   * queried and the result is stored with a fresh TTL.
   */
  async getFlag(key: string): Promise<FeatureFlag | null> {
    const now = Date.now();
    const entry = this.cache.get(key);

    if (entry !== undefined && entry.expiresAt > now) {
      this.evalHits.inc();
      this.recordCacheRead('hit', Math.max(0, (now - entry.loadedAt) / 1_000));
      return entry.value;
    }

    // Cache miss or expired → fetch from DB. Capture the generation before
    // the asynchronous read so a write completing during the query cannot
    // repopulate the cache with the pre-write value.
    const generation = this.cacheGeneration;
    this.evalMisses.inc();
    this.recordCacheRead('miss', 0);
    const f = await this.repo.findOne({ where: { key } });
    if (generation === this.cacheGeneration) {
      const loadedAt = Date.now();
      this.cache.set(key, {
        value: f ? { ...f } : null,
        expiresAt: loadedAt + CACHE_TTL_MS,
        loadedAt,
      });
      this.markCacheFresh();
    }
    return f ?? null;
  }

  /**
   * Check whether a flag is enabled.
   * Records end-to-end evaluation latency.
   */
  async isEnabled(
    key: string,
    _context?: Record<string, unknown>,
  ): Promise<boolean> {
    void _context;
    const endTimer = this.evalLatency.startTimer();
    try {
      const f = await this.getFlag(key);
      return !!(f && f.enabled);
    } finally {
      endTimer();
    }
  }

  /**
   * Create or update a feature flag.
   *
   * - Immediately invalidates the cache entry for `key`.
   * - Persists an immutable audit-log row with actor, previous, and new state.
   */
  async upsert(
    key: string,
    enabled: boolean,
    conditions?: Record<string, unknown>,
    changedBy?: string,
  ) {
    return this.withWriteLock(key, async () => {
      // Snapshot the previous enabled state as a primitive BEFORE we fetch the
      // mutable entity. If we kept a reference to the entity object, mutating
      // f.enabled below would silently change `prevFlag.enabled` too (aliasing).
      const prevFlag = await this.getFlag(key);
      const previousEnabled: boolean | null = prevFlag?.enabled ?? null;

      let f = await this.repo.findOne({ where: { key } });
      if (!f) {
        f = this.repo.create({
          key,
          enabled,
          conditions: conditions ?? null,
          changedBy: changedBy ?? null,
        });
      } else {
        f.enabled = enabled;
        f.conditions = conditions ?? null;
        f.changedBy = changedBy ?? null;
      }
      const saved = await this.repo.save(f);
      // Advance after the database write. Reads that began before the save
      // captured the old generation and therefore cannot cache their result
      // over this replacement.
      this.cacheGeneration += 1;
      this.recordCacheInvalidation('success');

      // The write lock makes this replacement the only post-save cache write
      // for the key. A later write therefore cannot be overwritten by an
      // earlier, slower save.
      const now = Date.now();
      this.cache.set(saved.key, {
        value: saved,
        expiresAt: now + CACHE_TTL_MS,
        loadedAt: now,
      });
      this.markCacheFresh();

      // Persist audit log entry.
      const auditEntry = this.auditRepo.create({
        flagKey: key,
        action: 'upsert',
        previousEnabled,
        newEnabled: enabled,
        actor: changedBy ?? null,
      });
      await this.auditRepo.save(auditEntry);

      this.logger.log(
        `Flag "${key}" changed: ${previousEnabled ?? 'N/A'} -> ${enabled}` +
          (changedBy ? ` by ${changedBy}` : ''),
      );

      return saved;
    });
  }

  /**
   * Delete a feature flag and immediately evict it from the cache.
   * Records a 'remove' audit-log entry.
   */
  async remove(key: string): Promise<void> {
    await this.withWriteLock(key, async () => {
      const prev = await this.getFlag(key);
      await this.repo.delete({ key });
      this.cacheGeneration += 1;
      this.recordCacheInvalidation('success');
      this.cache.delete(key);
      this.markCacheFresh();

      // Persist audit log entry.
      const auditEntry = this.auditRepo.create({
        flagKey: key,
        action: 'remove',
        previousEnabled: prev?.enabled ?? null,
        newEnabled: null,
        actor: null,
      });
      await this.auditRepo.save(auditEntry);
    });
  }

  private async withWriteLock<T>(
    key: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const previous = this.writeLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.writeLocks.set(key, current);
    await previous;
    try {
      return await action();
    } finally {
      release();
      if (this.writeLocks.get(key) === current) this.writeLocks.delete(key);
    }
  }

  private recordCacheRead(
    result: 'hit' | 'miss',
    stalenessSeconds: number,
  ): void {
    // Older unit-test doubles intentionally expose only the legacy metric
    // helpers; keep those doubles compatible while using the new metric when
    // the full service is available.
    this.safeMetrics(() => {
      if (typeof this.metrics.recordCacheRead === 'function') {
        this.metrics.recordCacheRead(
          CACHE_NAMES.FEATURE_FLAG,
          result,
          stalenessSeconds,
        );
      }
    });
  }

  private markCacheFresh(): void {
    this.safeMetrics(() => {
      if (typeof this.metrics.setCacheStaleness === 'function') {
        this.metrics.setCacheStaleness(CACHE_NAMES.FEATURE_FLAG, 0);
      }
    });
  }

  private recordCacheInvalidation(result: 'success' | 'error'): void {
    this.safeMetrics(() => {
      if (typeof this.metrics.recordCacheInvalidation === 'function') {
        this.metrics.recordCacheInvalidation(CACHE_NAMES.FEATURE_FLAG, result);
      }
    });
  }

  private safeMetrics(action: () => void): void {
    try {
      action();
    } catch {
      // Telemetry must not make feature-flag evaluation or writes fail.
    }
  }

  /**
   * Returns the full audit history for a given flag key, newest-first.
   * Used by the admin endpoint.
   */
  async getFlagHistory(key: string): Promise<FlagAuditLog[]> {
    return this.auditRepo.find({
      where: { flagKey: key },
      order: { changedAt: 'DESC' },
    });
  }
}
