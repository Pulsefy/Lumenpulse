/**
 * Default number of items returned per page when no `limit` query parameter
 * is provided. Applied uniformly across every list endpoint.
 */
export const DEFAULT_PAGE_SIZE = 20;

/**
 * Maximum number of items a client may request per page. Requests with a
 * larger `limit` are rejected server-side with 400 Bad Request.
 */
export const MAX_PAGE_SIZE = 100;
