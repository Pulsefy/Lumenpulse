import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from './pagination.constants';

/**
 * Shared pagination query parameters accepted by **every** list endpoint.
 *
 * Endpoints that already expose additional filtering fields should extend
 * this class so that `page` and `pageSize` are always present and validated
 * the same way everywhere:
 *
 * ```ts
 * export class ProjectListQueryDto extends PaginatedQueryDto {
 *   @IsOptional() @IsString() status?: string;
 * }
 * ```
 *
 * `page` is 1-indexed; `pageSize` is clamped to `[1, MAX_PAGE_SIZE]` so the
 * server enforces a default and a maximum regardless of client input.
 */
export class PaginatedQueryDto {
  @ApiPropertyOptional({
    description: 'Page number (1-indexed)',
    example: 1,
    minimum: 1,
    default: DEFAULT_PAGE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = DEFAULT_PAGE;

  @ApiPropertyOptional({
    description: 'Number of items per page',
    example: DEFAULT_PAGE_SIZE,
    minimum: 1,
    maximum: MAX_PAGE_SIZE,
    default: DEFAULT_PAGE_SIZE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize?: number = DEFAULT_PAGE_SIZE;
}
