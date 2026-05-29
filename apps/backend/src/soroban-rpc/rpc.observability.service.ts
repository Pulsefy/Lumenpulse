import { Injectable, Logger } from '@nestjs/common';


const BUCKETS_MS = [50, 100, 250, 500, 1_000, 2_500, 5_000, Infinity];

export interface LatencyBucket {
  le: number;
  count: number;
}

export interface MethodMetrics {
  calls: number;
  successes: number;
  failures: number;
  retries: number;
  latencyBuckets: LatencyBucket[];
  latencySumMs: number;
}

function emptyMethodMetrics(): MethodMetrics {
  return {
    calls: 0,
    successes: 0,
    failures: 0,
    retries: 0,
    latencyBuckets: BUCKETS_MS.map((le) => ({ le, count: 0 })),
    latencySumMs: 0,
  };
}


@Injectable()
export class RpcObservabilityService {
  private readonly logger = new Logger(RpcObservabilityService.name);
  private readonly store = new Map<string, MethodMetrics>();

  // ─── Logging helpers ───────────────────────────────────────────────────────

  logAttemptStart(method: string, attempt: number): void {
    this.logger.debug(
      JSON.stringify({ event: 'rpc.attempt.start', method, attempt }),
    );
  }

  logAttemptSuccess(method: string, attempt: number, latencyMs: number): void {
    this.logger.log(
      JSON.stringify({
        event: 'rpc.attempt.success',
        method,
        attempt,
        latencyMs,
        success: true,
      }),
    );
  }

  logAttemptFailed(
    method: string,
    attempt: number,
    latencyMs: number,
    errorCode: string,
  ): void {
    this.logger.warn(
      JSON.stringify({
        event: 'rpc.attempt.failed',
        method,
        attempt,
        latencyMs,
        success: false,
        errorCode,
      }),
    );
  }

  logRetriesExhausted(
    method: string,
    totalAttempts: number,
    errorCode: string,
  ): void {
    this.logger.error(
      JSON.stringify({
        event: 'rpc.retries.exhausted',
        method,
        totalAttempts,
        success: false,
        errorCode,
      }),
    );
  }



  private get(method: string): MethodMetrics {
    if (!this.store.has(method)) {
      this.store.set(method, emptyMethodMetrics());
    }
    return this.store.get(method)!;
  }

  recordCall(method: string): void {
    this.get(method).calls++;
  }

  recordRetry(method: string): void {
    this.get(method).retries++;
  }

  recordSuccess(method: string, latencyMs: number): void {
    const m = this.get(method);
    m.successes++;
    m.latencySumMs += latencyMs;
    for (const b of m.latencyBuckets) {
      if (latencyMs <= b.le) b.count++;
    }
  }

  recordFailure(method: string, latencyMs: number): void {
    const m = this.get(method);
    m.failures++;
    m.latencySumMs += latencyMs;
    for (const b of m.latencyBuckets) {
      if (latencyMs <= b.le) b.count++;
    }
  }

  /**
   * Return a deep copy of all per-method counters.
   * Safe to serialise and return from a /metrics controller.
   */
  getSnapshot(): Record<string, MethodMetrics> {
    const out: Record<string, MethodMetrics> = {};
    for (const [k, v] of this.store) {
      out[k] = {
        ...v,
        latencyBuckets: v.latencyBuckets.map((b) => ({ ...b })),
      };
    }
    return out;
  }

  /** Reset all counters — call between tests. */
  reset(): void {
    this.store.clear();
  }
}