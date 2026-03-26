import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiMetricsService } from './ai-metrics.service';
import { AiMetricsController } from './ai-metrics.controller';
import { AiThrottleGuard } from './ai-throttle.guard';
import { AiMetricsInterceptor } from './ai-metrics.interceptor';

/**
 * AI Metrics Module
 *
 * Global module that provides GPU/resource monitoring and health dashboarding
 * for the AI inference layer.
 *
 * Includes:
 * - AI inference request metrics (count, latency, errors)
 * - Model load time tracking
 * - System RAM and GPU VRAM monitoring
 * - Automatic throttling guard for resource pressure
 * - GET /ai/metrics endpoint (JSON health report)
 * - GET /ai/metrics/prometheus (Prometheus scraping)
 * - GET /ai/metrics/health (liveness check)
 *
 * Environment Variables:
 * - AI_MAX_CONCURRENT_INFERENCES: Max concurrent AI requests (default: 10)
 * - AI_RAM_THROTTLE_THRESHOLD: RAM usage ratio to trigger throttle (default: 0.90)
 * - AI_VRAM_THROTTLE_THRESHOLD: VRAM usage ratio to trigger throttle (default: 0.90)
 * - AI_METRICS_SAMPLING_MS: Resource sampling interval in ms (default: 15000)
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [AiMetricsService, AiThrottleGuard, AiMetricsInterceptor],
  controllers: [AiMetricsController],
  exports: [AiMetricsService, AiThrottleGuard, AiMetricsInterceptor],
})
export class AiMetricsModule {}
