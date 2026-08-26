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
 *   GET /articles/123                                      → /articles/:id
 *   GET /articles/550e8400-…                               → /articles/:id
 *   GET /portfolio/accounts/GABC…/summary                  → /portfolio/accounts/:id/summary
 *   GET /contracts/capabilities/CCE…                       → /contracts/capabilities/:id
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
   * Every segment is inspected individually so identifiers of any shape
   * (UUIDs, numeric IDs, Stellar wallet addresses, contract IDs, hashes and
   * other long machine-generated tokens) collapse onto the `:id` template.
   * Static segments — including API version prefixes such as `v1` — are kept
   * untouched, so the resulting label set is bounded by the number of routes.
   *
   * Examples:
   *   /users/42/posts/7                                    → /users/:id/posts/:id
   *   /orders/550e8400-e29b-…                              → /orders/:id
   *   /v1/portfolio/accounts/GBXX…/summary                 → /v1/portfolio/accounts/:id/summary
   */
  private normalizeRoute(path: string): string {
    // strip query-string, then normalize segment-by-segment
    const segments = path.split('?')[0].split('/');
    const normalized = segments.map((segment) =>
      this.normalizeSegment(segment),
    );
    // Collapse duplicate slashes and drop the trailing slash
    const joined = normalized
      .join('/')
      .replace(/\/{2,}/g, '/')
      .replace(/\/$/, '');
    return joined || '/';
  }

  /**
   * Classify a single path segment as dynamic (`:id`) or static.
   *
   * A segment is treated as dynamic when it is an identifier rather than a
   * route keyword: UUIDs, numbers, Stellar StrKeys (wallet addresses, contract
   * IDs, hashes), 64-char hex hashes, or any other long machine-generated
   * token. The 24-char fallback acts as a hard ceiling that guarantees the
   * `route` label cardinality stays bounded even for identifiers we have not
   * enumerated explicitly.
   */
  private normalizeSegment(segment: string): string {
    if (segment === '') {
      return segment;
    }
    // API version prefixes (v1, v2, …) are static route keywords
    if (/^v\d+$/i.test(segment)) {
      return segment;
    }
    // UUIDs (8-4-4-4-12)
    if (
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        segment,
      )
    ) {
      return ':id';
    }
    // Pure numeric segments
    if (/^\d+$/.test(segment)) {
      return ':id';
    }
    // Stellar StrKeys — wallet public keys (G…), contract IDs (C…), muxed
    // accounts (M…), pre-auth / hash / signed payloads (P, T, X, S…):
    // 56-char base32 (A–Z, 2–7)
    if (/^[GCMPTXS][A-Z2-7]{55}$/.test(segment)) {
      return ':id';
    }
    // 64-char hex hashes (e.g. Soroban transaction hashes)
    if (/^[0-9a-f]{64}$/i.test(segment)) {
      return ':id';
    }
    // Final ceiling: any other long machine-generated token (>= 24 chars).
    // 24 is safely above the longest static route keyword in this codebase.
    if (segment.length >= 24 && /^[A-Za-z0-9._~-]+$/.test(segment)) {
      return ':id';
    }
    return segment;
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
