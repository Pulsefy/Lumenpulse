/**
 * Deep link resolution for the Lumenpulse mobile app (issue #1410).
 *
 * The app registers the `mobile://` custom scheme (see `app.json`) and can also
 * receive https universal links. Notification taps are the primary source of
 * deep links: the backend notification service fans out payloads whose
 * `metadata`/`data` must resolve to a real screen, otherwise the tap is dead.
 *
 * This module is the single source of truth for:
 *  1. Which deep link routes exist (`DEEP_LINK_ROUTES`) — kept in sync with the
 *     file-system route tree by `lib/__tests__/deep-links.test.ts`.
 *  2. How an incoming URL is parsed into a route + params (`resolveDeepLink`).
 *  3. How a backend notification payload maps to a screen
 *     (`resolveNotificationTarget`).
 *  4. How authenticated-only targets behave while logged out
 *     (`resolveAuthenticatedTarget`) — route to login, then continue.
 *
 * URL parsing note: for custom schemes such as `mobile://grants/1`, the WHATWG
 * URL parser treats `grants` as the *hostname* and `/1` as the pathname. The
 * route must therefore be assembled from both parts for non-http(s) schemes.
 */

/** Expo Router route rendered when a link cannot be matched. */
export const NOT_FOUND_ROUTE = '+not-found';

/** Login screen path used for authenticated-only targets. */
export const LOGIN_ROUTE = '/auth/login';

/** Scheme the app registers for deep links. */
export const APP_SCHEME = 'mobile';

export interface RouteConfig {
  /**
   * Expo Router path template. Dynamic segments use `:param` syntax and map to
   * `[param]` files on disk. Group segments such as `(tabs)` are never part of
   * the URL.
   */
  path: string;
  /**
   * Whether the target screen is wrapped in `<ProtectedRoute />` and therefore
   * requires an authenticated session.
   */
  authRequired: boolean;
}

/** Keys of the deep link route table. */
export type DeepLinkRouteKey = 'receipt' | 'notifications' | 'grants' | 'projects';

/**
 * The deep link route table. Every notification-tappable screen must be
 * declared here; `lib/__tests__/deep-links.test.ts` fails when this table and
 * the `app/` directory drift apart (a renamed route silently produces a dead
 * notification tap otherwise).
 */
export const DEEP_LINK_ROUTES: Record<DeepLinkRouteKey, RouteConfig> = {
  /** Transaction receipt — reachable while logged out (no ProtectedRoute). */
  receipt: { path: '/transaction-receipt', authRequired: false },
  /** In-app notification inbox — wrapped in ProtectedRoute. */
  notifications: { path: '/notifications', authRequired: true },
  /** Grant round detail — wrapped in ProtectedRoute. */
  grants: { path: '/grants/:id', authRequired: true },
  /** Crowdfund project detail — public. */
  projects: { path: '/projects/:id', authRequired: false },
};

/**
 * Notification types emitted by the backend notification service
 * (`apps/backend/src/notification/notification.entity.ts` → `NotificationType`).
 * Duplicated here (the mobile app cannot import backend code); the fixture
 * suite asserts every value is covered.
 */
export type BackendNotificationType =
  | 'anomaly'
  | 'drift'
  | 'sentiment_spike'
  | 'system'
  | 'project'
  | 'contribution'
  | 'milestone'
  | 'governance'
  | 'token'
  | 'pool'
  | 'price'
  | 'module'
  | 'admin'
  | 'reputation';

/**
 * Maps each backend notification type to the deep link route it should open.
 *
 * Project-scoped events (project / contribution / milestone / governance) all
 * carry a `projectId` in their metadata (see
 * `notification-fanout.service.ts`) and open the project detail screen.
 * Asset- and system-scoped events have no dedicated mobile screen and fall
 * back to the notification inbox, which is always a real screen.
 */
export const NOTIFICATION_TYPE_TO_ROUTE: Record<BackendNotificationType, DeepLinkRouteKey> = {
  project: 'projects',
  contribution: 'projects',
  milestone: 'projects',
  governance: 'projects',
  token: 'notifications',
  pool: 'notifications',
  price: 'notifications',
  anomaly: 'notifications',
  drift: 'notifications',
  sentiment_spike: 'notifications',
  system: 'notifications',
  module: 'notifications',
  admin: 'notifications',
  reputation: 'notifications',
};

