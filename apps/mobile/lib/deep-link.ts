/**
 * Deep Link Navigation Utility
 *
 * Maps deep link screen names from push notification payloads
 * to actual Expo Router paths in the mobile app.
 *
 * Deep link screens are defined in the backend DeepLinkScreen enum
 * and must map 1:1 to valid route paths here.
 */

export type DeepLinkScreen =
  | 'news_detail'
  | 'project_detail'
  | 'portfolio'
  | 'transaction_detail'
  | 'settings'
  | 'settings_notifications'
  | 'notifications_list'
  | 'asset_detail'
  | 'discover';

export interface DeepLinkData {
  screen: DeepLinkScreen;
  id?: string;
  params?: Record<string, unknown>;
}

/**
 * Resolve a DeepLinkData object to an Expo Router path string.
 *
 * Handles all screens defined in the backend DeepLinkScreen enum.
 * Returns null if the deep link data is invalid or the screen is unknown.
 */
export function resolveDeepLinkPath(deepLink: DeepLinkData): string | null {
  if (!deepLink?.screen) {
    return null;
  }

  switch (deepLink.screen) {
    case 'news_detail':
      // News article detail: /news/[id]
      if (deepLink.id) {
        return `/news/${deepLink.id}`;
      }
      return '/news';

    case 'project_detail':
      // Project detail: /projects/[id]
      if (deepLink.id) {
        return `/projects/${deepLink.id}`;
      }
      return '/projects';

    case 'portfolio':
      // Portfolio tab
      if (deepLink.params?.tab) {
        return `/portfolio?tab=${deepLink.params.tab}`;
      }
      return '/portfolio';

    case 'transaction_detail':
      // Transaction history with specific transaction highlighted
      if (deepLink.id) {
        return `/transaction-history?tx=${deepLink.id}`;
      }
      return '/transaction-history';

    case 'settings':
      // Settings tab
      if (deepLink.params?.section) {
        return `/settings?section=${deepLink.params.section}`;
      }
      return '/settings';

    case 'settings_notifications':
      // Notification settings sub-screen
      return '/settings/notification-settings';

    case 'notifications_list':
      // Notifications list
      return '/notifications';

    case 'asset_detail':
      // Asset detail: discover tab with asset code
      if (deepLink.id || deepLink.params?.code) {
        const code = (deepLink.params?.code as string) || deepLink.id;
        const issuer = deepLink.params?.issuer as string | undefined;
        const params = new URLSearchParams();
        if (code) params.set('code', code);
        if (issuer) params.set('issuer', issuer);
        return `/discover?${params.toString()}`;
      }
      return '/discover';

    case 'discover':
      // Discover tab
      return '/discover';

    default:
      console.warn(`[DeepLink] Unknown screen: ${(deepLink as DeepLinkData).screen}`);
      return null;
  }
}

/**
 * Parse a deep link from notification data payload.
 * Handles both the structured { screen, id, params } format
 * and flat formats like { type: 'alert', alertId: '...' }.
 */
export function parseDeepLinkFromData(data: Record<string, unknown>): DeepLinkData | null {
  // Structured format: data.deepLink = { screen, id, params }
  if (data.deepLink && typeof data.deepLink === 'object') {
    const dl = data.deepLink as DeepLinkData;
    if (dl.screen) {
      return dl;
    }
  }

  // Flat format: data.screen = 'news_detail', data.id = '123'
  if (data.screen && typeof data.screen === 'string') {
    return {
      screen: data.screen as DeepLinkScreen,
      id: data.id as string | undefined,
      params: data.params as Record<string, unknown> | undefined,
    };
  }

  // Legacy format: type-based routing
  if (data.type) {
    switch (data.type) {
      case 'alert':
      case 'price_alert':
        return {
          screen: 'asset_detail',
          id: (data.alertId as string) || (data.entityId as string),
          params: { code: data.code as string, issuer: data.issuer as string },
        };
      case 'transaction':
      case 'transaction_complete':
        return {
          screen: 'transaction_detail',
          id: (data.transactionId as string) || (data.entityId as string),
        };
      case 'news':
      case 'news_update':
        return {
          screen: 'news_detail',
          id: (data.newsId as string) || (data.articleId as string) || (data.entityId as string),
        };
      case 'security':
      case 'security_alert':
        return {
          screen: 'settings_notifications',
          params: data.params as Record<string, unknown>,
        };
      case 'project':
      case 'project_update':
        return {
          screen: 'project_detail',
          id: (data.projectId as string) || (data.entityId as string),
        };
      default:
        return null;
    }
  }

  return null;
}

/**
 * Navigate to a deep link using the Expo Router.
 * Returns true if navigation was successful, false otherwise.
 */
export function navigateToDeepLink(
  deepLink: DeepLinkData,
  router: { push: (href: string) => void },
): boolean {
  const path = resolveDeepLinkPath(deepLink);
  if (!path) {
    console.warn('[DeepLink] Could not resolve path for:', deepLink);
    return false;
  }

  console.log(`[DeepLink] Navigating to: ${path}`);
  router.push(path);
  return true;
}
