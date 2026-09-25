import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { HealthCheckResult } from '@nestjs/terminus';
import { firstValueFrom } from 'rxjs';
import { DataSource } from 'typeorm';
import { CacheService } from '../cache/cache.service';
import { config } from '../lib/config';
import {
  LatencyBudgetHealthService,
  LatencyBudgetReport,
} from './latency-budget.health.service';

export interface DependencyStatus {
  status: 'up' | 'down';
  latencyMs: number;
  critical: boolean;
  message?: string;
}

export interface LumenpulseHealthReport extends HealthCheckResult {
  summary: 'healthy' | 'degraded' | 'down';
  dependencies: Record<string, DependencyStatus>;
  latencyBudget: LatencyBudgetReport;
}

const CHECK_TIMEOUT_MS = 3000;
const LATENCY_BUDGET_TIMEOUT_MS = 6000;

@Injectable()
export class HealthService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly cacheService: CacheService,
    private readonly httpService: HttpService,
    private readonly latencyBudgetHealthService: LatencyBudgetHealthService,
  ) {}

  async getHealthReport(): Promise<LumenpulseHealthReport> {
    const [database, redis, latencyBudget, coinGecko, exchangeRateApi, python] =
      await Promise.all([
        this.probe('database', true, () => this.dataSource.query('SELECT 1')),
        this.probe('redis', false, () => this.cacheService.checkHealth()),
        this.getLatencyBudget(),
        this.probe('coinGecko', false, () =>
          this.get('https://api.coingecko.com/api/v3/ping'),
        ),
        this.probe('exchangeRateApi', false, () =>
          this.get('https://api.exchangerate-api.com/v4/latest/USD'),
        ),
        this.probe('python', false, () =>
          this.get(config.python.apiUrl.replace(/\/$/, '') + '/health'),
        ),
      ]);

    const fromLatency = (name: string): DependencyStatus => {
      const result = latencyBudget.dependencies.find(
        (entry) => entry.name === name,
      );
      return {
        status:
          result?.state === 'ok' || result?.state === 'degraded'
            ? 'up'
            : 'down',
        latencyMs: result?.latencyMs ?? LATENCY_BUDGET_TIMEOUT_MS,
        critical: true,
        ...(result?.message && { message: result.message }),
      };
    };
    const horizon = fromLatency('horizon');
    const sorobanRpc = fromLatency('sorobanRpc');
    const dependencies = {
      database,
      redis,
      horizon,
      sorobanRpc,
      python,
      coinGecko,
      exchangeRateApi,
    };
    const info: Record<
      string,
      { status: 'up' | 'down'; latencyMs: number; message?: string }
    > = {};
    const error: typeof info = {};
    const details: typeof info = {};
    for (const [name, dependency] of Object.entries(dependencies)) {
      const { status, latencyMs, message } = dependency;
      const value = { status, latencyMs, ...(message && { message }) };
      details[name] = value;
      (status === 'up' ? info : error)[name] = value;
    }
    const externalApis =
      coinGecko.status === 'up' && exchangeRateApi.status === 'up'
        ? {
            status: 'up' as const,
            latencyMs: Math.max(coinGecko.latencyMs, exchangeRateApi.latencyMs),
          }
        : {
            status: 'down' as const,
            latencyMs: Math.max(coinGecko.latencyMs, exchangeRateApi.latencyMs),
            message: 'One or more external APIs are unavailable',
          };
    details.externalApis = externalApis;
    (externalApis.status === 'up' ? info : error).externalApis = externalApis;

    const hardDown = Object.values(dependencies).some(
      (entry) => entry.critical && entry.status === 'down',
    );
    const degraded =
      Object.values(dependencies).some((entry) => entry.status === 'down') ||
      latencyBudget.overallState === 'degraded';
    return {
      status: hardDown ? 'error' : 'ok',
      summary: hardDown ? 'down' : degraded ? 'degraded' : 'healthy',
      dependencies,
      latencyBudget,
      info,
      error,
      details,
    };
  }

  private async probe(
    name: string,
    critical: boolean,
    check: () => Promise<unknown>,
  ): Promise<DependencyStatus> {
    const start = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        Promise.resolve().then(check),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(name + ' timed out')),
            CHECK_TIMEOUT_MS,
          );
        }),
      ]);
      if (result === false) throw new Error(name + ' is unavailable');
      return { status: 'up', latencyMs: Date.now() - start, critical };
    } catch (error) {
      return {
        status: 'down',
        latencyMs: Date.now() - start,
        critical,
        message:
          error instanceof Error ? error.message : name + ' is unavailable',
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async get(url: string): Promise<void> {
    await firstValueFrom(
      this.httpService.get(url, { timeout: CHECK_TIMEOUT_MS }),
    );
  }

  private async getLatencyBudget(): Promise<LatencyBudgetReport> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.latencyBudgetHealthService.getLatencyBudgetReport(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Latency probes timed out')),
            LATENCY_BUDGET_TIMEOUT_MS,
          );
        }),
      ]);
    } catch (error) {
      return {
        overallState: 'hard_down',
        checkedAt: new Date().toISOString(),
        dependencies: ['horizon', 'sorobanRpc'].map((name) => ({
          name,
          url: '',
          latencyMs: LATENCY_BUDGET_TIMEOUT_MS,
          thresholds: { degradedMs: 0, hardDownMs: LATENCY_BUDGET_TIMEOUT_MS },
          state: 'hard_down' as const,
          message:
            error instanceof Error ? error.message : 'Latency probes failed',
        })),
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
