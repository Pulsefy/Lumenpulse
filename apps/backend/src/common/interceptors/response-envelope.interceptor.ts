import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { SKIP_RESPONSE_ENVELOPE_KEY } from '../dto/api-response.dto';
import {
  REQUEST_ID_HEADER_LOWER,
  CORRELATION_ID_HEADER_LOWER,
} from '../constants/request.constants';

type RequestWithIds = Request & { requestId?: string; correlationId?: string };

/**
 * Wraps every successful (2xx) response body in the standard envelope:
 *
 * { data: <original body>, meta: { requestId, timestamp } }
 *
 * Skipped for:
 * - Handlers / controllers decorated with @SkipResponseEnvelope()
 * - void / undefined / null responses (e.g. 204 No Content)
 * - Bodies that are already enveloped (have a `data` key at the top level
 *   alongside a `meta` key) — prevents double-wrapping on idempotency replay
 */
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // Check opt-out flag on the handler then on the controller class
    const skip = this.reflector.getAllAndOverride<boolean>(
      SKIP_RESPONSE_ENVELOPE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (skip) return next.handle();

    const request = context
      .switchToHttp()
      .getRequest<RequestWithIds>();

    const requestId =
      request.requestId ??
      request.correlationId ??
      (request.headers?.[REQUEST_ID_HEADER_LOWER] as string | undefined) ??
      (request.headers?.[CORRELATION_ID_HEADER_LOWER] as string | undefined) ??
      'unknown';

    return next.handle().pipe(
      map((body) => {
        // Pass void / null through unchanged — NestJS sends 204 No Content
        if (body === undefined || body === null) return body;

        // Detect already-enveloped bodies to avoid double-wrapping
        if (
          typeof body === 'object' &&
          'data' in (body as object) &&
          'meta' in (body as object)
        ) {
          return body;
        }

        return {
          data: body,
          meta: {
            requestId,
            timestamp: new Date().toISOString(),
          },
        };
      }),
    );
  }
}
