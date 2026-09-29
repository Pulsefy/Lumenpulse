/**
 * Shared constants and types for the rate-limit infrastructure.
 *
 * This file intentionally has no runtime dependencies (no config import) so it
 * can be imported from anywhere — including modules whose tests mock
 * `rate-limit.config` — without side effects.
 */

/**
 * Every endpoint class that has its own rate-limit profile.
 *
 * `global` is the implicit class of any route that does not declare one.
 */
export const RATE_LIMIT_ENDPOINT_CLASSES = [
  'global',
  'auth',
  'portfolioRead',
  'portfolioWrite',
  'watchlistRead',
  'watchlistWrite',
  'newsRead',
  'projectRead',
  'crowdfundRead',
  'stellarRead',
  'searchRead',
  'analyticsRead',
  'exportJob',
  'contractSimulation',
  'friendbotBootstrap',
] as const;

export type RateLimitEndpointClass =
  (typeof RATE_LIMIT_ENDPOINT_CLASSES)[number];

/**
 * Expensive endpoint classes.
 *
 * These carry their own (stricter) profiles and — unlike cheap classes, which
 * are counted per handler — share a single bucket across every route in the
 * class. A client therefore cannot multiply its budget by spreading calls over
 * several search / export / analytics / simulation endpoints.
 */
export const EXPENSIVE_ENDPOINT_CLASSES: ReadonlySet<RateLimitEndpointClass> =
  new Set<RateLimitEndpointClass>([
    'searchRead',
    'analyticsRead',
    'exportJob',
    'contractSimulation',
  ]);

/**
 * Classes for which bot and service principals have their own configurable
 * profiles. Any other class falls back to the standard (human) profile so
 * that, for example, bots never get a looser budget on auth endpoints.
 */
export const PRINCIPAL_SCOPED_ENDPOINT_CLASSES = [
  'global',
  'searchRead',
  'analyticsRead',
  'exportJob',
  'contractSimulation',
] as const satisfies readonly RateLimitEndpointClass[];

export type PrincipalScopedEndpointClass =
  (typeof PRINCIPAL_SCOPED_ENDPOINT_CLASSES)[number];

/** Principal kinds the limiter distinguishes between. */
export type RateLimitPrincipalType = 'user' | 'bot' | 'service' | 'anonymous';

/** Principal kinds whose limits are configured separately via bot-auth. */
export type MachinePrincipalType = Extract<
  RateLimitPrincipalType,
  'bot' | 'service'
>;

export interface RateLimitPrincipal {
  type: RateLimitPrincipalType;
  /** Stable identifier (user id, bot id, service id, or source address). */
  id: string;
  /** Key used for bucketing in the rate-limit store. */
  trackerKey: string;
}

/** Reflector metadata key storing a route's endpoint class. */
export const RATE_LIMIT_ENDPOINT_CLASS_KEY = 'rate-limit:endpoint-class';

/** Request property where the resolved principal is cached for the request. */
export const RATE_LIMIT_PRINCIPAL_REQUEST_KEY = '__rateLimitPrincipal';

/**
 * Low-cardinality metric label for each endpoint class.
 */
export const ENDPOINT_CLASS_METRIC_LABELS: Readonly<
  Record<RateLimitEndpointClass, string>
> = Object.freeze({
  global: 'default',
  auth: 'auth',
  portfolioRead: 'portfolio_read',
  portfolioWrite: 'portfolio_write',
  watchlistRead: 'watchlist_read',
  watchlistWrite: 'watchlist_write',
  newsRead: 'news_read',
  projectRead: 'project_read',
  crowdfundRead: 'crowdfund_read',
  stellarRead: 'stellar_read',
  searchRead: 'search',
  analyticsRead: 'analytics',
  exportJob: 'export',
  contractSimulation: 'contract_simulation',
  friendbotBootstrap: 'friendbot_bootstrap',
});

/** Response headers emitted by the limiter (exposed to browsers via CORS). */
export const RATE_LIMIT_RESPONSE_HEADERS = [
  'RateLimit-Limit',
  'RateLimit-Remaining',
  'RateLimit-Reset',
  'RateLimit-Policy',
  'X-RateLimit-Limit',
  'X-RateLimit-Remaining',
  'X-RateLimit-Reset',
  'Retry-After',
] as const;
