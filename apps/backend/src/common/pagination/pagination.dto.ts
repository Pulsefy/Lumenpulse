import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './pagination.constants';

/**
 * Standard query parameters accepted by every list endpoint.
 *
 * Every list endpoint understands the same three parameters. Each endpoint
 * operates in one of two modes and ignores the parameter of the other mode:
 *
 * - **Offset mode** (database-backed endpoints): paginate with `page` + `limit`.
 * - **Cursor mode** (Horizon-backed endpoints): paginate with `cursor` + `limit`,
 *   passing `meta.nextCursor` from the previous response.
 */
export class PaginationQueryDto {
  @ApiProperty({
    description:
      '1-based page number for offset pagination. Ignored by cursor-paginated endpoints (they use `cursor` instead).',
    example: 1,
    minimum: 1,
    default: 1,
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiProperty({
    description: `Number of items per page. Defaults to ${DEFAULT_PAGE_SIZE}, maximum ${MAX_PAGE_SIZE}.`,
    example: 20,
    minimum: 1,
    maximum: MAX_PAGE_SIZE,
    default: DEFAULT_PAGE_SIZE,
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit?: number = DEFAULT_PAGE_SIZE;

  @ApiProperty({
    description:
      'Opaque cursor from a previous response, used by cursor-paginated endpoints. Ignored by offset-paginated endpoints (they use `page` instead).',
    example: '1706184000-123456',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  cursor?: string;
}

/**
 * Standard pagination metadata returned in the `meta` property of every
 * paginated list response. The shape is identical across all endpoints;
 * fields that do not apply to the endpoint's pagination mode are `null`.
 */
export class PaginationMetaDto {
  @ApiProperty({
    description: 'Page size actually applied to this response',
    example: 20,
  })
  limit: number;

  @ApiProperty({
    description:
      'Current 1-based page for offset-paginated endpoints; null for cursor-paginated endpoints',
    nullable: true,
    example: 1,
  })
  page: number | null;

  @ApiProperty({
    description:
      'Total number of items across all pages when the data source can report it; null when unknown (e.g. external data sources)',
    nullable: true,
    example: 150,
  })
  total: number | null;

  @ApiProperty({
    description: 'Total number of pages when `total` is known; null otherwise',
    nullable: true,
    example: 8,
  })
  totalPages: number | null;

  @ApiProperty({
    description:
      'Cursor to request the next page for cursor-paginated endpoints; null when the endpoint is offset-paginated or there are no further pages',
    nullable: true,
    example: '1706184000-123456',
  })
  nextCursor: string | null;
}
