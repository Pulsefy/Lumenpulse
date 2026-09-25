import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FeatureFlag } from './feature-flag.entity';
import { FlagAuditLog } from './entities/flag-audit-log.entity';
import { MetricsService } from '../metrics/metrics.service';

/** Short TTL (ms) for cached flag evaluations. */
const CACHE_TTL_MS = 30_000; // 30 seconds

interface CacheEntry {
  value: FeatureFlag | null;
  expiresAt: number;
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
    const all = await this.repo.find();
    this.cache.clear();
    const now = Date.now();
    for (const f of all) {
      this.cache.set(f.key, { value: f, expiresAt: now + CACHE_TTL_MS });
    }
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
      return entry.value;
    }

    // Cache miss or expired → fetch from DB
    this.evalMisses.inc();
    const f = await this.repo.findOne({ where: { key } });
    this.cache.set(key, { value: f ?? null, expiresAt: now + CACHE_TTL_MS });
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
    // Snapshot the previous enabled state as a primitive BEFORE we fetch the
    // mutable entity.  If we kept a reference to the entity object, mutating
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

    // Immediate cache invalidation — entry is repopulated with fresh TTL.
    const now = Date.now();
    this.cache.set(saved.key, {
      value: saved,
      expiresAt: now + CACHE_TTL_MS,
    });

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
  }

  /**
   * Delete a feature flag and immediately evict it from the cache.
   * Records a 'remove' audit-log entry.
   */
  async remove(key: string): Promise<void> {
    const prev = await this.getFlag(key);
    await this.repo.delete({ key });
    this.cache.delete(key);

    // Persist audit log entry.
    const auditEntry = this.auditRepo.create({
      flagKey: key,
      action: 'remove',
      previousEnabled: prev?.enabled ?? null,
      newEnabled: null,
      actor: null,
    });
    await this.auditRepo.save(auditEntry);
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
