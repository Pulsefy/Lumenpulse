import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { Request, Response } from 'express';
import { MetricsService } from './metrics.service';

/**
 * MetricsInterceptor
 *
 * Applied globally via APP_INTERCEPTOR in MetricsModule.
 * Automatically records HTTP request count, latency, and status for every
 * route handled by NestJS — no per-controller decoration needed.
 *
 * Route normalisation prevents label cardinality explosion:
 *   GET /articles/123          → /articles/:id
 *   GET /articles/550e8400-…   → /articles/:id
 */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  private readonly logger = new Logger(MetricsInterceptor.name);

  constructor(private readonly metricsService: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const startTime = Date.now();
    const method = request.method;
    const route = this.normalizeRoute(request.path);

    return next.handle().pipe(
      tap({
        next: () => {
          this.record(method, route, response.statusCode, startTime);
        },
        error: (err: unknown) => {
          const status =
            (err as Record<string, unknown>)?.status ??
            (err as Record<string, unknown>)?.statusCode ??
            500;
          this.record(method, route, status as number, startTime);
        },
      }),
    );
  }

  /**
   * Replace dynamic path segments with placeholders.
   * Prevents an unbounded number of time-series labels in Prometheus.
   *
   * Examples:
   *   /users/42/posts/7        → /users/:id/posts/:id
   *   /orders/550e8400-e29b-…  → /orders/:id
   */
  private normalizeRoute(path: string): string {
    const clean = path.split('?')[0]; // strip query-string
    return (
      clean
        // UUIDs (8-4-4-4-12)
        .replace(
          /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
          ':id',
        )
        // Pure numeric segments
        .replace(/\/\d+([/?#]|$)/g, '/:id$1')
        // Trailing slash
        .replace(/\/$/, '') || '/'
    );
  }

  private record(
    method: string,
    route: string,
    statusCode: number,
    startTime: number,
  ): void {
    try {
      this.metricsService.recordHttpRequest(
        method,
        route,
        statusCode,
        Date.now() - startTime,
      );
    } catch (err) {
      this.logger.error(`Failed to record metrics for ${method} ${route}`, err);
    }
  }
}