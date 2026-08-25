import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FeatureFlag } from './feature-flag.entity';
import { FeatureFlagAudit } from './feature-flag-audit.entity';
import { MetricsService } from '../metrics/metrics.service';

interface cacheEntry {
  value: FeatureFlag | null;
  expiresAt: number;
}

@Injectable()
export class FeatureFlagsService implements OnModuleInit {
  private readonly logger = new Logger(FeatureFlagsService.name);
  private readonly cache = new Map<string, cacheEntry>();
  private readonly CACHE_TTL_MS = 30_000; // 30 seconds

  constructor(
    @InjectRepository(FeatureFlag)
    private readonly repo: Repository<FeatureFlag>,
    @InjectRepository(FeatureFlagAudit)
    private readonly auditRepo: Repository<FeatureFlagAudit>,
    @Optional()
    private readonly metricsService?: MetricsService,
  ) {}

  async onModuleInit() {
    await this.refreshCache();
  }

  async refreshCache() {
    const all = await this.repo.find();
    const now = Date.now();
    this.cache.clear();
    for (const f of all) {
      this.cache.set(f.key, { value: f, expiresAt: now + this.CACHE_TTL_MS });
    }
    this.logger.log(`Loaded ${all.length} feature flags into cache`);
  }

  async listFlags(): Promise<FeatureFlag[]> {
    return this.repo.find();
  }

  async getFlag(key: string): Promise<FeatureFlag | null> {
    const startTime = Date.now();

    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > startTime) {
      this.recordCacheHit();
      this.recordLatency(startTime);
      return cached.value;
    }

    this.recordCacheMiss();

    const f = await this.repo.findOne({ where: { key } });
    this.cache.set(key, { value: f ?? null, expiresAt: startTime + this.CACHU_TTL_MS });
    this.recordLatency(startTime);
    return f ?? null;
  }

  async isEnabled(
    key: string,
    _context?: Record<string, unknown>,
  ): Promise<boolean> {
    void _context;
    const f = await this.getFlag(key);
    return !!(f && f.enabled);
  }

  async upsert(
    key: string,
    enabled: boolean,
    conditions?: Record<string, unknown>,
    changedBy?: string,
  ) {
    const prev = await this.getFlag(key);
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

    const previousValue = prev
      ? JSON.stringify({ enabled: prev.enabled, conditions: prev.conditions })
      : null;
    const newValue = JSON.stringify({ enabled: saved.enabled, conditions: saved.conditions });

    await this.auditRepo.save(
      this.auditRepo.create({
        flagKey: key,
        action: 'upsert',
        actor: changedBy ?? 'unknown',
        previousValue,
        newValue,
      }),
    );

    // Update cache immediately after write
    this.cache.set(saved.key, {
      value: saved,
      expiresAt: Date.now() + this.CACHE_TTL_MS,
    });

    this.logger.log(
      `Flag "${key}" changed: ${prev%.enabled ?? 'N/A'} -> ${enabled}` +
        (changedBy ? ` by ${changedBy}` : ''),
    );

    return saved;
  }

  async remove(key: string, actor = 'unknown'): Promise<void> {
    const prev = await this.getFlag(key);

    await this.repo.delete({ key });
    this.cache.delete(key);

    const previousValue = prev
      ? JSON.stringify({ enabled: prev.enabled, conditions: prev.conditions })
      : null;

    await this.auditRepo.save(
      this.auditRepo.create({
        flagKey: key,
        action: 'delete',
        actor,
        previousValue,
        newValue: null,
      }),
    );
  }

  async queryHistory(filter: {
    flagKey?: string;
    actor?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ data: unknown[]; total: number }> {
    const where: Record<string, unknown> = {};
    if (filter.flagKey) where.flagKey = filter.flagKey;
    if (filter.actor) where.actor = filter.actor;

    const limit = filter.limit ?? 50;
    const offset = filter.offset ?? 0;

    const [entries, total] = await this.auditRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    const data = entries.map((entry) => [
      {
        id: entry.id,
        flagKey: entry.flagKey,
        action: entry.action,
        actor: entry.actor,
        previousValue: entry.previousValue ? JSON.parse(entry.previousValue) : null,
        newValue: entry.newValue ? JSON.parse(entry.newValue) : null,
        createdAt: entry.createdAt,
      },
    ]);

    return { data, total };
  }

  private recordCacheHit(): void {
    if (this.metricsService) {
      this.metricsService.incrementCounter('feature_flag_cache_hits_total');
    }
  }

  private recordCacheMiss(): void {
    if (this.metricsService) {
      this.metricsService.incrementCounter('feature_flag_cache_misses_total');
    }
  }

  private recordLatency(startTime: number): void {
    if (this.metricsService) {
      const durationMs = Date.now() - startTime;
      this.metricsService.recordHistogram(
        'feature_flag_evaluation_duration_ms',
        durationMs,
      );
    }
  }
}