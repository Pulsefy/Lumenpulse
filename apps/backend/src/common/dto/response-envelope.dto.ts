import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Standard API error response structure
 */
export class ApiErrorDto {
  @ApiProperty({
    description: 'Human-readable error message',
    example: 'Resource not found',
  })
  message: string;

  @ApiProperty({
    description: 'Machine-readable error code',
    example: 'NOT_FOUND',
    required: false,
  })
  code?: string;

  @ApiProperty({
    description: 'HTTP status code',
    example: 404,
  })
  statusCode: number;

  @ApiProperty({
    description: 'Additional error details',
    required: false,
  })
  details?: Record<string, unknown>;
}

/**
 * Standard API success response envelope
 */
export class ApiResponseEnvelopeDto<T> {
  @ApiProperty({
    description: 'Indicates if the request was successful',
    example: true,
  })
  success: true;

  @ApiProperty({
    description: 'Response data',
    required: false,
  })
  data?: T;
}

/**
 * Standard API error response envelope
 */
export class ApiErrorResponseEnvelopeDto {
  @ApiProperty({
    description: 'Indicates if the request was successful',
    example: false,
  })
  success: false;

  @ApiProperty({
    description: 'Error details',
    type: ApiErrorDto,
  })
  error: ApiErrorDto;
}

/**
 * Pagination metadata for list endpoints
 */
export class PaginationMetaDto {
  @ApiProperty({
    description: 'Total number of items',
    example: 100,
  })
  total: number;

  @ApiProperty({
    description: 'Current page number (1-indexed)',
    example: 1,
  })
  page: number;

  @ApiProperty({
    description: 'Number of items per page',
    example: 10,
  })
  limit: number;

  @ApiProperty({
    description: 'Total number of pages',
    example: 10,
  })
  totalPages: number;
}

/**
 * Paginated response structure
 */
export class PaginatedResponseDto<T> {
  @ApiProperty({
    description: 'Array of items',
    isArray: true,
  })
  items: T[];

  @ApiProperty({
    description: 'Pagination metadata',
    type: PaginationMetaDto,
  })
  pagination: PaginationMetaDto;
}
