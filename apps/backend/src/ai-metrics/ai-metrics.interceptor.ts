import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AiMetricsService } from './ai-metrics.service';

/**
 * Interceptor that automatically instruments AI-related routes with
 * inference latency tracking.
 *
 * Apply it to controllers or individual routes:
 *   @UseInterceptors(AiMetricsInterceptor)
 *
 * The interceptor reads the `x-ai-model` header (or falls back to the
 * route path) to identify the model being used, then records timing
 * via the AiMetricsService.
 */
@Injectable()
export class AiMetricsInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AiMetricsInterceptor.name);

  constructor(private readonly aiMetrics: AiMetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const modelName =
      request.headers['x-ai-model'] ||
      this.extractModelFromRoute(request.path);

    const tracker = this.aiMetrics.startInference(modelName);

    return next.handle().pipe(
      tap({
        next: () => {
          tracker.end('success');
        },
        error: (error: unknown) => {
          const errorType =
            error instanceof Error ? error.constructor.name : 'UnknownError';
          tracker.end('error', errorType);
        },
      }),
    );
  }

  /**
   * Derive a model identifier from the route path.
   * e.g. /analyze → "sentiment", /retrain → "retraining"
   */
  private extractModelFromRoute(path: string): string {
    const cleanPath = (path || '').replace(/^\/+|\/+$/g, '').toLowerCase();

    if (cleanPath.includes('sentiment') || cleanPath.includes('analyze')) {
      return 'sentiment';
    }
    if (cleanPath.includes('retrain')) {
      return 'retraining';
    }
    if (cleanPath.includes('predict') || cleanPath.includes('forecast')) {
      return 'forecasting';
    }

    return cleanPath || 'unknown';
  }
}
