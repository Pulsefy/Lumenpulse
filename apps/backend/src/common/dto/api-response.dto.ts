import { ApiProperty } from '@nestjs/swagger';

/**
 * Standard success envelope wrapping any single-resource or command response.
 *
 * All 2xx responses from non-exempt endpoints carry this shape:
 * { data: <payload>, meta: { requestId, timestamp } }
 */
export class ApiResponseDto<T = unknown> {
  @ApiProperty({ description: 'Response payload' })
  data: T;

  @ApiProperty({ type: () => ApiResponseMetaDto })
  meta: ApiResponseMetaDto;
}

export class ApiResponseMetaDto {
  @ApiProperty({ example: '2026-09-29T14:16:52.386Z' })
  timestamp: string;

  @ApiProperty({ example: '4b7c7a8e-3f0e-4c7a-9d0b-2a1f7e2c9b11' })
  requestId: string;
}

/**
 * Paginated list envelope.
 *
 * { data: T[], pagination: { page, limit, total, totalPages } }
 */
export class PaginatedResponseDto<T = unknown> {
  @ApiProperty({ isArray: true })
  data: T[];

  @ApiProperty({ type: () => PaginationMetaDto })
  pagination: PaginationMetaDto;

  @ApiProperty({ type: () => ApiResponseMetaDto })
  meta: ApiResponseMetaDto;
}

export class PaginationMetaDto {
  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;

  @ApiProperty({ example: 150 })
  total: number;

  @ApiProperty({ example: 8 })
  totalPages: number;
}

/** Decorator metadata key that opts an endpoint OUT of the envelope. */
export const SKIP_RESPONSE_ENVELOPE_KEY = 'skipResponseEnvelope';
