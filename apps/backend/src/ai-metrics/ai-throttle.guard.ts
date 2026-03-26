import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { AiMetricsService } from './ai-metrics.service';

/**
 * Guard that checks system resource pressure before allowing
 * AI inference requests to proceed.
 *
 * When memory (RAM or VRAM) exceeds the configured threshold or
 * the concurrency limit is reached, the guard rejects the request
 * with 503 Service Unavailable and a Retry-After header.
 *
 * Apply this guard to any controller or route that triggers AI inference:
 *   @UseGuards(AiThrottleGuard)
 */
@Injectable()
export class AiThrottleGuard implements CanActivate {
  private readonly logger = new Logger(AiThrottleGuard.name);

  constructor(private readonly aiMetrics: AiMetricsService) {}

  canActivate(context: ExecutionContext): boolean {
    const { throttle, reason } = this.aiMetrics.shouldThrottle();

    if (throttle) {
      this.aiMetrics.recordThrottledRequest();
      this.logger.warn(`AI request throttled — ${reason}`);

      const response = context.switchToHttp().getResponse();
      response.setHeader('Retry-After', '30');

      throw new HttpException(
        {
          statusCode: HttpStatus.SERVICE_UNAVAILABLE,
          message: 'AI service is under resource pressure. Please retry later.',
          reason,
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    return true;
  }
}
