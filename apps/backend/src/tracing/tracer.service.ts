import { Injectable, Logger } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Span, SpanKind, SpanRecord, TraceContext } from './tracing.types';
import { SpanImpl } from './span.impl';
import {
  formatTraceparent,
  generateSpanId,
  generateTraceId,
  parseTraceparent,
} from './w3c-trace-context';
import { RequestContextService } from '../common/services/request-context.service';

export interface StartSpanOptions {
  kind?: SpanKind;
  parentContext?: TraceContext;
  attributes?: Record<string, unknown>;
  sampled?: boolean;
}

@Injectable()
export class TracerService {
  private readonly logger = new Logger(TracerService.name);
  private static readonly storage = new AsyncLocalStorage<TraceContext>();
  private readonly recentSpans: SpanRecord[] = [];
  private readonly maxRecentSpans = 500;

  /**
   * Configurable sampling rate between 0.0 and 1.0.
   * Defaults to 0.05 (5% low-rate sampling per acceptance criteria).
   */
  private sampleRate = 0.05;
  private isEnabled = true;

  constructor() {
    const envRate = process.env.TRACING_SAMPLE_RATE;
    if (envRate !== undefined) {
      const parsed = parseFloat(envRate);
      if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
        this.sampleRate = parsed;
      }
    }

    if (
      process.env.TRACING_ENABLED === 'false' ||
      process.env.TRACING_ENABLED === '0'
    ) {
      this.isEnabled = false;
    }
  }

  setSampleRate(rate: number): void {
    if (rate >= 0 && rate <= 1) {
      this.sampleRate = rate;
    }
  }

  getSampleRate(): number {
    return this.sampleRate;
  }

  shouldSample(): boolean {
    if (!this.isEnabled) return false;
    return Math.random() < this.sampleRate;
  }

  /**
   * Returns current active trace context if present.
   */
  getActiveContext(): TraceContext | undefined {
    return TracerService.storage.getStore();
  }

  /**
   * Returns current active span if present.
   */
  getActiveSpan(): Span | undefined {
    return this.getActiveContext()?.activeSpan;
  }

  /**
   * Formats the current active span as a W3C `traceparent` string.
   */
  getTraceparent(): string | undefined {
    const ctx = this.getActiveContext();
    if (!ctx) return undefined;
    return formatTraceparent(ctx.traceId, ctx.spanId, ctx.sampled);
  }

  /**
   * Extracts or creates a TraceContext from an incoming W3C `traceparent` header.
   */
  extractOrCreateContext(
    traceparentHeader?: string | string[],
    correlationId?: string,
  ): TraceContext {
    const parsed = parseTraceparent(traceparentHeader);
    const traceId = parsed ? parsed.traceId : generateTraceId();
    const parentSpanId = parsed ? parsed.parentSpanId : undefined;
    const sampled = parsed ? parsed.sampled : this.shouldSample();
    const corrId =
      correlationId || RequestContextService.getCorrelationId() || undefined;

    return {
      traceId,
      spanId: parentSpanId || generateSpanId(),
      sampled,
      correlationId: corrId,
    };
  }

  /**
   * Starts a new span. If an active context exists, the new span becomes a child span.
   */
  startSpan(name: string, options: StartSpanOptions = {}): Span {
    const activeCtx = options.parentContext || this.getActiveContext();
    const correlationId =
      activeCtx?.correlationId || RequestContextService.getCorrelationId();

    const traceId = activeCtx ? activeCtx.traceId : generateTraceId();
    const parentSpanId = activeCtx ? activeCtx.spanId : undefined;
    const spanId = generateSpanId();
    const sampled =
      options.sampled ?? (activeCtx ? activeCtx.sampled : this.shouldSample());

    const initialAttributes: Record<string, unknown> = {
      ...options.attributes,
    };

    if (correlationId && correlationId !== 'unknown') {
      initialAttributes['lumenpulse.correlation_id'] = correlationId;
      initialAttributes['correlation_id'] = correlationId;
    }

    const span = new SpanImpl({
      traceId,
      spanId,
      parentSpanId,
      name,
      kind: options.kind ?? 'INTERNAL',
      sampled,
      attributes: initialAttributes,
      onEnd: (record) => this.recordSpan(record),
    });

    return span;
  }

  /**
   * Executes a callback within the context of a new active span.
   */
  async withSpan<T>(
    name: string,
    fn: (span: Span) => Promise<T> | T,
    options: StartSpanOptions = {},
  ): Promise<T> {
    const span = this.startSpan(name, options);
    const newContext: TraceContext = {
      traceId: span.traceId,
      spanId: span.spanId,
      sampled: span.sampled,
      correlationId:
        (span.toRecord().attributes['lumenpulse.correlation_id'] as string) ||
        undefined,
      activeSpan: span,
    };

    return TracerService.storage.run(newContext, async () => {
      try {
        const result = await fn(span);
        span.end();
        return result;
      } catch (error) {
        span.recordException(error);
        span.end();
        throw error;
      }
    });
  }

  /**
   * Runs an operation with a specific trace context.
   */
  runWithContext<T>(context: TraceContext, fn: () => T): T {
    return TracerService.storage.run(context, fn);
  }

  /**
   * Records a completed span record.
   */
  private recordSpan(record: SpanRecord): void {
    if (this.recentSpans.length >= this.maxRecentSpans) {
      this.recentSpans.shift();
    }
    this.recentSpans.push(record);

    if (record.sampled || record.status === 'ERROR') {
      this.logger.debug(
        `[Trace] [${record.kind}] ${record.name} - traceId=${record.traceId} spanId=${record.spanId} ` +
          `parentSpanId=${record.parentSpanId ?? 'root'} duration=${record.durationMs}ms status=${record.status}`,
      );
    }
  }

  /**
   * Returns recent recorded spans (useful for debugging, tests, and trace dumps).
   */
  getRecentSpans(): SpanRecord[] {
    return [...this.recentSpans];
  }

  /**
   * Clears recent recorded spans.
   */
  clearRecentSpans(): void {
    this.recentSpans.length = 0;
  }
}
