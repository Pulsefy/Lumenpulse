import { Module, Global } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { MetricsController } from './metrics.controller';
import { MetricsInterceptor } from './metrics.interceptor';
import { APP_INTERCEPTOR } from '@nestjs/core';

/**
 * Metrics Module
 *
 * Provides application metrics collection and exposure for monitoring tools
 * Includes:
 * - HTTP request metrics (count, latency, errors)
 * - Job queue metrics
 * - Prometheus-formatted metrics endpoint
 * - Health check endpoint
 *
 * Environment Variables:
 * - METRICS_ALLOWED_IPS: Comma-separated list of allowed IPs (e.g., "127.0.0.1,192.168.1.0/24")
 *   If not set, falls back to JWT authentication
 */
@Global()
@Module({
  providers: [
    MetricsService,
    {
      provide: APP_INTERCEPTOR,
      useClass: MetricsInterceptor,
    },
  ],
  controllers: [MetricsController],
  exports: [MetricsService],
})
export class MetricsModule {}
