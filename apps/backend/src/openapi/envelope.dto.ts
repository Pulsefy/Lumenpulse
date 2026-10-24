import { ApiProperty } from '@nestjs/swagger';
import { ErrorResponseDto } from './error-response.dto';

/**
 * Swagger models for the opt-in response envelope (`X-Response-Envelope: v1`).
 * Registered as extra models so the contract documents the shapes without
 * changing any operation's default response schema.
 */
export class ApiEnvelopeMetaDto {
  @ApiProperty({
    description: 'Correlation id for this request (same as `X-Request-Id`).',
    example: '4b7c7a8e-3f0e-4c7a-9d0b-2a1f7e2c9b11',
  })
  requestId: string;

  @ApiProperty({
    description: 'ISO-8601 time the response was built.',
    example: '2026-10-24T05:30:00.000Z',
  })
  timestamp: string;
}

export class ApiPaginationMetaDto extends ApiEnvelopeMetaDto {
  @ApiProperty({ description: 'Current page (1-based).', example: 1 })
  page: number;

  @ApiProperty({ description: 'Items per page.', example: 20 })
  limit: number;

  @ApiProperty({ description: 'Total items across all pages.', example: 123 })
  total: number;

  @ApiProperty({ description: 'Total number of pages.', example: 7 })
  totalPages: number;

  @ApiProperty({ description: 'True when a later page exists.', example: true })
  hasNext: boolean;

  @ApiProperty({
    description: 'True when an earlier page exists.',
    example: false,
  })
  hasPrevious: boolean;
}

export class ApiSuccessEnvelopeDto {
  @ApiProperty({ enum: [true], example: true })
  success: true;

  @ApiProperty({
    description: "The handler's original response body.",
    nullable: true,
  })
  data: unknown;

  @ApiProperty({ type: () => ApiEnvelopeMetaDto })
  meta: ApiEnvelopeMetaDto;
}

export class ApiPaginatedEnvelopeDto {
  @ApiProperty({ enum: [true], example: true })
  success: true;

  @ApiProperty({
    description: 'The page of items (lifted from `items`).',
    type: 'array',
    items: {},
  })
  data: unknown[];

  @ApiProperty({ type: () => ApiPaginationMetaDto })
  meta: ApiPaginationMetaDto;
}

export class ApiErrorEnvelopeDto {
  @ApiProperty({ enum: [false], example: false })
  success: false;

  @ApiProperty({ type: () => ErrorResponseDto })
  error: ErrorResponseDto;
}

export const ENVELOPE_MODELS = [
  ApiEnvelopeMetaDto,
  ApiPaginationMetaDto,
  ApiSuccessEnvelopeDto,
  ApiPaginatedEnvelopeDto,
  ApiErrorEnvelopeDto,
];
