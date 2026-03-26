import { Controller, Get, UseGuards, Res, Query, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { MetricsService } from './metrics.service';
import { IpAllowlistGuard } from './ip-allowlist.guard';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

/**
 * Controller for exposing application metrics
 * Provides Prometheus-compatible metrics endpoint
 */
@ApiTags('metrics')
@Controller('metrics')
@UseGuards(IpAllowlistGuard)
export class MetricsController {
  private readonly logger = new Logger(MetricsController.name);

  constructor(private metricsService: MetricsService) {}

  /**
   * Get metrics in Prometheus text format
   * This is the standard endpoint for Prometheus scraping
   *
   * Access: Protected by IP allowlist or JWT authentication
   *
   * @example
   * curl http://localhost:3000/metrics
   * # HELP http_requests_total Total number of HTTP requests
   * # TYPE http_requests_total counter
   * http_requests_total{method="GET",route="/api/users",status="200"} 42
   */
  @Get()
  @ApiOperation({
    summary: 'Get application metrics in Prometheus format',
    description:
      'Returns metrics in Prometheus text format for scraping by monitoring tools like Prometheus',
  })
  @ApiResponse({
    status: 200,
    description: 'Metrics in Prometheus format (text/plain; version=0.0.4)',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - IP not in allowlist and no valid JWT',
  })
  async getMetrics(
    @Res() response: Response,
    @Query('format') format: 'prometheus' | 'json' = 'prometheus',
  ): Promise<void> {
    try {
      if (format === 'json') {
        const metricsJson = this.metricsService.getMetricsAsJson();
        response.json(metricsJson);
      } else {
        // Default: Prometheus format
        const metrics = await this.metricsService.getMetrics();
        response.set(
          'Content-Type',
          'text/plain; version=0.0.4; charset=utf-8',
        );
        response.send(metrics);
      }
    } catch (error) {
      this.logger.error('Error getting metrics:', error);
      response.status(500).json({ error: 'Failed to retrieve metrics' });
    }
  }

  /**
   * Get metrics in JSON format
   * Useful for custom monitoring dashboards
   *
   * Access: Protected by IP allowlist or JWT authentication
   *
   * @example
   * curl http://localhost:3000/metrics/json
   * { "http_requests_total": { ... }, ... }
   */
  @Get('json')
  @ApiOperation({
    summary: 'Get application metrics in JSON format',
    description: 'Returns metrics as JSON for custom integrations',
  })
  @ApiResponse({
    status: 200,
    description: 'Metrics in JSON format',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - IP not in allowlist and no valid JWT',
  })
  getMetricsJson(@Res() response: Response): void {
    try {
      const metricsJson = this.metricsService.getMetricsAsJson();
      response.json(metricsJson);
    } catch (error) {
      this.logger.error('Error getting metrics:', error);
      response.status(500).json({ error: 'Failed to retrieve metrics' });
    }
  }

  /**
   * Health check endpoint (unprotected info)
   * Returns basic health status of the application
   *
   * @example
   * curl http://localhost:3000/health
   * { "status": "ok", "timestamp": "2024-02-25T..." }
   */
  @Get('health')
  @ApiOperation({
    summary: 'Get health status',
    description: 'Returns the health status of the application',
  })
  @ApiResponse({
    status: 200,
    description: 'Health status',
  })
  getHealth(): Record<string, unknown> {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }
}
