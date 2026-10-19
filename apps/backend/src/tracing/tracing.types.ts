export type SpanKind =
  'SERVER' | 'CLIENT' | 'PRODUCER' | 'CONSUMER' | 'INTERNAL';
export type SpanStatus = 'OK' | 'ERROR' | 'UNSET';

export interface SpanEvent {
  name: string;
  timestampMs: number;
  attributes?: Record<string, unknown>;
}

export interface SpanRecord {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: SpanKind;
  startTimeMs: number;
  endTimeMs?: number;
  durationMs?: number;
  attributes: Record<string, unknown>;
  events: SpanEvent[];
  status: SpanStatus;
  statusMessage?: string;
  sampled: boolean;
}

export interface Span {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly kind: SpanKind;
  readonly startTimeMs: number;
  readonly sampled: boolean;
  endTimeMs?: number;
  durationMs?: number;
  status: SpanStatus;
  statusMessage?: string;

  setAttribute(key: string, value: unknown): this;
  setAttributes(attrs: Record<string, unknown>): this;
  addEvent(name: string, attributes?: Record<string, unknown>): this;
  recordException(error: unknown): this;
  setStatus(status: SpanStatus, message?: string): this;
  end(): SpanRecord;
  toRecord(): SpanRecord;
}

export interface TraceContext {
  traceId: string;
  spanId: string;
  sampled: boolean;
  correlationId?: string;
  activeSpan?: Span;
}
