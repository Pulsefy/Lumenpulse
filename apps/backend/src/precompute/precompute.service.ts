import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { CacheService, NEWS_CACHE_KEY } from '../cache/cache.service';
import { HealthService } from '../health/health.service';
import { MetricsService } from '../metrics/metrics.service';
import { NewsProviderService } from '../news/news-provider.service';
import { PortfolioService } from '../portfolio/portfolio.service';

interface PrecomputeTask {
  name: string;
  key: string;
  execute: () => Promise<unknown>;
  ttl: number;
  dependencies: string[];
}

interface PrecomputeResult {
  task: string;
  success: boolean;
  durationMs: number;
  cached: boolean;
  error?: string;
  skipped?: boolean;
  skipReason?: string;
}

@Injectable()
export class PrecomputeService {
  private readonly logger = new Logger(PrecomputeService.name);
  private readonly precomputeTasks: PrecomputeTask[] = [];
  private isPrecomputing = false;

  constructor(
    private readonly httpService: HttpService,
    private readonly cacheService: CacheService,
    private readonly healthService: HealthService,
    private readonly metricsService: MetricsService,
    private readonly newsProviderService: NewsProviderService,
    private readonly portfolioService: PortfolioService,
  ) {
    this.initializeTasks();
  }

  private initializeTasks(): void {
    this.precomputeTasks = [
      {
        name: 'latest-news',
        key: NEWS_CACHE_KEY,
        execute: () =>
          this.newsProviderService.getLatestArticles({ limit: 20, lang: 'EN' }),
        ttl: 300000, // 5 minutes
        dependencies: ['redis', 'externalApis'],
      },
      {
        name: 'news-categories',
        key: 'precompute:news:categories',
        execute: () => this.newsProviderService.getCategories({ status: 'ACTIVE' }),
        ttl: 600000, // 10 minutes
        dependencies: ['redis', 'externalApis'],
      },
      {
        name: 'stellar-assets',
        key: 'precompute:stellar:assets',
        execute: () => this.fetchStellarAssets(),
        ttl: 300000, // 5 minutes
        dependencies: ['redis', 'horizon'],
      },
    ];

    this.logger.log(`Initialized ${this.precomputeTasks.length} precompute tasks`);
  }

