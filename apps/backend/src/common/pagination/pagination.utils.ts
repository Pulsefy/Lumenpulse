import { PaginationMetaDto } from './pagination.dto';

/**
 * Builds the standard `meta` object for an offset-paginated (page/limit)
 * response.
 *
 * @param page - 1-based page number of this response
 * @param limit - page size applied to this response
 * @param total - total number of items across all pages, or `null` when the
 * data source cannot report a total
 */
export function createOffsetMeta(params: {
  page: number;
  limit: number;
  total: number | null;
}): PaginationMetaDto {
  const { page, limit, total } = params;
  return {
    limit,
    page,
    total,
    totalPages: total === null ? null : Math.ceil(total / limit),
    nextCursor: null,
  };
}

/**
 * Builds the standard `meta` object for a cursor-paginated response.
 *
 * @param limit - page size applied to this response
 * @param nextCursor - cursor for the next page, or `null`/`undefined` when
 * there are no further pages
 */
export function createCursorMeta(params: {
  limit: number;
  nextCursor?: string | null;
}): PaginationMetaDto {
  return {
    limit: params.limit,
    page: null,
    total: null,
    totalPages: null,
    nextCursor: params.nextCursor ?? null,
  };
}

/**
 * Applies offset (page/limit) pagination to an in-memory array.
 * Returns the requested page along with the total number of items.
 */
export function paginateArray<T>(
  items: T[],
  page: number,
  limit: number,
): { items: T[]; total: number } {
  const start = (page - 1) * limit;
  return {
    items: items.slice(start, start + limit),
    total: items.length,
  };
}
