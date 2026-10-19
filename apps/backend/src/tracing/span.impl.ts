import {
  Span,
  SpanEvent,
  SpanKind,
  SpanRecord,
  SpanStatus,
} from './tracing.types';

export class SpanImpl implements Span {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly kind: SpanKind;
  readonly startTimeMs: number;
  readonly sampled: boolean;

  endTimeMs?: number;
  durationMs?: number;
  status: SpanStatus = 'UNSET';
  statusMessage?: string;

  private readonly attributes: Record<string, unknown> = {};
  private readonly events: SpanEvent[] = [];
  private isEnded = false;
  private readonly onEnd?: (record: SpanRecord) => void;

  constructor(options: {
    traceId: string;
    spanId: string;
    parentSpanId?: string;
    name: string;
    kind?: SpanKind;
    sampled?: boolean;
    attributes?: Record<string, unknown>;
    onEnd?: (record: SpanRecord) => void;
  }) {
    this.traceId = options.traceId;
    this.spanId = options.spanId;
    this.parentSpanId = options.parentSpanId;
    this.name = options.name;
    this.kind = options.kind ?? 'INTERNAL';
    this.sampled = options.sampled ?? false;
    this.startTimeMs = Date.now();
    this.onEnd = options.onEnd;

    if (options.attributes) {
      this.setAttributes(options.attributes);
    }
  }

  setAttribute(key: string, value: unknown): this {
    if (this.isEnded) return this;
    this.attributes[key] = value;
    return this;
  }

  setAttributes(attrs: Record<string, unknown>): this {
    if (this.isEnded) return this;
    for (const [k, v] of Object.entries(attrs)) {
      this.attributes[k] = v;
    }
    return this;
  }

  addEvent(name: string, attributes?: Record<string, unknown>): this {
    if (this.isEnded) return this;
    this.events.push({
      name,
      timestampMs: Date.now(),
      attributes,
    });
    return this;
  }

  recordException(error: unknown): this {
    if (this.isEnded) return this;
    const err = error instanceof Error ? error : new Error(String(error));
    this.status = 'ERROR';
    this.statusMessage = err.message;
    this.addEvent('exception', {
      'exception.type': err.name,
      'exception.message': err.message,
      'exception.stacktrace': err.stack,
    });
    return this;
  }

  setStatus(status: SpanStatus, message?: string): this {
    if (this.isEnded) return this;
    this.status = status;
    if (message) {
      this.statusMessage = message;
    }
    return this;
  }

  end(): SpanRecord {
    if (this.isEnded) {
      return this.toRecord();
    }
    this.isEnded = true;
    this.endTimeMs = Date.now();
    this.durationMs = Math.max(0, this.endTimeMs - this.startTimeMs);
    if (this.status === 'UNSET') {
      this.status = 'OK';
    }

    const record = this.toRecord();
    this.onEnd?.(record);
    return record;
  }

  toRecord(): SpanRecord {
    return {
      traceId: this.traceId,
      spanId: this.spanId,
      parentSpanId: this.parentSpanId,
      name: this.name,
      kind: this.kind,
      startTimeMs: this.startTimeMs,
      endTimeMs: this.endTimeMs,
      durationMs: this.durationMs,
      attributes: { ...this.attributes },
      events: [...this.events],
      status: this.status,
      statusMessage: this.statusMessage,
      sampled: this.sampled,
    };
  }
}
