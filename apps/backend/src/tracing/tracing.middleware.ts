import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { TracerService } from './tracer.service';
import { W3C_TRACEPARENT_HEADER, formatTraceparent } from './w3c-trace-context';
import { RequestContextService } from '../common/services/request-context.service';

@Injectable()
export class TracingMiddleware implements NestMiddleware {
  constructor(private readonly tracer: TracerService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const rawTraceparent = req.headers[W3C_TRACEPARENT_HEADER] as
      string | undefined;
    const correlationId =
      (req.headers['x-correlation-id'] as string) ||
      (req.headers['x-request-id'] as string) ||
      RequestContextService.getCorrelationId();

    const parentContext = this.tracer.extractOrCreateContext(
      rawTraceparent,
      correlationId,
    );

    const spanName = `${req.method} ${req.path || req.url}`;
    const span = this.tracer.startSpan(spanName, {
      kind: 'SERVER',
      parentContext,
      sampled: parentContext.sampled,
      attributes: {
        'http.method': req.method,
        'http.url': req.originalUrl || req.url,
        'http.target': req.url,
        'http.host': req.headers.host,
        'http.user_agent': req.headers['user-agent'],
        'lumenpulse.correlation_id': correlationId,
      },
    });

    const activeContext = {
      traceId: span.traceId,
      spanId: span.spanId,
      sampled: span.sampled,
      correlationId,
      activeSpan: span,
    };

    // Echo traceparent in HTTP response headers per W3C specification
    res.setHeader(
      W3C_TRACEPARENT_HEADER,
      formatTraceparent(span.traceId, span.spanId, span.sampled),
    );

    res.on('finish', () => {
      span.setAttribute('http.status_code', res.statusCode);
      if (res.statusCode >= 500) {
        span.setStatus('ERROR', `HTTP ${res.statusCode}`);
      } else if (res.statusCode >= 400) {
        span.setStatus('ERROR', `Client Error ${res.statusCode}`);
      } else {
        span.setStatus('OK');
      }
      span.end();
    });

    this.tracer.runWithContext(activeContext, () => {
      next();
    });
  }
}
