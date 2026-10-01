import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FeatureFlag } from './feature-flag.entity';
import { FlagAuditLog } from './entities/flag-audit-log.entity';
import { MetricsService } from '../metrics/metrics.service';
import {
  FlagEvaluationReason,
  FlagTargeting,
  FlagTargetingInput,
  normalizeRolloutPercentage,
  readTargeting,
  resolveFlag,
  sanitizeTargetingInput,
  snapshotTargeting,
} from './flag-targeting';

/** Short TTL (ms) for cached flag evaluations. */
const CACHE_TTL_MS = 30_000; // 30 seconds

interface CacheEntry {
  value: FeatureFlag | null;
  expiresAt: number;
}

/**
 * Caller identity passed to an evaluation.
 *
 * `principalId` is the stable identifier targeting buckets on. `request` is
 * kept for callers that want the raw request (e.g. future segment rules) and
 * so the existing guard contract is unchanged.
 */
export interface FlagEvaluationContext {
  principalId?: string | null;
  request?: unknown;
}

/** Full outcome of evaluating one flag for one principal. */
export interface FlagEvaluation {
  key: string;
  principalId: string | null;
  enabled: boolean;
  reason: FlagEvaluationReason;
  bucket: number | null;
  rolloutPercentage: number | null;
  allowList: string[];
  denyList: string[];
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
  private readonly evalByReason: ReturnType<
    MetricsService['getOrCreateCounter']
  >;
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

    // Makes rollout coverage observable: the share of evaluations resolved by
    // each rule (percentage, allow/deny list, default) without any per-user
    // label cardinality.
    this.evalByReason = this.metrics.getOrCreateCounter(
      'feature_flag_evaluations_by_reason_total',
      'Total feature-flag evaluations split by the rule that resolved them',
      ['reason'],
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
   * Check whether a flag is enabled for the given caller.
   *
   * Pass a `principalId` in the context to have percentage and list targeting
   * applied; without one the flag's stored state is used, so an anonymous
   * caller never gets a bucket-based answer.
   * Records end-to-end evaluation latency.
   */
  async isEnabled(
    key: string,
    context?: FlagEvaluationContext,
  ): Promise<boolean> {
    const endTimer = this.evalLatency.startTimer();
    try {
      const f = await this.getFlag(key);
      const { enabled, reason } = resolveFlag(f, context?.principalId);
      this.evalByReason.inc({ reason });
      return enabled;
    } finally {
      endTimer();
    }
  }

  /**
   * Evaluate a flag for one principal and report why it resolved that way.
   *
   * This is the debugging entry point behind `isEnabled`: the same resolution
   * path, but it returns the decision, the reason, and the bucket the
   * principal hashed to, so an operator can answer "why is this user not in
   * the canary?" without reproducing the hash by hand.
   */
  async evaluate(
    key: string,
    principalId?: string | null,
  ): Promise<FlagEvaluation> {
    const endTimer = this.evalLatency.startTimer();
    try {
      const f = await this.getFlag(key);
      const principal = principalId ?? null;
      const { enabled, reason, bucket } = resolveFlag(f, principal);
      this.evalByReason.inc({ reason });

      const targeting: FlagTargeting = f
        ? readTargeting(f)
        : { rolloutPercentage: null, allowList: [], denyList: [] };

      return {
        key,
        principalId: principal,
        enabled,
        reason,
        bucket,
        rolloutPercentage: targeting.rolloutPercentage,
        allowList: [...targeting.allowList],
        denyList: [...targeting.denyList],
      };
    } finally {
      endTimer();
    }
  }

  /**
   * Create or update a feature flag.
   *
   * - Immediately invalidates the cache entry for `key`.
   * - Persists an immutable audit-log row with actor, previous, and new state.
   * - `targeting` is optional; omitting it leaves any existing rollout and
   *   lists untouched, so an on/off-only caller cannot wipe a live rollout.
   */
  async upsert(
    key: string,
    enabled: boolean,
    conditions?: Record<string, unknown>,
    changedBy?: string,
    targeting?: FlagTargetingInput,
  ) {
    // Snapshot the previous state as primitives BEFORE we fetch the mutable
    // entity.  If we kept a reference to the entity object, mutating
    // f.enabled below would silently change the snapshot too (aliasing).
    const prevFlag = await this.getFlag(key);
    const previousEnabled: boolean | null = prevFlag?.enabled ?? null;
    const previousTargeting = prevFlag
      ? snapshotTargeting(readTargeting(prevFlag))
      : null;

    const next =
      targeting === undefined ? null : sanitizeTargetingInput(targeting);

    let f = await this.repo.findOne({ where: { key } });
    if (!f) {
      f = this.repo.create({
        key,
        enabled,
        conditions: conditions ?? null,
        changedBy: changedBy ?? null,
        // A brand-new flag has no rollout to preserve, so default to none.
        rolloutPercentage: next?.rolloutPercentage ?? null,
        allowList: next?.allowList ?? null,
        denyList: next?.denyList ?? null,
      });
    } else {
      f.enabled = enabled;
      f.conditions = conditions ?? null;
      f.changedBy = changedBy ?? null;
      if (next) {
        f.rolloutPercentage = next.rolloutPercentage;
        f.allowList = next.allowList;
        f.denyList = next.denyList;
      }
    }
    const saved = await this.repo.save(f);

    // Immediate cache invalidation — entry is repopulated with fresh TTL.
    const now = Date.now();
    this.cache.set(saved.key, {
      value: saved,
      expiresAt: now + CACHE_TTL_MS,
    });

    // Persist audit log entry. The targeting snapshot rides along so a
    // rollout change is as reviewable as an on/off change.
    const newTargeting = snapshotTargeting(readTargeting(saved));
    const rolloutAfter = normalizeRolloutPercentage(saved.rolloutPercentage);
    const auditEntry = this.auditRepo.create({
      flagKey: key,
      action: 'upsert',
      previousEnabled,
      newEnabled: enabled,
      previousTargeting,
      newTargeting,
      actor: changedBy ?? null,
    });
    await this.auditRepo.save(auditEntry);

    this.logger.log(
      `Flag "${key}" changed: ${previousEnabled ?? 'N/A'} -> ${enabled}` +
        (changedBy ? ` by ${changedBy}` : '') +
        (rolloutAfter === null ? '' : ` (rollout ${rolloutAfter}%)`),
    );

    return saved;
  }

  /**
   * Delete a feature flag and immediately evict it from the cache.
   * Records a 'remove' audit-log entry, including the targeting that was
   * discarded so a deleted canary stays reviewable.
   */
  async remove(key: string): Promise<void> {
    const prev = await this.getFlag(key);
    const previousTargeting = prev
      ? snapshotTargeting(readTargeting(prev))
      : null;
    await this.repo.delete({ key });
    this.cache.delete(key);

    // Persist audit log entry.
    const auditEntry = this.auditRepo.create({
      flagKey: key,
      action: 'remove',
      previousEnabled: prev?.enabled ?? null,
      newEnabled: null,
      previousTargeting,
      newTargeting: null,
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
