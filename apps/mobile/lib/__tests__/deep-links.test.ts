import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import {
  DEEP_LINK_ROUTES,
  DeepLinkRouteKey,
  LOGIN_ROUTE,
  NOTIFICATION_TYPE_TO_ROUTE,
  NOT_FOUND_ROUTE,
  buildDeepLinkUrl,
  buildRoutePath,
  extractPathAndParams,
  isBackendNotificationType,
  matchRoute,
  resolveAuthenticatedTarget,
  resolveDeepLink,
  resolveNotificationTarget,
  sanitizeRedirectPath,
} from '../deep-links';
import {
  BACKEND_NOTIFICATION_FIXTURES,
  BACKEND_NOTIFICATION_TYPES,
  toExpoPushMessage,
} from './fixtures/backend-notifications';

/** Route paths that are intentionally not notification-tappable. */
const NON_TAPPABLE_ROUTES = [
  '/',
  '/discover',
  '/news',
  '/news/:id',
  '/news/saved',
  '/portfolio',
  '/search',
  '/settings',
  '/transaction-history',
  '/watchlist',
  // List screens; generic notifications fall back to the inbox instead.
  '/grants',
  '/projects',
  '/auth/login',
  '/auth/register',
  '/contributor/profile',
  '/settings/cache',
  '/settings/data-privacy',
  '/settings/manage-accounts',
  '/settings/notification-settings',
  '/settings/status',
];

/** Sample params per dynamic route, used to build resolvable URLs. */
const SAMPLE_PARAMS: Record<string, Record<string, string>> = {
  grants: { id: '42' },
  projects: { id: 'proj_42' },
};

/**
 * Derives every Expo Router route path from the file-system route tree
 * (`app/**`), the same way Expo Router does:
 *  - group segments (`(tabs)`) are stripped from the URL,
 *  - `[param].tsx` becomes `:param`,
 *  - `index.tsx` maps to its directory,
 *  - `_layout.tsx` and `+api.tsx`-style special files are not routes.
 */
function deriveRoutesFromRouteTree(): string[] {
  const appDir = join(__dirname, '..', '..', 'app');
  const routes: string[] = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.endsWith('.tsx')) continue;
      if (entry === '_layout.tsx') continue;

      const rel = relative(appDir, full).split(sep).join('/');
      const segments = rel
        .split('/')
        .slice(0, -1)
        .filter((segment) => !segment.startsWith('('));

      const file = entry.replace(/\.tsx$/, '');
      const isIndex = file === 'index';
      if (!isIndex) {
        segments.push(file.replace(/^\[(.+)\]$/, ':$1'));
      }
      routes.push(`/${segments.join('/')}`.replace(/\/+$/, '') || '/');
    }
  };

  walk(appDir);
  return routes.sort();
}

describe('deep link route table', () => {
  it('declares every route as resolvable', () => {
    const keys = Object.keys(DEEP_LINK_ROUTES) as DeepLinkRouteKey[];
    expect(keys.length).toBeGreaterThan(0);

    for (const key of keys) {
      const url = buildDeepLinkUrl(key, SAMPLE_PARAMS[key] ?? {});
      const resolved = resolveDeepLink(url);

      expect(resolved.routeKey).toBe(key);
      expect(resolved.route).not.toBe(NOT_FOUND_ROUTE);
      expect(resolved.route).toBe(
        DEEP_LINK_ROUTES[key].path.replace(':id', SAMPLE_PARAMS[key]?.id ?? ''),
      );
    }
  });

  it('keeps the route table in sync with the app/ route tree', () => {
    const fileRoutes = deriveRoutesFromRouteTree();
    const declared = (Object.values(DEEP_LINK_ROUTES) as { path: string }[]).map((r) => r.path);
    const known = new Set([...declared, ...NON_TAPPABLE_ROUTES]);

    // Every declared deep link must correspond to a real screen file.
    for (const path of declared) {
      expect(fileRoutes).toContain(path);
    }

    // Every screen in the route tree must be either notification-tappable
    // (declared in DEEP_LINK_ROUTES) or explicitly listed as not tappable.
    // This is the tripwire: adding a screen without updating the route table
    // (or this list) fails here instead of producing a dead notification tap.
    for (const route of fileRoutes) {
      // `+not-found` is the fallback screen itself, asserted separately below.
      if (route === '/+not-found') continue;
      expect(known.has(route)).toBe(true);
    }
  });

  it('keeps +not-found available as the fallback screen', () => {
    const fileRoutes = deriveRoutesFromRouteTree();
    expect(fileRoutes).toContain('/+not-found');
  });
});

