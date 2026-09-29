import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ErrorResponse } from '../interfaces/error-response.interface';

/**
 * A single validation or domain error entry inside `ErrorResponseDto.details`.
 */
export class ErrorDetailDto {
  @ApiPropertyOptional({
    description: 'Request field the error refers to, when applicable',
    example: 'email',
  })
  field?: string;

  @ApiProperty({
    description: 'Human-readable description of the problem',
    example: 'email must be an email',
  })
  message: string;
}

/**
 * Envelope returned for every non-2xx response. Produced by
 * `GlobalExceptionFilter`, so every endpoint shares this shape.
 */
export class ErrorResponseDto implements ErrorResponse {
  @ApiProperty({
    description:
      'Stable machine-readable error code (see `ErrorCode`, e.g. AUTH_001, SYS_004). ' +
      'Domain modules may return their own prefixed codes.',
    example: 'SYS_004',
  })
  code: string;

  @ApiProperty({
    description:
      'Human-readable message. 5xx messages are generic in production.',
    example: 'Validation failed',
  })
  message: string;

  @ApiPropertyOptional({
    description:
      'Extra context. A list of field errors for validation failures, or a ' +
      'free-form object for domain errors.',
    oneOf: [
      { type: 'array', items: { $ref: '#/components/schemas/ErrorDetailDto' } },
      { type: 'object', additionalProperties: true },
    ],
  })
  details?: ErrorDetailDto[] | Record<string, unknown>;

  @ApiProperty({
    description:
      'Correlation id for this request, also sent as the `X-Request-Id` response header.',
    example: '4b7c7a8e-3f0e-4c7a-9d0b-2a1f7e2c9b11',
  })
  requestId: string;

  @ApiProperty({
    description:
      'Correlation id for this request, also sent as the `X-Correlation-ID` response header. ' +
      'Currently mirrors `requestId`.',
    example: '4b7c7a8e-3f0e-4c7a-9d0b-2a1f7e2c9b11',
  })
  correlationId: string;
}
