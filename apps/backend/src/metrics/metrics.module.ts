import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { MetricsInterceptor } from './metrics.interceptor';

/**
 * MetricsModule  (@Global)
 *
 * Provides:
 *   - MetricsService          — unified Prometheus registry
 *   - MetricsInterceptor      — automatic per-request HTTP metrics
 *   - MetricsController       — /metrics scrape endpoint
 *
 * Exports MetricsService so any module can inject it for custom
 * pipeline instrumentation without re-importing MetricsModule.
 *
 * Register once in AppModule:
 *   @Module({ imports: [MetricsModule] })
 *   export class AppModule {}
 *
 * Environment variables:
 *   METRICS_ALLOWED_IPS  Comma-separated IPs / CIDR blocks allowed to scrape.
 *                        Falls back to Bearer JWT if unset.
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