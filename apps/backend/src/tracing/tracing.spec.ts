import {
  parseTraceparent,
  formatTraceparent,
  generateTraceId,
  generateSpanId,
} from './w3c-trace-context';
import { TracerService } from './tracer.service';

describe('Tracing Infrastructure (#1588)', () => {
  describe('W3C Trace Context', () => {
    it('parses valid W3C traceparent header', () => {
      const header = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
      const parsed = parseTraceparent(header);

      expect(parsed).not.toBeNull();
      expect(parsed?.version).toBe('00');
      expect(parsed?.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
      expect(parsed?.parentSpanId).toBe('00f067aa0ba902b7');
      expect(parsed?.traceFlags).toBe('01');
      expect(parsed?.sampled).toBe(true);
    });

    it('rejects invalid traceparent with all zeros', () => {
      const allZeroTraceId =
        '00-00000000000000000000000000000000-00f067aa0ba902b7-01';
      expect(parseTraceparent(allZeroTraceId)).toBeNull();

      const allZeroSpanId =
        '00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01';
      expect(parseTraceparent(allZeroSpanId)).toBeNull();
    });

    it('formats compliant W3C traceparent', () => {
      const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
      const spanId = '00f067aa0ba902b7';
      const header = formatTraceparent(traceId, spanId, true);

      expect(header).toBe(
        '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      );
    });

    it('generates compliant trace and span IDs', () => {
      const traceId = generateTraceId();
      const spanId = generateSpanId();

      expect(traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(spanId).toMatch(/^[0-9a-f]{16}$/);
    });
  });

  describe('TracerService', () => {
    let tracer: TracerService;

    beforeEach(() => {
      tracer = new TracerService();
      tracer.clearRecentSpans();
    });

    it('configures and respects sampling rates', () => {
      tracer.setSampleRate(0);
      expect(tracer.getSampleRate()).toBe(0);
      expect(tracer.shouldSample()).toBe(false);

      tracer.setSampleRate(1);
      expect(tracer.getSampleRate()).toBe(1);
      expect(tracer.shouldSample()).toBe(true);
    });

    it('creates child spans preserving traceId and establishing hierarchy', async () => {
      tracer.setSampleRate(1);

      await tracer.withSpan('parent-http-request', async (parentSpan) => {
        parentSpan.setAttribute('http.method', 'POST');
        parentSpan.setAttribute('http.route', '/v1/contributions');

        await tracer.withSpan('db-insert-query', (childSpan) => {
          childSpan.setAttribute('db.system', 'postgresql');
          childSpan.setAttribute('db.operation', 'INSERT');
        });
      });

      const spans = tracer.getRecentSpans();
      expect(spans).toHaveLength(2);

      const [childRecord, parentRecord] = spans;
      expect(childRecord.name).toBe('db-insert-query');
      expect(parentRecord.name).toBe('parent-http-request');

      expect(childRecord.traceId).toBe(parentRecord.traceId);
      expect(childRecord.parentSpanId).toBe(parentRecord.spanId);
      expect(parentRecord.parentSpanId).toBeUndefined();
    });

    it('attaches correlation id as span attribute', async () => {
      const corrId = 'corr-test-uuid-1234';
      const ctx = tracer.extractOrCreateContext(undefined, corrId);

      await tracer.runWithContext(ctx, async () => {
        await tracer.withSpan('test-operation', (span) => {
          expect(span.toRecord().attributes['correlation_id']).toBe(corrId);
        });
      });

      const spans = tracer.getRecentSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0].attributes['lumenpulse.correlation_id']).toBe(corrId);
    });

    it('captures exceptions and sets status to ERROR', async () => {
      await expect(
        tracer.withSpan('failing-span', () => {
          throw new Error('Database connection failed');
        }),
      ).rejects.toThrow('Database connection failed');

      const spans = tracer.getRecentSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0].status).toBe('ERROR');
      expect(spans[0].statusMessage).toBe('Database connection failed');
      expect(spans[0].events).toHaveLength(1);
      expect(spans[0].events[0].name).toBe('exception');
    });
  });
});