describe('resolveDeepLink', () => {
  it('parses custom-scheme URLs where the route lives in the hostname', () => {
    expect(extractPathAndParams('mobile://grants/1')).toEqual({
      path: 'grants/1',
      params: {},
    });

    const resolved = resolveDeepLink('mobile://grants/1');
    expect(resolved).toMatchObject({
      route: '/grants/1',
      params: { id: '1' },
      routeKey: 'grants',
      authRequired: true,
    });
  });

  it('parses https universal links with the route in the pathname', () => {
    const resolved = resolveDeepLink('https://lumenpulse.app/projects/abc?ref=share');
    expect(resolved).toMatchObject({
      route: '/projects/abc?ref=share',
      params: { id: 'abc', ref: 'share' },
      routeKey: 'projects',
      authRequired: false,
    });
  });

  it('parses scheme-only URLs (mobile:path) and extra slashes', () => {
    expect(resolveDeepLink('mobile:notifications').route).toBe('/notifications');
    expect(resolveDeepLink('mobile:///notifications').route).toBe('/notifications');
  });

  it('is case-insensitive', () => {
    expect(resolveDeepLink('MOBILE://GRANTS/1').route).toBe('/grants/1');
  });

  it('carries query params through to the resolved route', () => {
    const resolved = resolveDeepLink('mobile://transaction-receipt?txHash=abc&status=success');
    expect(resolved.routeKey).toBe('receipt');
    expect(resolved.authRequired).toBe(false);
    expect(resolved.route).toBe('/transaction-receipt?txHash=abc&status=success');
    expect(resolved.params).toEqual({ txHash: 'abc', status: 'success' });
  });

  it('matches only full paths, not prefixes', () => {
    expect(matchRoute('grants/1/extra')).toBeNull();
    expect(matchRoute('grants')).toBeNull();
    expect(matchRoute('unknown/route')).toBeNull();
  });
});

describe('resolveDeepLink with unknown or malformed links', () => {
  it.each([
    'not a url',
    '::::',
    'mobile://',
    'mobile://unknown/route',
    'mobile://grant-round/1',
    'https://unknown.host.example/grants/1'.replace('grants/1', 'totally/unknown'),
  ])('resolves %s to +not-found without crashing', (url) => {
    expect(() => resolveDeepLink(url)).not.toThrow();
    const resolved = resolveDeepLink(url);
    expect(resolved.route).toBe(NOT_FOUND_ROUTE);
    expect(resolved.routeKey).toBeNull();
    expect(resolved.params).toEqual({});
  });
});

describe('backend notification payload fixtures', () => {
  it('covers every backend notification type', () => {
    const mapped = Object.keys(NOTIFICATION_TYPE_TO_ROUTE);
    expect(BACKEND_NOTIFICATION_TYPES.sort()).toEqual([...mapped].sort());
    expect(BACKEND_NOTIFICATION_TYPES.length).toBeGreaterThan(0);
  });

  it('recognizes backend types and rejects unknown ones', () => {
    expect(isBackendNotificationType('project')).toBe(true);
    expect(isBackendNotificationType('sentiment_spike')).toBe(true);
    expect(isBackendNotificationType('alert')).toBe(false);
    expect(isBackendNotificationType('transaction')).toBe(false);
    expect(isBackendNotificationType(42)).toBe(false);
    expect(isBackendNotificationType(undefined)).toBe(false);
  });

  it('maps project-scoped notifications to the project detail screen', () => {
    for (const type of ['project', 'contribution', 'milestone', 'governance'] as const) {
      const push = toExpoPushMessage(BACKEND_NOTIFICATION_FIXTURES[type]);
      expect(resolveNotificationTarget(push.data)).toBe('/projects/proj_42');
    }
  });

  it('routes asset- and system-scoped notifications to the notification inbox', () => {
    const inboxRouted = BACKEND_NOTIFICATION_TYPES.filter(
      (type) => NOTIFICATION_TYPE_TO_ROUTE[type] === 'notifications',
    );
    expect(inboxRouted.length).toBeGreaterThan(0);
    for (const type of inboxRouted) {
      const push = toExpoPushMessage(BACKEND_NOTIFICATION_FIXTURES[type]);
      expect(resolveNotificationTarget(push.data)).toBe('/notifications');
    }
  });

  it('resolves the raw backend row shape (metadata nested, not just the push data bag)', () => {
    const row = BACKEND_NOTIFICATION_FIXTURES.contribution;
    expect(resolveNotificationTarget(row)).toBe('/projects/proj_42');

    const metadataOnly = BACKEND_NOTIFICATION_FIXTURES.project.metadata;
    expect(resolveNotificationTarget({ type: 'project', ...metadataOnly })).toBe(
      '/projects/proj_42',
    );
  });

  it('falls back to +not-found when a dynamic route has no id', () => {
    expect(resolveNotificationTarget({ type: 'project' })).toBe(NOT_FOUND_ROUTE);
    expect(resolveNotificationTarget({ type: 'contribution', metadata: {} })).toBe(NOT_FOUND_ROUTE);
  });
});

