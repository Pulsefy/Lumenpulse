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
 * Interceptor that captures HTTP metrics for all requests
 * Records request count, latency, and error rates
 */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  private readonly logger = new Logger(MetricsInterceptor.name);

  constructor(private metricsService: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    const startTime = Date.now();
    const method = request.method;
    // Remove query parameters and IDs for better metric grouping
    const route = this.normalizeRoute(request.path);

    return next.handle().pipe(
      tap({
        next: () => {
          this.recordMetrics(method, route, response.statusCode, startTime);
        },
        error: (error: unknown) => {
          // For errors, try to get status code from error or use 500
          const statusCode =
            (error as Record<string, unknown>)?.status ||
            (error as Record<string, unknown>)?.statusCode ||
            500;
          this.recordMetrics(method, route, statusCode as number, startTime);
        },
      }),
    );
  }

  /**
   * Normalize the route by removing IDs and variable parameters
   * Converts /users/123/posts/456 to /users/:id/posts/:id
   * This prevents metric cardinality explosion
   */
  private normalizeRoute(path: string): string {
    // Remove query parameters
    const cleanPath = path.split('?')[0];

    // Replace UUIDs and numeric IDs with placeholders
    // UUID pattern: 8-4-4-4-12 hex digits
    const normalized = cleanPath
      .replace(
        /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
        ':id',
      )
      .replace(/\/\d+([/?#]|$)/g, '/:id$1') // Replace numeric IDs
      .replace(/\/$/, ''); // Remove trailing slash

    return normalized || '/';
  }

  /**
   * Record metrics for the request
   */
  private recordMetrics(
    method: string,
    route: string,
    statusCode: number,
    startTime: number,
  ): void {
    const duration = Date.now() - startTime;
    try {
      this.metricsService.recordHttpRequest(
        method,
        route,
        statusCode,
        duration,
      );
    } catch (error) {
      this.logger.error(
        `Failed to record metrics for ${method} ${route}:`,
        error,
      );
    }
  }
}
