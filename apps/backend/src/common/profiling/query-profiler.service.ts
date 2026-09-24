import { Injectable, Logger } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';

export interface ProfileOptions {
  thresholdMs?: number;
  label?: string;
}

/**
 * Per-request context tracked by the AsyncLocalStorage store.
 */
export interface QueryRequestContext {
  /** Total number of tracked calls made during this request. */
  callCount: number;
  /** Human-readable label set by the request profiler middleware. */
  requestLabel: string;
}

/**
 * QueryProfilerService
 *
 * Development-only profiling helper that does two things:
 *
 * 1. **Timing** – wraps an async operation and logs a warning when it
 *    exceeds the configured threshold (always active when called).
 *
 * 2. **Call counting** – when QUERY_PROFILING=true, every call to
 *    `profile()` increments a per-request counter stored in
 *    AsyncLocalStorage.  A request-scoped middleware/interceptor can
 *    read the final count after the handler returns and log it.
 *
 * Profiling is **off by default** and must be enabled explicitly:
 *
 * ```
 * QUERY_PROFILING=true  # enables call counting + verbose logging
 * ```
 *
 * The service is always injectable and safe to use in production – when
 * the feature flag is off it adds no measurable overhead beyond the
 * normal timing path.
 */
@Injectable()
export class QueryProfilerService {
  private readonly logger = new Logger(QueryProfilerService.name);

  /**
   * AsyncLocalStorage carries call-count state through an entire request
   * without passing it explicitly through every layer.
   */
  readonly store = new AsyncLocalStorage<QueryRequestContext>();

  /** True when QUERY_PROFILING env var is "true" (case-insensitive). */
  get isEnabled(): boolean {
    return process.env['QUERY_PROFILING']?.toLowerCase() === 'true';
  }

  /**
   * Run `fn` and record timing + call count.
   *
   * @param fn     Async function to profile.
   * @param options  Optional label and threshold.
   */
  async profile<T>(
    fn: () => Promise<T>,
    options: ProfileOptions = {},
  ): Promise<T> {
    const { thresholdMs = 100, label = 'Query' } = options;
    const start = performance.now();

    // Increment call counter if profiling is active
    if (this.isEnabled) {
      const ctx = this.store.getStore();
      if (ctx) {
        ctx.callCount += 1;
      }
    }

    try {
      const result = await fn();
      const duration = performance.now() - start;

      if (duration > thresholdMs) {
        this.logger.warn(
          `[SLOW QUERY] ${label} took ${duration.toFixed(2)}ms (threshold: ${thresholdMs}ms)`,
        );
      } else {
        this.logger.debug(`[QUERY] ${label} took ${duration.toFixed(2)}ms`);
      }

      return result;
    } catch (error) {
      const duration = performance.now() - start;
      this.logger.error(
        `[QUERY FAILED] ${label} failed after ${duration.toFixed(2)}ms`,
        error,
      );
      throw error;
    }
  }

  /**
   * Track an external call (e.g. an RPC call or price fetch) in the
   * per-request counter without adding timing overhead.
   *
   * Use this for lightweight tracking of calls that are not individually
   * profiled via `profile()`.
   */
  trackCall(label?: string): void {
    if (!this.isEnabled) return;

    const ctx = this.store.getStore();
    if (ctx) {
      ctx.callCount += 1;
      this.logger.debug(
        `[CALL TRACKED] ${label ?? 'unnamed'} – total so far: ${ctx.callCount}`,
      );
    }
  }

  /**
   * Return the current call count for the active request context,
   * or -1 when profiling is off or no context is active.
   */
  getCallCount(): number {
    if (!this.isEnabled) return -1;
    return this.store.getStore()?.callCount ?? -1;
  }

  /**
   * Run a handler inside a fresh request context and log the final
   * call count when done.  Called by QueryCountMiddleware.
   */
  async runInContext<T>(
    requestLabel: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    if (!this.isEnabled) {
      return fn();
    }

    const ctx: QueryRequestContext = { callCount: 0, requestLabel };
    const result = await this.store.run(ctx, fn);

    this.logger.log(
      `[QUERY COUNT] ${requestLabel} → ${ctx.callCount} call(s)`,
    );

    return result;
  }
}
