import { Injectable, Logger } from '@nestjs/common';

/**
 * Descriptor for a single route/query that the preloader should warm.
 * The `loader` is the async function that produces the value to cache.
 */
export interface WarmCacheRoute {
  /** Human-readable name used in logs and metrics labels. */
  name: string;
  /** Cache key under which the result is stored. */
  cacheKey: string;
  /** TTL in milliseconds for the cached entry. */
  ttlMs: number;
  /** Async function that fetches (or computes) the response to cache. */
  loader: () => Promise<unknown>;
}

/**
 * Result of a single route preload attempt.
 */
export interface PreloadResult {
  route: string;
  cacheKey: string;
  success: boolean;
  durationMs: number;
  error?: string;
}

/**
 * Aggregated output of a full warm-cache refresh cycle.
 */
export interface WarmCacheReport {
  triggeredAt: string;
  totalRoutes: number;
  succeeded: number;
  failed: number;
  skipped: number;
  durationMs: number;
  results: PreloadResult[];
}

@Injectable()
export class WarmCacheRegistry {
  private readonly logger = new Logger(WarmCacheRegistry.name);
  private readonly routes = new Map<string, WarmCacheRoute>();

  /**
   * Register a route/query with the preloader. Idempotent by cacheKey.
   */
  register(route: WarmCacheRoute): void {
    if (this.routes.has(route.cacheKey)) {
      this.logger.warn(
        `WarmCacheRegistry: duplicate registration for key "${route.cacheKey}" (${route.name}) — overwriting.`,
      );
    }
    this.routes.set(route.cacheKey, route);
    this.logger.debug(
      `Registered warm-cache route "${route.name}" → key "${route.cacheKey}" (TTL ${route.ttlMs}ms)`,
    );
  }

  getAll(): WarmCacheRoute[] {
    return Array.from(this.routes.values());
  }

  getByKey(cacheKey: string): WarmCacheRoute | undefined {
    return this.routes.get(cacheKey);
  }
}