export interface ResolvedDeepLink {
  /** Concrete Expo Router path (e.g. `/grants/42`) or `+not-found`. */
  route: string;
  /** Path/query params extracted from the URL. */
  params: Record<string, string>;
  /** Matching route table key, or null when unresolved. */
  routeKey: DeepLinkRouteKey | null;
  /** Whether the matched screen requires authentication. */
  authRequired: boolean;
}

export interface ResolvedDeepLinkPath {
  config: RouteConfig;
  routeKey: DeepLinkRouteKey;
  params: Record<string, string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Normalizes a raw path: trims slashes and lowercases (routes are lowercase). */
function normalizePath(path: string): string {
  return path.replace(/^\/+|\/+$/g, '').toLowerCase();
}

interface ExtractedUrl {
  path: string;
  params: Record<string, string>;
}

/**
 * Extracts the route path and query params from a URL, handling both
 * http(s) URLs (path in `pathname`) and custom-scheme URLs such as
 * `mobile://grants/1` (route in `hostname`, remainder in `pathname`).
 * Returns null for unparseable or path-less input.
 */
export function extractPathAndParams(url: string): ExtractedUrl | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const isHttpScheme = parsed.protocol === 'http:' || parsed.protocol === 'https:';
  const rawPath = isHttpScheme ? parsed.pathname : `${parsed.hostname}${parsed.pathname}`;
  const path = normalizePath(rawPath);
  if (!path) return null;

  return { path, params: Object.fromEntries(parsed.searchParams.entries()) };
}

/**
 * Matches a concrete path (e.g. `grants/1`) against the route table.
 * Dynamic `:param` segments capture the corresponding value.
 */
