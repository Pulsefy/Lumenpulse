import type { Request } from 'express';
import {
  RESPONSE_ENVELOPE_HEADER,
  RESPONSE_ENVELOPE_VERSION,
} from './envelope.constants';
import {
  ApiEnvelopeMeta,
  ApiPaginationMeta,
  PaginatedResult,
} from './envelope.types';

type RequestWithIds = Pick<Request, 'headers'> & {
  correlationId?: string;
  requestId?: string;
};

/** True when the client asked for the standard envelope. */
export function wantsEnvelope(request: Pick<Request, 'headers'>): boolean {
  const raw = request.headers?.[RESPONSE_ENVELOPE_HEADER.toLowerCase()];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (
    typeof value === 'string' &&
    value.trim().toLowerCase() === RESPONSE_ENVELOPE_VERSION
  );
}

export function resolveRequestId(request: RequestWithIds): string {
  if (typeof request.correlationId === 'string' && request.correlationId) {
    return request.correlationId;
  }
  if (typeof request.requestId === 'string' && request.requestId) {
    return request.requestId;
  }
  return 'unknown';
}

export function isPaginatedResult(
  value: unknown,
): value is PaginatedResult<unknown> {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    Array.isArray(v.items) &&
    typeof v.total === 'number' &&
    typeof v.page === 'number' &&
    typeof v.limit === 'number'
  );
}

export function buildMeta(
  requestId: string,
  timestamp: string,
): ApiEnvelopeMeta {
  return { requestId, timestamp };
}

export function buildPaginationMeta(
  result: PaginatedResult<unknown>,
  requestId: string,
  timestamp: string,
): ApiPaginationMeta {
  const page = Math.max(1, Math.floor(result.page));
  const limit = Math.max(1, Math.floor(result.limit));
  const total = Math.max(0, Math.floor(result.total));
  const totalPages = Math.ceil(total / limit);
  return {
    requestId,
    timestamp,
    page,
    limit,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrevious: page > 1,
  };
}
