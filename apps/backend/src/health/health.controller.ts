import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { HealthService } from './health.service';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private healthService: HealthService,
  ) {}

  /**
   * Health check endpoint with graceful degradation.
   * 
   * Returns 200 OK if:
   * - Database is up (critical)
   * - At least monitoring the other services
   * 
   * Returns 503 Service Unavailable only if:
   * - Database is down (critical service)
   * 
   * Non-critical services (Redis, Horizon) are monitored but don't affect
   * the overall health status. The API remains operational if they fail.
   */
  @Get()
  @HealthCheck()
  @ApiOperation({ summary: 'Service health check with dependency status' })
  @ApiResponse({
    status: 200,
    description: 'Service is healthy (or degraded but operational)',
    schema: {
      example: {
        status: 'ok',
        info: {
          database: { status: 'up' },
          redis: { status: 'up' },
          horizon: { status: 'up' },
        },
      },
    },
  })
  @ApiResponse({
    status: 503,
    description: 'Critical service (database) is down - service unavailable',
  })
  async check() {
    // Only the database check is critical - it must pass for the service to be "up"
    // Redis and Horizon are non-critical and won't cause overall failure
    return this.health.check([
      () => this.healthService.checkDatabase(), // Critical
      // Wrap non-critical checks to prevent failure propagation
      () => this.healthService.checkRedisGraceful(),
      () => this.healthService.checkHorizonGraceful(),
    ]);
  }
}

