/**
 * Unified pagination utilities shared by every list endpoint.
 *
 * Import {@link PaginatedQueryDto} in controller `@Query()` parameters, call
 * {@link resolvePagination} inside the service to apply server-side defaults
 * and caps, and return a {@link PaginatedResponseDto} subclass so the
 * OpenAPI contract carries a consistent `items / total / page / pageSize /
 * totalPages` envelope.
 *
 * See the pagination README (`pagination/PAGINATION.md`) for the full
 * client integration guide.
 */
export {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from './pagination.constants';
export { PaginatedQueryDto } from './pagination-query.dto';
export {
  type ResolvedPagination,
  resolvePagination,
  PaginatedResponseDto,
  paginatedResponse,
} from './pagination-response.dto';
