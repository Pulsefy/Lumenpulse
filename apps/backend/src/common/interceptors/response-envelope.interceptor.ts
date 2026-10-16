import {
  CallHandler,
  ExecutionContext,
  Interceptor,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Request, Response } from 'express';

import {
  ApiEnvelopeMeta,
  ApiPaginationMeta,
  ApiPaginatedResponse,
  ApiSuccessResponse,
} from '../interfaces/api-envelope.interface';

export const RESPONSE_ENVELOPE_SKIP_HEADER = 'x-envelope-skip';

type RequestWithId = Request & {
  correlationId?: string;
  requestId?: string;
};

export interface PaginationInput {
  page?: number;
  limit?: number;
  total?: number;
}

export interface EnvelopeOptions {
  /** Skip wrapping and return the handler result as-is. */
  skip?: boolean;
  /** Pagination metadata to merge into the envelope. */
  pagination?: PaginationInput;
  /** Override the default data key (defaults to `data`). */
  dataKey?: string;
  /** Extra meta fields to merge into `meta`. */
  meta?: Record<string, unknown>;
}

/**
 * Marker type for a response that has already been enveloped by a
 * controller. The interceptor will not double-wrap it.
 */
export interface EnvelopedResponse<T> {
  __enveloped: true;
  success: true;
  data: T;
  meta: ApiEnvelopeMeta | ApiPaginationMeta;
}

export function envelope<T>(
  data: T,
  meta: ApiEnvelopeMeta | ApiPaginationMeta,
): EnvelopedResponse<T> {
  return { __enveloped: true, success: true, data, meta };
}

function isEnveloped(value: unknown): value is EnvelopedResponse<unknown> {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return candidate.__enveloped === true;
}

function isPaginatedResult(value: unknown): value is PaginatedResult<unknown> {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    Array.isArray(candidate.items) &&
    typeof candidate.total === 'number' &&
    typeof candidate.page === 'number' &&
    typeof candidate.limit === 'number'
  );
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export function buildPaginationMeta(
  input: PaginationInput,
  requestId: string,
  timestamp: string,
  extra?: Record<string, unknown>,
): ApiPaginationMeta {
  const page = Math.max(1, Number(input.page ?? 1));
  const limit = Math.max(1, Number(input.limit ?? 20));
  const total = Math.max(0, Number(input.total ?? 0));
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;

  return {
    page,
    limit,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrevious: page > 1,
    requestId,
    timestamp,
    ...(extra ?? {}),
  } as ApiPaginationMeta;
}

export function buildEnvelopeMeta(
  requestId: string,
  timestamp: string,
  extra?: Record<string, unknown>,
): ApiEnvelopeMeta {
  return { requestId, timestamp, ...(extra ?? {}) } as ApiEnvelopeMeta;
}

export function getRequestId(request: RequestWithId): string {
  if (typeof request.correlationId === 'string' && request.correlationId) {
    return request.correlationId;
  }
  if (typeof request.requestId === 'string' && request.requestId) {
    return request.requestId;
  }
  return 'unknown';
}

@Interceptor()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<RequestWith>();
    const response = http.getResponse<Response>();

    if (this.shouldSkip(request, response)) {
      return next.handle();
    }

    const requestId = getRequestId(request);

    return next.handle().pipe(
      map((result) => this.wrap(result, requestId, response)),
    );
  }

  private shouldSkip(request: RequestWithId, response: Response): boolean {
    const skipHeader = request.headers[RESPONSE_ENVELOPE_SKIP_HEADER];
    if (typeof skipHeader === 'string' && skipHeader.toLowerCase() === 'true') {
      return true;
    }

    // Streamed binary responses (exports, file downloads) are not JSON
    // and must not be wrapped.
    const contentType = response.getHeader('Content-Type');
    if (typeof contentType === 'string') {
      const normalized = contentType.toLowerCase();
      if (
        normalized.includes('text/event-stream') ||
        normalized.includes('application/octet-stream') ||
        normalized.includes('text/csv') ||
        normalized.includes('application/pdf')
      ) {
        return true;
      }
    }

    return false;
  }

  private wrap(
    result: unknown,
    requestId: string,
    response: Response,
  ): unknown {
    const timestamp = new Date().toISOString();

    if (isEnveloped(result)) {
      return result;
    }

    if (isPaginatedResult(result)) {
      const meta = buildPaginationMeta(
        { page: result.page, limit: result.limit, total: result.total },
        requestId,
        timestamp,
      );
      const enveloped: ApiPaginatedResponse<unknown> = {
        success: true,
        data: result.items,
        meta,
      };
      return enveloped;
    }

    const enveloped: ApiSuccessResponse<unknown> = {
      success: true,
      data: result,
      meta: buildEnvelopeMeta(requestId, timestamp),
    };

    // Ensure the response is advertised as JSON.
    if (!response.getHeader('Content-Type')) {
      response.setHeader('Content-Type', 'application/json');
    }

    return enveloped;
  }
}