  private async fetchStellarAssets(): Promise<unknown> {
    try {
      const stellarNetwork = process.env.STELLAR_NETWORK || 'testnet';
      const horizonUrl =
        stellarNetwork === 'mainnet'
          ? 'https://horizon.stellar.org'
          : 'https://horizon-testnet.stellar.org';

      const response = await firstValueFrom(
        this.httpService.get(`${horizonUrl}/assets?limit=20`, {
          timeout: 5000,
        }),
      );

      return response.data;
    } catch (error) {
      this.logger.error(`Failed to fetch Stellar assets: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async scheduledPrecompute(): Promise<void> {
    this.logger.log('Starting scheduled precompute');
    await this.precomputeAll();
  }

  async precomputeAll(): Promise<PrecomputeResult[]> {
    if (this.isPrecomputing) {
      this.logger.warn('Precompute already in progress, skipping');
      return [];
    }

    this.isPrecomputing = true;
    const startTime = Date.now();
    const results: PrecomputeResult[] = [];

    try {
      const healthReport = await this.healthService.getHealthReport();
      const unhealthyDependencies = this.getUnhealthyDependencies(healthReport);

      for (const task of this.precomputeTasks) {
        const taskStartTime = Date.now();
        const result: PrecomputeResult = {
          task: task.name,
          success: false,
          durationMs: 0,
          cached: false,
        };

        try {
          // Check if dependencies are healthy
          const hasUnhealthyDependency = task.dependencies.some((dep) =>
            unhealthyDependencies.includes(dep),
          );

          if (hasUnhealthyDependency) {
            result.skipped = true;
            result.skipReason = `Unhealthy dependencies: ${task.dependencies.filter((dep) => unhealthyDependencies.includes(dep)).join(', ')}`;
            result.durationMs = Date.now() - taskStartTime;
            this.logger.warn(`Skipping task '${task.name}': ${result.skipReason}`);
            results.push(result);
            continue;
          }

          // Execute the precompute task
          const data = await task.execute();
          await this.cacheService.set(task.key, data, task.ttl);

          result.success = true;
          result.cached = true;
          result.durationMs = Date.now() - taskStartTime;

          this.logger.debug(`Precomputed '${task.name}' in ${result.durationMs}ms`);
        } catch (error) {
          result.success = false;
          result.error = error instanceof Error ? error.message : 'Unknown error';
          result.durationMs = Date.now() - taskStartTime;
          this.logger.error(`Failed to precompute '${task.name}': ${result.error}`);
        }

        results.push(result);
      }

      const totalDuration = Date.now() - startTime;
      const successCount = results.filter((r) => r.success).length;
      const skippedCount = results.filter((r) => r.skipped).length;

      this.logger.log(
        `Precompute completed: ${successCount}/${results.length} successful, ${skippedCount} skipped, ${totalDuration}ms`,
      );

      // Record metrics
      this.recordPrecomputeMetrics(results, totalDuration);
    } catch (error) {
      this.logger.error(`Precompute failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      this.isPrecomputing = false;
    }

    return results;
  }

  async precomputeSpecific(taskName: string): Promise<PrecomputeResult> {
    const task = this.precomputeTasks.find((t) => t.name === taskName);

    if (!task) {
      throw new Error(`Precompute task '${taskName}' not found`);
    }

    const startTime = Date.now();
    const result: PrecomputeResult = {
      task: task.name,
      success: false,
      durationMs: 0,
      cached: false,
    };

    try {
      const healthReport = await this.healthService.getHealthReport();
      const unhealthyDependencies = this.getUnhealthyDependencies(healthReport);

      const hasUnhealthyDependency = task.dependencies.some((dep) =>
        unhealthyDependencies.includes(dep),
      );

      if (hasUnhealthyDependency) {
        result.skipped = true;
        result.skipReason = `Unhealthy dependencies: ${task.dependencies.filter((dep) => unhealthyDependencies.includes(dep)).join(', ')}`;
        result.durationMs = Date.now() - startTime;
        this.logger.warn(`Skipping task '${task.name}': ${result.skipReason}`);
        return result;
      }

      const data = await task.execute();
      await this.cacheService.set(task.key, data, task.ttl);

      result.success = true;
      result.cached = true;
      result.durationMs = Date.now() - startTime;

      this.logger.log(`Manually precomputed '${task.name}' in ${result.durationMs}ms`);

      // Record metrics
      this.metricsService.recordPrecomputeTask(task.name, result.success, result.durationMs, result.skipped);
    } catch (error) {
      result.success = false;
      result.error = error instanceof Error ? error.message : 'Unknown error';
      result.durationMs = Date.now() - startTime;
      this.logger.error(`Failed to manually precompute '${task.name}': ${result.error}`);
      this.metricsService.recordPrecomputeTask(task.name, result.success, result.durationMs, result.skipped);
    }

    return result;
  }

  getAvailableTasks(): string[] {
    return this.precomputeTasks.map((t) => t.name);
  }

  isPrecomputingActive(): boolean {
    return this.isPrecomputing;
  }

  private getUnhealthyDependencies(healthReport: { error?: Record<string, unknown> }): string[] {
    if (!healthReport.error) {
      return [];
    }

    return Object.keys(healthReport.error);
  }

  private recordPrecomputeMetrics(results: PrecomputeResult[], totalDuration: number): void {
    for (const result of results) {
      this.metricsService.recordPrecomputeTask(
        result.task,
        result.success,
        result.durationMs,
        result.skipped,
      );
    }

    this.metricsService.recordPrecomputeBatch(results.length, totalDuration);
  }
}
