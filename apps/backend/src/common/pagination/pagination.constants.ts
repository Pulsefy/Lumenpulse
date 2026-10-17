/**
 * Server-side pagination constants shared across every list endpoint.
 *
 * Keeping the defaults and caps in one place guarantees that no endpoint can
 * silently return an unbounded array or accept a page size that would
 * destabilise the database.
 */

/** Default page number (1-indexed). */
export const DEFAULT_PAGE = 1;

/** Default number of items per page. */
export const DEFAULT_PAGE_SIZE = 20;

/** Maximum number of items a single page is allowed to return. */
export const MAX_PAGE_SIZE = 100;
