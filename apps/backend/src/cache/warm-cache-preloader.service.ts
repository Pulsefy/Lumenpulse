import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CacheService } from './cache.service';
import {
  WarmCacheRegistry,
  WarmCacheReport,
  PreloadResult,
} from './warm-cache.registry';
import { MetricsService } from '../metrics/metrics.service';

// Prometheus metric names
const METRIC_PRELOAD_RUNS = 'warm_cache_preload_runs_total';
const METRIC_PRELOAD_SUCCESS = 'warm_cache_preload_success_total';
const METRIC_PRELOAD_FAILURE = 'warm_cache_preload_failure_total';
const METRIC_PRELOAD_DURATION = 'warm_cache_preload_duration_ms';
const METRIC_PRELOAD_SKIPPED = 'warm_cache_preload_skipped_total';

/**
 * WarmCachePreloaderService
 *
 * Runs on a configurable schedule (default: every 5 minutes) and pre-populates
 * selected hot cache keys so that first-user latency remains low on testnet.
 *
 * Acceptance criteria coverage:
 *  ✔ Preloads selected routes/queries on a schedule (@Cron).
 *  ✔ Supports manual refresh via `forceRefresh()` (exposed by controller).
 *  ✔ Skips preloading when dependencies (Redis health) are unhealthy.
 *  ✔ Produces structured cache-refresh logs and Prometheus metrics.
 */
@Injectable()
export class WarmCachePreloaderService {
  private readonly logger = new Logger(WarmCachePreloaderService.name);

  /** ISO timestamp of the last completed refresh cycle, or null if never run. */
  private lastRunAt: string | null = null;

  /** Most recent report, kept in memory for the status endpoint. */
  private lastReport: WarmCacheReport | null = null;

  /** Whether a preload cycle is currently in progress (guards re-entrancy). */
  private running = false;

  constructor(
    private readonly cacheService: CacheService,
    private readonly registry: WarmCacheRegistry,
    @Optional() private readonly metricsService?: MetricsService,
  ) {}

  // ── Scheduled preload ──────────────────────────────────────────────────────

  /**
   * Scheduled warm-cache refresh — runs every 5 minutes.
   *
   * The interval is intentionally conservative so that transient testnet RPC
   * blips do not thrash the preloader.  Adjust via `WARM_CACHE_CRON` env var
   * if you mount a custom schedule factory.
   */
  @Cron(process.env['WARM_CACHE_CRON'] ?? CronExpression.EVERY_5_MINUTES, {
    name: 'warm-cache-preload',
  })
  async scheduledPreload(): Promise<void> {
    this.logger.log('Scheduled warm-cache preload triggered.');
    await this.runPreload('scheduled');
  }

  // ── Manual / programmatic refresh ─────────────────────────────────────────

  /**
   * Immediately warm all registered cache routes.
   * Called by the admin controller endpoint `POST /cache/warm`.
   *
   * @param requestedBy  Identifier of the maintainer who triggered the refresh.
   */
  async forceRefresh(requestedBy = 'unknown'): Promise<WarmCacheReport> {
    this.logger.log(`Manual warm-cache refresh requested by "${requestedBy}".`);
    return this.runPreload('manual', requestedBy);
  }

  /**
   * Return the last completed refresh report without running a new cycle.
   */
  getLastReport(): WarmCacheReport | null {
    return this.lastReport;
  }

  getLastRunAt(): string | null {
    return this.lastRunAt;
  }

  // ── Core preload loop ──────────────────────────────────────────────────────

  private async runPreload(
    trigger: 'scheduled' | 'manual',
    triggeredBy?: string,
  ): Promise<WarmCacheReport> {
    if (this.running) {
      this.logger.warn(
        'Warm-cache preload skipped — a previous cycle is still running.',
      );
      return this.buildSkipReport('in-progress');
    }

    this.running = true;
    const cycleStart = Date.now();
    this.incrementCounter(METRIC_PRELOAD_RUNS, { trigger });

    // ── Dependency health check ─────────────────────────────────────────────
    const isHealthy = await this.cacheService.checkHealth();
    if (!isHealthy) {
      this.running = false;
      const skipped = this.registry.getAll().length;
      this.logger.warn(
        `Warm-cache preload SKIPPED — Redis health check failed. ${skipped} route(s) not preloaded.`,
      );
      this.incrementCounter(METRIC_PRELOAD_SKIPPED, {
        reason: 'unhealthy',
        trigger,
      });
      return this.buildSkipReport('unhealthy-dependency', skipped);
    }

    // ── Route preload loop ──────────────────────────────────────────────────
    const routes = this.registry.getAll();
    if (routes.length === 0) {
      this.logger.warn(
        'Warm-cache preload: no routes registered. Register routes via WarmCacheRegistry.',
      );
    }

    const results: PreloadResult[] = [];

    for (const route of routes) {
      const routeStart = Date.now();
      let success = false;
      let errorMsg: string | undefined;

      try {
        const value = await route.loader();
        await this.cacheService.set(route.cacheKey, value, route.ttlMs);
        success = true;
        this.incrementCounter(METRIC_PRELOAD_SUCCESS, { route: route.name });
        this.logger.log(
          `[warm-cache] ✓ "${route.name}" preloaded → key="${route.cacheKey}" ttl=${route.ttlMs}ms`,
        );
      } catch (err) {
        errorMsg = err instanceof Error ? err.message : String(err);
        this.incrementCounter(METRIC_PRELOAD_FAILURE, { route: route.name });
        this.logger.error(
          `[warm-cache] ✗ "${route.name}" failed: ${errorMsg}`,
          err instanceof Error ? err.stack : undefined,
        );
      }

      const durationMs = Date.now() - routeStart;
      this.recordHistogram(METRIC_PRELOAD_DURATION, durationMs, {
        route: route.name,
        success: String(success),
      });

      results.push({
        route: route.name,
        cacheKey: route.cacheKey,
        success,
        durationMs,
        ...(errorMsg ? { error: errorMsg } : {}),
      });
    }

    const totalDuration = Date.now() - cycleStart;
    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    const report: WarmCacheReport = {
      triggeredAt: new Date().toISOString(),
      totalRoutes: routes.length,
      succeeded,
      failed,
      skipped: 0,
      durationMs: totalDuration,
      results,
    };

    this.lastReport = report;
    this.lastRunAt = report.triggeredAt;
    this.running = false;

    this.logger.log(
      `[warm-cache] Cycle complete — trigger=${trigger}` +
        (triggeredBy ? ` by="${triggeredBy}"` : '') +
        ` succeeded=${succeeded} failed=${failed} duration=${totalDuration}ms`,
    );

    return report;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private buildSkipReport(reason: string, skippedCount = 0): WarmCacheReport {
    return {
      triggeredAt: new Date().toISOString(),
      totalRoutes: skippedCount,
      succeeded: 0,
      failed: 0,
      skipped: skippedCount,
      durationMs: 0,
      results: [],
    };
  }

  private incrementCounter(
    name: string,
    labels: Record<string, string> = {},
  ): void {
    if (!this.metricsService) return;
    try {
      this.metricsService.incrementCounter(name, labels);
    } catch {
      // Metrics failures must never break the preload path.
    }
  }

  private recordHistogram(
    name: string,
    value: number,
    labels: Record<string, string> = {},
  ): void {
    if (!this.metricsService) return;
    try {
      this.metricsService.recordHistogram(name, value, labels);
    } catch {
      // Metrics failures must never break the preload path.
    }
  }
}
