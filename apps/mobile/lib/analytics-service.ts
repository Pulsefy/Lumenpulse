import { apiClient } from './api-client';
import {
  createChartLoader,
  type ChartDataPoint,
  type ChartLoader,
  type ChartMeta,
  type ChartRangeOption,
} from './analytics';

/**
 * Query string for `GET /analytics/chart-data`.
 *
 * Exported so the exact request shape can be asserted without a network round
 * trip.
 */
export function chartDataQuery(range: ChartRangeOption, asset?: string): string {
  const parts = [
    `range=${encodeURIComponent(range.range)}`,
    `interval=${encodeURIComponent(range.interval)}`,
  ];
  if (asset) parts.push(`asset=${encodeURIComponent(asset)}`);
  return parts.join('&');
}

/** `GET /analytics/chart-meta` — the series, axis and range descriptors. */
export async function fetchChartMeta(): Promise<ChartMeta> {
  const response = await apiClient.get<ChartMeta>('/analytics/chart-meta');
  if (response.success && response.data) return response.data;
  throw new Error(response.error?.message ?? 'Could not load the chart description');
}

/** `GET /analytics/chart-data` — bucketed values for one range. */
export async function fetchChartData(
  range: ChartRangeOption,
  asset?: string,
): Promise<ChartDataPoint[]> {
  const response = await apiClient.get<ChartDataPoint[]>(
    `/analytics/chart-data?${chartDataQuery(range, asset)}`,
  );
  if (response.success && response.data) return response.data;
  throw new Error(response.error?.message ?? 'Could not load the chart data');
}

/**
 * Module-level loader in front of the analytics endpoints.
 *
 * Switching tabs unmounts the portfolio screen but not the module, so the
 * selected range is served from the loader's cache instead of hitting the
 * network again. Concurrent callers share one request, and a failed request is
 * evicted so the retry button really retries.
 */
export const portfolioChartLoader: ChartLoader = createChartLoader({
  fetchMeta: fetchChartMeta,
  fetchData: (range) => fetchChartData(range),
});
