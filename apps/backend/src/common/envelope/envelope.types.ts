import { ErrorResponse } from '../../interfaces/error-response.interface';

/** Metadata attached to every enveloped success response. */
export interface ApiEnvelopeMeta {
  requestId: string;
  timestamp: string;
}

/** Metadata attached to an enveloped paginated list response. */
export interface ApiPaginationMeta extends ApiEnvelopeMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

/** `{ success: true, data, meta }` for a single resource or arbitrary payload. */
export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  meta: ApiEnvelopeMeta;
}

/** `{ success: true, data: T[], meta }` for a paginated list. */
export interface ApiPaginatedResponse<T> {
  success: true;
  data: T[];
  meta: ApiPaginationMeta;
}

/**
 * `{ success: false, error }` where `error` is the existing `ErrorResponse`
 * produced by `GlobalExceptionFilter`, unchanged.
 */
export interface ApiErrorEnvelope {
  success: false;
  error: ErrorResponse;
}

export type ApiEnvelope<T> =
  | ApiSuccessResponse<T>
  | ApiPaginatedResponse<T>
  | ApiErrorEnvelope;

/**
 * The paginated result shape services already return
 * (`{ items, total, page, limit }`). The interceptor lifts it into
 * `ApiPaginatedResponse`.
 */
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}