describe('resolveNotificationTarget payload conventions', () => {
  it('honors explicit screen paths when they exist in the route table', () => {
    expect(resolveNotificationTarget({ screen: '/notifications' })).toBe('/notifications');
    expect(resolveNotificationTarget({ screen: 'transaction-receipt' })).toBe(
      '/transaction-receipt',
    );
    expect(resolveNotificationTarget({ screen: '/grants/7?ref=push' })).toBe('/grants/7?ref=push');
  });

  it('rejects explicit screens that no longer exist', () => {
    expect(resolveNotificationTarget({ screen: '/alerts/9' })).toBe(NOT_FOUND_ROUTE);
    expect(resolveNotificationTarget({ screen: '/transactions/abc' })).toBe(NOT_FOUND_ROUTE);
    expect(resolveNotificationTarget({ screen: '/does-not-exist' })).toBe(NOT_FOUND_ROUTE);
  });

  it('honors full deep link URLs passed as url', () => {
    expect(resolveNotificationTarget({ url: 'mobile://projects/9' })).toBe('/projects/9');
    expect(resolveNotificationTarget({ url: 'https://lumenpulse.app/grants/3' })).toBe('/grants/3');
  });

  it('prefers screen over url', () => {
    expect(
      resolveNotificationTarget({ screen: '/notifications', url: 'mobile://projects/9' }),
    ).toBe('/notifications');
  });

  it('neutralizes legacy push conventions whose screens no longer exist', () => {
    expect(resolveNotificationTarget({ type: 'alert', alertId: 5 })).toBe(NOT_FOUND_ROUTE);
    expect(resolveNotificationTarget({ type: 'transaction', transactionId: 'abc' })).toBe(
      NOT_FOUND_ROUTE,
    );
  });

  it('resolves garbage payloads to +not-found without crashing', () => {
    for (const payload of [null, undefined, 42, 'str', [], {}, { type: 'mystery' }]) {
      expect(() => resolveNotificationTarget(payload)).not.toThrow();
      expect(resolveNotificationTarget(payload)).toBe(NOT_FOUND_ROUTE);
    }
  });
});

describe('authenticated-only targets', () => {
  it('routes a logged-out user to login with a continuation to the target', () => {
    const target = resolveAuthenticatedTarget('mobile://notifications', {
      isAuthenticated: false,
    });
    expect(target.kind).toBe('login');
    if (target.kind !== 'login') return;
    expect(target.loginPath).toBe(`${LOGIN_ROUTE}?redirect=%2Fnotifications`);
    expect(target.redirectTarget).toBe('/notifications');
  });

  it('routes a logged-out user tapping a protected grant link to login first', () => {
    const target = resolveAuthenticatedTarget('mobile://grants/42', {
      isAuthenticated: false,
    });
    expect(target.kind).toBe('login');
    if (target.kind !== 'login') return;
    expect(
      sanitizeRedirectPath(new URLSearchParams(target.loginPath.split('?')[1]).get('redirect')),
    ).toBe('/grants/42');
  });

  it('navigates directly when the user is authenticated', () => {
    const target = resolveAuthenticatedTarget('mobile://grants/42', { isAuthenticated: true });
    expect(target).toEqual({ kind: 'navigate', path: '/grants/42' });
  });

  it('navigates directly to public targets even when logged out', () => {
    expect(
      resolveAuthenticatedTarget('mobile://projects/proj_42', { isAuthenticated: false }),
    ).toEqual({ kind: 'navigate', path: '/projects/proj_42' });
  });

  it('completes the login → continue flow with the sanitized redirect', () => {
    const target = resolveAuthenticatedTarget('mobile://grants/7', { isAuthenticated: false });
    if (target.kind !== 'login') fail('expected a login redirect');

    const redirect = new URLSearchParams(target.loginPath.split('?')[1]).get('redirect');
    const safe = sanitizeRedirectPath(redirect);
    expect(safe).toBe('/grants/7');

    // After login the app pushes the continuation target; it must still resolve.
    const resolved = matchRoute(safe?.replace(/^\//, '') ?? '');
    expect(resolved?.routeKey).toBe('grants');
    expect(resolved?.params).toEqual({ id: '7' });
  });
});

describe('sanitizeRedirectPath', () => {
  it('accepts internal paths only', () => {
    expect(sanitizeRedirectPath('/notifications')).toBe('/notifications');
    expect(sanitizeRedirectPath('/grants/1?ref=push')).toBe('/grants/1?ref=push');
  });

  it.each([
    null,
    undefined,
    42,
    '',
    'notifications',
    '//evil.example.com',
    'https://evil.example.com',
    'mobile://notifications',
    `/${'a'.repeat(513)}`,
  ])('rejects %p', (value) => {
    expect(sanitizeRedirectPath(value)).toBeNull();
  });
});

describe('buildRoutePath', () => {
  it('fills dynamic segments and appends leftover params as query', () => {
    expect(buildRoutePath('grants', { id: '1', ref: 'share' })).toBe('/grants/1?ref=share');
    expect(buildRoutePath('notifications')).toBe('/notifications');
  });

  it('encodes unsafe param values', () => {
    expect(buildRoutePath('projects', { id: 'a/b c' })).toBe('/projects/a%2Fb%20c');
  });

  it('returns null when a required param is missing', () => {
    expect(buildRoutePath('grants', {})).toBeNull();
  });

  it('throws when building a URL with missing params', () => {
    expect(() => buildDeepLinkUrl('grants')).toThrow();
  });
});
