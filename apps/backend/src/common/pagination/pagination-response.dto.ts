import { ApiProperty } from '@nestjs/swagger';
import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from './pagination.constants';

/**
 * Normalised pagination values after server-side defaults and caps have been
 * applied. Services should use {@link resolvePagination} to obtain these
 * instead of reading the raw query DTO directly.
 */
export interface ResolvedPagination {
  page: number;
  pageSize: number;
  offset: number;
}

/**
 * Apply server-side defaults and caps to the raw `page` / `pageSize` values
 * received from a client. Returns the normalised values plus the computed
 * `offset` that can be passed directly to TypeORM `skip` / `take` or an SQL
 * `LIMIT` / `OFFSET` clause.
 *
 * The function is intentionally side-effect free and framework-agnostic so it
 * can be unit-tested and reused by any service.
 */
export function resolvePagination(
  page: number | undefined,
  pageSize: number | undefined,
): ResolvedPagination {
  const resolvedPage = Math.max(1, page ?? DEFAULT_PAGE);
  const resolvedPageSize = Math.min(
    Math.max(1, pageSize ?? DEFAULT_PAGE_SIZE),
    MAX_PAGE_SIZE,
  );
  const offset = (resolvedPage - 1) * resolvedPageSize;
  return { page: resolvedPage, pageSize: resolvedPageSize, offset };
}

/**
 * Standard pagination metadata returned by every list endpoint, guaranteeing
 * a consistent envelope shape across the API.
 *
 * Generic over the item type so that `PaginatedResponseDto<T>` can carry a
 * typed `items` array in the OpenAPI contract.
 */
export abstract class PaginatedResponseDto<T> {
  @ApiProperty({
    description: 'List of items for the current page',
    type: 'array',
  })
  items: T[];

  @ApiProperty({
    description: 'Total number of items matching the query',
    example: 42,
  })
  total: number;

  @ApiProperty({ description: 'Current page number (1-indexed)', example: 1 })
  page: number;

  @ApiProperty({
    description: 'Number of items per page',
    example: DEFAULT_PAGE_SIZE,
  })
  pageSize: number;

  @ApiProperty({ description: 'Total number of pages', example: 3 })
  totalPages: number;

  protected constructor(
    items: T[],
    pagination: ResolvedPagination,
    total: number,
  ) {
    this.items = items;
    this.total = total;
    this.page = pagination.page;
    this.pageSize = pagination.pageSize;
    this.totalPages = Math.max(1, Math.ceil(total / pagination.pageSize));
  }
}

/**
 * Factory that builds a concrete {@link PaginatedResponseDto} subclass for a
 * given item DTO. Used in service modules so that Swagger emits a named
 * schema per endpoint rather than a generic `PaginatedResponseDto<T>`.
 *
 * ```ts
 * class RoundListResponseDto extends paginatedResponse(RoundDto) {}
 * ```
 */
export function paginatedResponse<T>(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _ItemDto: new () => T,
): new (
  items: T[],
  pagination: ResolvedPagination,
  total: number,
) => PaginatedResponseDto<T> {
  // A named class is returned at runtime so @nestjs/swagger generates a
  // stable schema name. The body is a thin wrapper that forwards to the
  // abstract base.
  return class extends PaginatedResponseDto<T> {
    constructor(items: T[], pagination: ResolvedPagination, total: number) {
      super(items, pagination, total);
    }
  };
}
