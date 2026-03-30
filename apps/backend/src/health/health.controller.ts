import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { HealthService } from './health.service';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private healthService: HealthService) {}

  /**
   * Main health endpoint with graceful degradation.
   * 
   * Returns 200 OK if the critical service (database) is up.
   * Returns 503 only if the database is down.
   * Non-critical services (Redis, Horizon) are monitored but their status
   * doesn't affect the HTTP response code.
   */
  @Get()
  @ApiOperation({ summary: 'Service health status with dependency monitoring' })
  @ApiResponse({
    status: 200,
    description: 'Service is healthy or operational with degraded features',
    schema: {
      example: {
        status: 'ok',
        timestamp: '2026-03-30T12:00:00Z',
        checks: {
          database: { status: 'up', message: null },
          redis: { status: 'up', message: null },
          horizon: { status: 'down', message: 'Connection timeout' },
        },
      },
    },
  })
  @ApiResponse({
    status: 503,
    description: 'Critical service (database) is down',
  })
  async check() {
    const dbResult = await this.healthService.checkDatabase();
    const redisResult = await this.healthService.checkRedisGraceful();
    const horizonResult = await this.healthService.checkHorizonGraceful();

    const allChecks = {
      database: dbResult,
      redis: redisResult,
      horizon: horizonResult,
    };

    // Critical service check - only database failure causes 503
    const databaseStatus = dbResult.database?.status || 'down';
    const isHealthy = databaseStatus === 'up';

    const response = {
      status: isHealthy ? 'ok' : 'critical',
      timestamp: new Date().toISOString(),
      checks: this.formatChecks(allChecks),
    };

    // Return appropriate status code based on critical service health
    if (!isHealthy) {
      throw new HttpException(
        {
          status: 'critical',
          message: 'Service Unavailable: Critical service down',
          checks: response.checks,
          timestamp: response.timestamp,
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    return response;
  }

  /**
   * Detailed health check endpoint showing all dependencies
   */
  @Get('detailed')
  @ApiOperation({ summary: 'Detailed health check of all dependencies' })
  @ApiResponse({
    status: 200,
    description: 'Detailed status of all dependencies',
  })
  async detailed() {
    const [dbResult, redisResult, horizonResult] = await Promise.all([
      this.healthService.checkDatabase(),
      this.healthService.checkRedis(),
      this.healthService.checkHorizon(),
    ]);

    return {
      timestamp: new Date().toISOString(),
      services: {
        database: dbResult.database,
        redis: redisResult.redis,
        horizon: horizonResult.horizon,
      },
    };
  }

  /**
   * Simple readiness probe endpoint
   * Returns 200 if database is accessible, else 503
   */
  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe - checks critical services only' })
  @ApiResponse({
    status: 200,
    description: 'Service is ready to handle requests',
  })
  @ApiResponse({
    status: 503,
    description: 'Service is not ready',
  })
  async ready() {
    const dbResult = await this.healthService.checkDatabase();
    const databaseStatus = dbResult.database?.status || 'down';
    const isReady = databaseStatus === 'up';

    if (!isReady) {
      throw new HttpException(
        {
          status: 'not_ready',
          message: 'Service not ready: database unavailable',
          timestamp: new Date().toISOString(),
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    return {
      status: 'ready',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Format health check results for response
   */
  private formatChecks(
    checks: Record<string, Record<string, any>>,
  ): Record<string, { status: string; message: string | null }> {
    const formatted: Record<string, { status: string; message: string | null }> =
      {};

    for (const [service, result] of Object.entries(checks)) {
      const serviceResult = result[service];
      formatted[service] = {
        status: serviceResult?.status === 'up' ? 'up' : 'down',
        message: serviceResult?.message || null,
      };
    }

    return formatted;
  }
}

