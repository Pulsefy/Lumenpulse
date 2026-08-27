export interface RouteConfig {
  path: string;
  authRequired: boolean;
}

export const DEEP_LINK_ROUTES: Record<string, RouteConfig> = {
  receipt: { path: 'transaction-receipt', authRequired: true },
  notifications: { path: 'notifications', authRequired: true },
  grants: { path: 'grants/:id', authRequired: false },
  projects: { path: 'projects/:id', authRequired: false },
};

export function resolveDeepLink(url: string): { route: string; params: Record<string, string> } {
  try {
    const parsed = new URL(url);
    const route = parsed.pathname.replace(/^\//, '');
    return { route, params: Object.fromEntries(parsed.searchParams.entries()) };
  } catch {
    return { route: '+not-found', params: {} };
  }
}
