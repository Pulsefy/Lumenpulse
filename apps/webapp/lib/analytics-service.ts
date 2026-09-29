import type { components } from '@/generated/openapi-types';
import { clientConfig } from '@/lib/config';

export type ChartMeta = components['schemas']['ChartMetaDto'];
export type ChartDataPoint = components['schemas']['ChartDataPointDto'];
export type ChartRangeOption = components['schemas']['ChartRangeOptionDto'];

/** Daily snapshots change at most hourly, so a short TTL avoids stale charts without refetching on every range switch. */
const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry<T> {
  expiresAt: number;
  promise: Promise<T>;
}

const cache = new Map<string, CacheEntry<unknown>>();

/**
 * Returns the cached promise for `key`, or starts `load` and caches it.
 * Concurrent callers share one request; failed requests are evicted so the
 * next call retries.
 */
function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key) as CacheEntry<T> | undefined;
  if (hit && hit.expiresAt > Date.now()) return hit.promise;

  const promise = load().catch((error) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, promise });
  return promise;
}

/** Test hook: drop every cached analytics response. */
export function clearAnalyticsCache(): void {
  cache.clear();
}

async function getJson<T>(path: string, what: string): Promise<T> {
  const response = await fetch(`${clientConfig.apiUrl}${path}`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Failed to load ${what}: ${response.statusText || response.status}`);
  }
  return response.json();
}

export class AnalyticsApiService {
  static getChartMeta(): Promise<ChartMeta> {
    return cached('meta', () => getJson<ChartMeta>('/analytics/chart-meta', 'chart metadata'));
  }

  static getChartData(
    range: ChartRangeOption['range'],
    interval: ChartRangeOption['interval'],
  ): Promise<ChartDataPoint[]> {
    const query = new URLSearchParams({ range, interval }).toString();
    return cached(`data:${query}`, () =>
      getJson<ChartDataPoint[]>(`/analytics/chart-data?${query}`, 'chart data'),
    );
  }
}
