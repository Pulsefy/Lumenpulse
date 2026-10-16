import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Standard API response envelope.
 *
 * Every HTTP response emitted by the backend is wrapped in one of the
 * shapes below. The envelope is applied by
 * `ResponseEnvelopeInterceptor` for success responses and by
 * `GlobalExceptionFilter` for error responses, so individual controllers
 * do not need to construct it.
 *
 * Success (single resource):
 * {
 *   "success": true,
 *   "data": { ... },
 *   "meta": { "requestId": "...", "timestamp": "..." }
 * }
 *
 * Success (paginated list):
 * {
 *   "success": true,
 *   "data": [ ... ],
 *   "meta": {
 *     "page": 1,
 *     "limit": 20,
 *     "total": 123,
 *     "totalPages": 7,
     *     "hasNext": true,
 *     "hasPrevious": false,
 *     "requestId": "...",
 *     "timestamp": "..."
 *   }
 * }
 *
 * Error:
 * {
 *   "success": false,
 *   "error": {
 *     "code": "SYS_NOT_FOUND",
 *     "message": "Resource not found",
 *     "details": [ ... ],
 *     "requestId": "...",
 *     "correlationId": "..."
 *   }
 * }
 */

export interface ApiEnvelopeMeta {
  requestId: string;
  timestamp: string;
}

export interface ApiPaginationMeta extends ApiEnvelopeMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  meta: ApiEnvelopeMeta;
}

export interface ApiPaginatedResponse<T> {
  success: true;
  data: T[];
  meta: ApiPaginationMeta;
}

export interface ApiErrorDetail {
  message: string;
  [column: string]: unknown;
}

export interface ApiErrorPayload {
  code: string;
  message: string;
  details?: unknown;
  requestId: string;
  correlationId: string;
}

export interface ApiErrorResponse {
  success: false;
  error: ApiErrorPayload;
}

export type ApiResponse<T> =
  | ApiSuccessResponse<T>
  | ApiPaginatedResponse<T>
  | ApiErrorResponse;

/**
 * Swagger models for the envelope. These are referenced from
 * `openapi.document.ts` so the generated contract documents the envelope
 * without requiring per-controller code.
 */
export class ApiEnvelopeMetaDto {
  @apiProperty(
    { description: 'Request identifier copied from the X-Request-Id header.' },
  )
  requestId!: string;

  @apiProperty(
    { description: 'ISO-8601 timestamp of when the response was built.' },
  )
  timestamp!: string;
}

export class ApiPaginationMetaDto extends ApiEnvelopeMetaDto {
  @apiProperty(
    { description: 'Current page number (1-based).', example: 1 },
  )
  page!: number;

  @apiProperty(
    { description: 'Maximum number of items per page.', example: 20 },
  )
  limit!: number;

  @ApiProperty({
    description: 'Total number of items across all pages.',
    example: 123,
  })
  total!: number;

  @ApiProperty({
    description: 'Total number of pages.',
    example: 7,
  })
  totalPages!: number;

  @ApiProperty({
    description: 'True when a subsequent page exists.',
    example: true,
  })
  hasNext!: boolean;

  @ApiProperty({
    description: 'True when a previous page exists.',
    example: false,
  })
  hasPrevious!: boolean;
}

export class ApiErrorDetailDto {
  @ApiProperty({ description: 'Human-readable detail message.' })
  message!: string;
}

export class ApiErrorPayloadDto {
  @ApiProperty({
    description: 'Stable machine-readable error code.',
    example: 'SYS_NOT_FOUND',
  })
  code!: string;

  @ApiProperty({ description: 'Human-readable error message.' })
  message!: string;

  @ApiPropertyOptional({
    description: 'Optional error details (e.g. validation fields).',
    type: () => ApiErrorDetailDto,
    isArray: true,
  })
  details?: ApiErrorDetailDto[];

  @ApiProperty({ description: 'Request identifier.' })
  requestId!: string;

  @ApiProperty({ description: 'Correlation identifier.' })
  correlationId!: string;
}

export class ApiErrorResponseDto {
  @ApiProperty({ description: 'Always false for error responses.', example: false })
  success!: false;

  @ApiProperty({ type: () => ApiErrorPayloadDto })
  error!: ApiErrorPayloadDto;
}
