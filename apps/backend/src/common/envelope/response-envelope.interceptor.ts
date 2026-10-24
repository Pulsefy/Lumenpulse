import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Readable } from 'stream';
import {
  RESPONSE_ENVELOPE_HEADER,
  SKIP_ENVELOPE_KEY,
} from './envelope.constants';
import { ApiPaginatedResponse, ApiSuccessResponse } from './envelope.types';
import {
  buildMeta,
  buildPaginationMeta,
  isPaginatedResult,
  resolveRequestId,
  wantsEnvelope,
} from './envelope.utils';

const NON_JSON_CONTENT_TYPES = [
  'text/event-stream',
  'text/plain',
  'text/csv',
  'application/octet-stream',
  'application/pdf',
];

/**
 * Wraps successful HTTP responses in `{ success: true, data, meta }` when the
 * client sends `X-Response-Envelope: v1`. Without the header the handler
 * result passes through untouched, so existing clients are unaffected.
 *
 * Registered once, globally, as the first APP_INTERCEPTOR so it is the
 * outermost layer: idempotent replays are wrapped exactly like live
 * responses.
 */
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    if (!wantsEnvelope(request) || this.isSkipped(context)) {
      return next.handle();
    }

    return next.handle().pipe(
      map((result: unknown) => {
        if (!this.isWrappable(result, response)) {
          return result;
        }
        response.setHeader(RESPONSE_ENVELOPE_HEADER, 'v1');
        return this.wrap(result, resolveRequestId(request));
      }),
    );
  }

  private isSkipped(context: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean>(SKIP_ENVELOPE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) === true
    );
  }

  private isWrappable(result: unknown, response: Response): boolean {
    // Handler wrote the response itself via @Res().
    if (response.headersSent) return false;
    if (
      result instanceof StreamableFile ||
      result instanceof Readable ||
      Buffer.isBuffer(result)
    ) {
      return false;
    }
    const contentType = response.getHeader('Content-Type');
    if (typeof contentType === 'string') {
      const normalized = contentType.toLowerCase();
      if (NON_JSON_CONTENT_TYPES.some((type) => normalized.includes(type))) {
        return false;
      }
    }
    return true;
  }

  private wrap(
    result: unknown,
    requestId: string,
  ): ApiSuccessResponse<unknown> | ApiPaginatedResponse<unknown> {
    const timestamp = new Date().toISOString();

    if (isPaginatedResult(result)) {
      return {
        success: true,
        data: result.items,
        meta: buildPaginationMeta(result, requestId, timestamp),
      };
    }

    return {
      success: true,
      data: result === undefined ? null : result,
      meta: buildMeta(requestId, timestamp),
    };
  }
}
