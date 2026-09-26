import { useEffect, useState } from 'react';
import {
  AnalyticsApiService,
  ChartDataPoint,
  ChartMeta,
  ChartRangeOption,
} from '../lib/analytics-service';

export interface AnalyticsChartState {
  meta: ChartMeta | null;
  /** Currently selected range option, defaults to the first one the API offers. */
  selectedRange: ChartRangeOption | null;
  selectRange: (range: ChartRangeOption['range']) => void;
  points: ChartDataPoint[] | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * Loads chart metadata once, then the data for the selected range.
 * Responses are cached per range in AnalyticsApiService, so switching back to
 * a range already viewed renders without a network request.
 */
export function useAnalyticsChart(): AnalyticsChartState {
  const [meta, setMeta] = useState<ChartMeta | null>(null);
  const [rangeKey, setRangeKey] = useState<ChartRangeOption['range'] | null>(null);
  const [points, setPoints] = useState<ChartDataPoint[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    AnalyticsApiService.getChartMeta()
      .then((value) => {
        if (cancelled) return;
        setMeta(value);
        setRangeKey((current) => current ?? value.ranges[0]?.range ?? null);
        if (value.ranges.length === 0) setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load chart metadata');
        setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedRange = meta?.ranges.find((r) => r.range === rangeKey) ?? null;

  useEffect(() => {
    if (!selectedRange) return;
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    AnalyticsApiService.getChartData(selectedRange.range, selectedRange.interval)
      .then((value) => {
        if (!cancelled) setPoints(value);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setPoints(null);
        setError(err instanceof Error ? err.message : 'Failed to load chart data');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Range and interval fully identify the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRange?.range, selectedRange?.interval]);

  return {
    meta,
    selectedRange,
    selectRange: setRangeKey,
    points,
    isLoading,
    error,
  };
}
