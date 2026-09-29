import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { QueryProfilerService } from './query-profiler.service';

/**
 * QueryCountMiddleware
 *
 * When QUERY_PROFILING=true this middleware wraps each incoming HTTP
 * request in an AsyncLocalStorage context so that every `profile()` /
 * `trackCall()` invocation downstream can accumulate a per-request call
 * count.  The total is logged at the end of the request.
 *
 * When QUERY_PROFILING is not set (the default) the middleware is a
 * zero-cost no-op.
 *
 * **Registration** – this middleware is applied globally in AppModule
 * only when the feature flag is enabled.  See ProfilingModule for the
 * conditional export and AppModule for the registration pattern.
 *
 * Usage:
 * ```
 * QUERY_PROFILING=true nest start:dev
 * ```
 */
@Injectable()
export class QueryCountMiddleware implements NestMiddleware {
  constructor(private readonly profiler: QueryProfilerService) {}

  use(req: Request, _res: Response, next: NextFunction): void {
    if (!this.profiler.isEnabled) {
      next();
      return;
    }

    const label = `${req.method} ${req.path}`;

    // Kick off the request inside a profiling context.
    // We don't need to await the response here – runInContext returns
    // immediately after the handler pipeline completes because next()
    // resolves synchronously for NestJS middleware chains.
    void this.profiler.runInContext(label, () => {
      return new Promise<void>((resolve) => {
        next();
        resolve();
      });
    });
  }
}