export function matchRoute(path: string): ResolvedDeepLinkPath | null {
  const segments = normalizePath(path).split('/').filter(Boolean);

  for (const [routeKey, config] of Object.entries(DEEP_LINK_ROUTES) as [
    DeepLinkRouteKey,
    RouteConfig,
  ][]) {
    const templateSegments = config.path.replace(/^\//, '').split('/');
    if (segments.length !== templateSegments.length) continue;

    const params: Record<string, string> = {};
    let matched = true;
    for (let i = 0; i < templateSegments.length; i += 1) {
      const template = templateSegments[i];
      if (template.startsWith(':')) {
        params[template.slice(1)] = decodeURIComponent(segments[i]);
      } else if (template !== segments[i]) {
        matched = false;
        break;
      }
    }
    if (matched) return { config, routeKey, params };
  }

  return null;
}

/** Fills a route template with params; returns null when a param is missing. */
export function buildRoutePath(
  routeKey: DeepLinkRouteKey,
  params: Record<string, string> = {},
): string | null {
  const template = DEEP_LINK_ROUTES[routeKey].path;
  const query: string[] = [];

  const path = template
    .split('/')
    .map((segment) => {
      if (!segment.startsWith(':')) return segment;
      const value = params[segment.slice(1)];
      if (!value) return segment;
      return encodeURIComponent(value);
    })
    .join('/');

  if (path.includes(':')) return null;

  for (const [key, value] of Object.entries(params)) {
    if (!template.includes(`:${key}`))
      query.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  }

  return query.length > 0 ? `${path}?${query.join('&')}` : path;
}

/** Builds a `mobile://` deep link URL for a route table entry. */
export function buildDeepLinkUrl(
  routeKey: DeepLinkRouteKey,
  params: Record<string, string> = {},
): string {
  const built = buildRoutePath(routeKey, params);
  if (!built) {
    throw new Error(`Missing params for deep link route "${routeKey}": ${JSON.stringify(params)}`);
  }
  return `${APP_SCHEME}://${built.replace(/^\//, '')}`;
}

/**
 * Resolves an incoming deep link URL to a concrete route.
 * Unknown or malformed links resolve to `+not-found` without throwing.
 */
export function resolveDeepLink(url: string): ResolvedDeepLink {
  const extracted = extractPathAndParams(url);
  if (!extracted) {
    return { route: NOT_FOUND_ROUTE, params: {}, routeKey: null, authRequired: false };
  }

  const match = matchRoute(extracted.path);
  if (!match) {
    return { route: NOT_FOUND_ROUTE, params: {}, routeKey: null, authRequired: false };
  }

  // Query params survive resolution; path params take precedence over them.
  const params = { ...extracted.params, ...match.params };

  return {
    route: buildRoutePath(match.routeKey, params) ?? NOT_FOUND_ROUTE,
    params,
    routeKey: match.routeKey,
    authRequired: match.config.authRequired,
  };
}

function pickIdParam(data: Record<string, unknown>): string | null {
  // `metadata` wins over top-level fields: for notification rows served by
  // `GET /notifications` the top-level `id` is the notification's own uuid,
  // not the id of the entity the notification is about.
  const metadata = isRecord(data['metadata']) ? data['metadata'] : {};
  for (const source of [metadata, data]) {
    const projectId = readString(source['projectId']);
    if (projectId) return projectId;
    const id = readString(source['id']);
    if (id) return id;
  }
  return null;
}

/**
 * Resolves a notification payload (the `data` bag delivered with a push or the
 * `data` field of an in-app notification record) to a concrete Expo Router
 * path. Never throws: anything unrecognized resolves to `+not-found`.
 *
 * Supported payload conventions, in priority order:
 *  1. `screen` — an explicit Expo Router path (validated against the route
 *     table so a renamed route cannot produce a dead tap).
 *  2. `url` — a full deep link URL (`mobile://…` or https).
 *  3. Legacy conventions (`type: 'alert'` + `alertId`, `type: 'transaction'` +
 *     `transactionId`) — their target screens do not exist; they resolve to
 *     `+not-found` instead of pushing dead routes.
 *  4. Backend notification `type` (see `NOTIFICATION_TYPE_TO_ROUTE`) with
 *     `projectId`/`id` params taken from the payload or its `metadata`.
 */
export function resolveNotificationTarget(data: unknown): string {
  if (!isRecord(data)) return NOT_FOUND_ROUTE;

  const screen = readString(data['screen']);
  if (screen) {
    const [rawPath, rawQuery = ''] = screen.split('?');
    const match = matchRoute(rawPath);
    if (!match) return NOT_FOUND_ROUTE;
    const query = new URLSearchParams(rawQuery);
    const mergedParams = {
      ...Object.fromEntries(query.entries()),
      ...match.params,
    };
    return buildRoutePath(match.routeKey, mergedParams) ?? NOT_FOUND_ROUTE;
  }

  const url = readString(data['url']);
  if (url) return resolveDeepLink(url).route;

  const type = readString(data['type']) ?? '';

  // Legacy push conventions whose target screens no longer exist.
  if (
    (type === 'alert' && data['alertId'] != null) ||
    (type === 'transaction' && data['transactionId'] != null)
  ) {
    return NOT_FOUND_ROUTE;
  }

  if (isBackendNotificationType(type)) {
    const routeKey = NOTIFICATION_TYPE_TO_ROUTE[type];
    const template = DEEP_LINK_ROUTES[routeKey].path;
    const params: Record<string, string> = {};
    if (template.includes(':id')) {
      const id = pickIdParam(data);
      if (!id) return NOT_FOUND_ROUTE;
      params.id = id;
    }
    return buildRoutePath(routeKey, params) ?? NOT_FOUND_ROUTE;
  }

  return NOT_FOUND_ROUTE;
}

export function isBackendNotificationType(value: unknown): value is BackendNotificationType {
  return typeof value === 'string' && value in NOTIFICATION_TYPE_TO_ROUTE;
}

export type AuthAwareTarget =
  | { kind: 'navigate'; path: string }
  | { kind: 'login'; loginPath: string; redirectTarget: string };

/**
 * Resolves a deep link with authentication taken into account:
 *  - authenticated (or public) targets navigate directly;
 *  - authenticated-only targets while logged out route to the login screen
 *    with a `redirect` param carrying the original target, so the app can
 *    continue to it after a successful login (`sanitizeRedirectPath` guards
 *    the continuation on the login screen side).
 */
export function resolveAuthenticatedTarget(
  url: string,
  options: { isAuthenticated: boolean },
): AuthAwareTarget {
  const resolved = resolveDeepLink(url);

  if (!resolved.authRequired || options.isAuthenticated) {
    return { kind: 'navigate', path: resolved.route };
  }

  const redirectTarget = resolved.route;
  return {
    kind: 'login',
    loginPath: `${LOGIN_ROUTE}?redirect=${encodeURIComponent(redirectTarget)}`,
    redirectTarget,
  };
}

/**
 * Validates a post-login redirect target coming from a query param.
 * Only internal paths (single leading slash, no scheme, no protocol-relative
 * URLs) are accepted; anything else falls back to null and the caller should
 * use its default destination.
 */
export function sanitizeRedirectPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  if (value.includes('://')) return null;
  if (value.length > 512) return null;
  return value;
}
