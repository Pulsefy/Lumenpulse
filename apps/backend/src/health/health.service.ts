import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  HealthCheckResult,
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { DataSource } from 'typeorm';
import { firstValueFrom } from 'rxjs';
import { CacheService } from '../cache/cache.service';
import { StellarService } from '../stellar/stellar.service';

interface DependencyCheckResult {
  name: string;
  result: HealthIndicatorResult;
  isUp: boolean;
}

interface ExternalDependencyStatus {
  status: 'up' | 'down';
  responseTimeMs?: number;
  message?: string;
}

type HealthPayload = {
  status: 'up' | 'down';
  [key: string]: unknown;
};

export interface LumenpulseHealthReport extends HealthCheckResult {
  summary: 'healthy' | 'degraded' | 'down';
}

@Injectable()
export class HealthService {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly cacheService: CacheService,
    private readonly stellarService: StellarService,
    private readonly httpService: HttpService,
  ) {}

  async getHealthReport(): Promise<LumenpulseHealthReport> {
    const database = await this.checkDatabase();
    const dependencyChecks = await Promise.all([
      this.checkRedis(),
      this.checkHorizon(),
      this.checkExternalApis(),
    ]);

    const checks = [database, ...dependencyChecks];
    const info: Record<string, HealthPayload> = {};
    const error: Record<string, HealthPayload> = {};
    const details: Record<string, HealthPayload> = {};

    for (const check of checks) {
      const payload = check.result[check.name];
      details[check.name] = payload;

      if (check.isUp) {
        info[check.name] = payload;
      } else {
        error[check.name] = payload;
      }
    }

    const status = database.isUp ? 'ok' : 'error';
    const summary =
      status === 'error'
        ? 'down'
        : Object.keys(error).length > 0
          ? 'degraded'
          : 'healthy';

    return {
      status,
      summary,
      info,
      error,
      details,
    };
  }

  private async checkDatabase(): Promise<DependencyCheckResult> {
    const indicator = this.healthIndicatorService.check('database');

    try {
      await this.dataSource.query('SELECT 1');

      return {
        name: 'database',
        result: indicator.up(),
        isUp: true,
      };
    } catch (error) {
      return {
        name: 'database',
        result: indicator.down({
          message: this.getErrorMessage(error, 'Database is unavailable'),
        }),
        isUp: false,
      };
    }
  }

  private async checkRedis(): Promise<DependencyCheckResult> {
    const indicator = this.healthIndicatorService.check('redis');
    const isHealthy = await this.cacheService.checkHealth();

    return {
      name: 'redis',
      result: isHealthy
        ? indicator.up()
        : indicator.down({
            message: 'Redis cache is unavailable',
          }),
      isUp: isHealthy,
    };
  }

  private async checkHorizon(): Promise<DependencyCheckResult> {
    const indicator = this.healthIndicatorService.check('horizon');
    const isHealthy = await this.stellarService.checkHealth();

    return {
      name: 'horizon',
      result: isHealthy
        ? indicator.up()
        : indicator.down({
            message: 'Stellar Horizon is unavailable',
          }),
      isUp: isHealthy,
    };
  }

  private async checkExternalApis(): Promise<DependencyCheckResult> {
    const indicator = this.healthIndicatorService.check('externalApis');
    const [coinGecko, exchangeRateApi] = await Promise.all([
      this.checkExternalEndpoint('https://api.coingecko.com/api/v3/ping'),
      this.checkExternalEndpoint(
        'https://api.exchangerate-api.com/v4/latest/USD',
      ),
    ]);
    const dependencies = { coinGecko, exchangeRateApi };

    const failedDependencies = Object.entries(dependencies)
      .filter(([, dependency]) => dependency.status === 'down')
      .map(([name, dependency]) => ({
        name,
        message: dependency.message ?? 'Dependency is unavailable',
      }));

    return {
      name: 'externalApis',
      result:
        failedDependencies.length === 0
          ? indicator.up({ dependencies })
          : indicator.down({
              dependencies,
              message: 'One or more external APIs are unavailable',
              failedDependencies,
            }),
      isUp: failedDependencies.length === 0,
    };
  }

  private async checkExternalEndpoint(
    url: string,
  ): Promise<ExternalDependencyStatus> {
    const startedAt = Date.now();

    try {
      await firstValueFrom(
        this.httpService.get(url, {
          timeout: 3000,
          headers: {
            Accept: 'application/json',
          },
        }),
      );

      return {
        status: 'up',
        responseTimeMs: Date.now() - startedAt,
      };
    } catch (error) {
      return {
        status: 'down',
        message: this.getErrorMessage(error, 'Request failed'),
      };
    }
  }

  private getErrorMessage(error: unknown, fallbackMessage: string): string {
    if (error instanceof Error) {
      return error.message;
    }

    return fallbackMessage;
  }
}
