import {
  Controller,
  Get,
  UseGuards,
  Res,
  Logger,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { AiMetricsService } from './ai-metrics.service';
import { IpAllowlistGuard } from '../metrics/ip-allowlist.guard';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiProduces,
} from '@nestjs/swagger';

/**
 * Controller that exposes the AI-layer health & performance metrics.
 *
 * Endpoints:
 *  GET /ai/metrics          — full JSON health report (resource usage, throttling, model stats)
 *  GET /ai/metrics/prometheus — Prometheus-format text for scraping
 *  GET /ai/metrics/health   — lightweight liveness / readiness check
 */
@ApiTags('ai-metrics')
@Controller('ai/metrics')
@UseGuards(IpAllowlistGuard)
export class AiMetricsController {
  private readonly logger = new Logger(AiMetricsController.name);

  constructor(private readonly aiMetricsService: AiMetricsService) {}

  /**
   * GET /ai/metrics
   * Returns a comprehensive JSON health report including:
   * - System status (healthy / degraded / critical)
   * - Resource usage (RAM, heap, VRAM)
   * - Throttling state & reason
   * - Model load times
   * - Request & error counters
   */
  @Get()
  @ApiOperation({
    summary: 'Get AI-layer health & performance metrics',
    description:
      'Returns a comprehensive JSON report of the AI subsystem health, ' +
      'including resource utilisation, throttling state, loaded models, and counters.',
  })
  @ApiResponse({
    status: 200,
    description: 'AI health report in JSON',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden — IP not in allowlist and no valid JWT',
  })
  getAiMetrics(@Res() response: Response): void {
    try {
      const report = this.aiMetricsService.getHealthReport();
      response.status(HttpStatus.OK).json(report);
    } catch (error) {
      this.logger.error('Error building AI health report:', error);
      response
        .status(HttpStatus.INTERNAL_SERVER_ERROR)
        .json({ error: 'Failed to retrieve AI metrics' });
    }
  }

  /**
   * GET /ai/metrics/prometheus
   * Returns AI-specific metrics in Prometheus text format.
   */
  @Get('prometheus')
  @ApiOperation({
    summary: 'Get AI metrics in Prometheus format',
    description:
      'Returns AI inference, model-load, and resource metrics in Prometheus text format for scraping.',
  })
  @ApiProduces('text/plain')
  @ApiResponse({
    status: 200,
    description: 'Prometheus-format metrics',
  })
  async getPrometheusMetrics(@Res() response: Response): Promise<void> {
    try {
      const metrics = await this.aiMetricsService.getPrometheusMetrics();
      response.set(
        'Content-Type',
        'text/plain; version=0.0.4; charset=utf-8',
      );
      response.send(metrics);
    } catch (error) {
      this.logger.error('Error getting Prometheus AI metrics:', error);
      response
        .status(HttpStatus.INTERNAL_SERVER_ERROR)
        .json({ error: 'Failed to retrieve Prometheus metrics' });
    }
  }

  /**
   * GET /ai/metrics/health
   * Lightweight liveness/readiness check for the AI subsystem.
   * Returns 200 when healthy/degraded, 503 when the system should be throttled.
   */
  @Get('health')
  @ApiOperation({
    summary: 'AI subsystem health check',
    description:
      'Returns 200 when the AI layer is operational, 503 when it is under resource pressure and throttling.',
  })
  @ApiResponse({ status: 200, description: 'AI layer is healthy or degraded' })
  @ApiResponse({
    status: 503,
    description: 'AI layer is in a critical state and throttling requests',
  })
  getAiHealth(@Res() response: Response): void {
    const report = this.aiMetricsService.getHealthReport();
    const statusCode =
      report.status === 'critical'
        ? HttpStatus.SERVICE_UNAVAILABLE
        : HttpStatus.OK;
    response.status(statusCode).json({
      status: report.status,
      timestamp: report.timestamp,
      uptime: report.uptime,
      throttling: report.throttling,
    });
  }
}
