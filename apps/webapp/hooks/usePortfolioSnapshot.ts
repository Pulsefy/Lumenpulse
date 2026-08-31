import { useState, useEffect, useCallback, useRef } from 'react';
import {
  PortfolioApiService,
  PortfolioSummaryResponse,
  PortfolioPerformanceResponse,
  AllocationAsset,
} from '../lib/api-services';

/** How long (in ms) a snapshot is considered fresh. */
const FRESHNESS_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

export interface PortfolioSnapshotState {
  summary: PortfolioSummaryResponse | null;
  performance: PortfolioPerformanceResponse | null;
  allocation: AllocationAsset[] | null;
  isLoading: boolean;
  /** Summary-specific error surfaced when no summary data is available. */
  summaryError: string | null;
  /** Performance-specific error surfaced when no performance data is available. */
  performanceError: string | null;
  /**
   * True when `summary.lastUpdated` is within the freshness threshold.
   * Null when there is no data yet.
   */
  isFresh: boolean | null;
  /** Computed from summary.lastUpdated � human-readable relative time string. */
  lastUpdatedLabel: string | null;
  /** Manually re-fetch all portfolio data. */
  refresh: () => void;
}

/**
 * Fetches portfolio summary + performance in parallel from the backend.
 *
 * - Skips fetching when `publicKey` is null (no wallet connected).
 * - Also skips when no `auth-token` cookie is present (unauthenticated visitor).
 * - Exposes `isFresh` so cards can show a staleness badge.
 * - `refresh()` allows a manual re-fetch without remounting.
 */
export function usePortfolioSnapshot(publicKey: string | null): PortfolioSnapshotState {
  const [summary, setSummary] = useState<PortfolioSummaryResponse | null>(null);
  const [performance, setPerformance] = useState<PortfolioPerformanceResponse | null>(null);
  const [allocation, setAllocation] = useState<AllocationAsset[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [performanceError, setPerformanceError] = useState<string | null>(null);

  // A counter bump triggers a re-fetch without changing publicKey.
  const [fetchTrigger, setFetchTrigger] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // No wallet � clear everything and stay idle.
    if (!publicKey) {
      setSummary(null);
      setPerformance(null);
      setAllocation(null);
      setSummaryError(null);
      setPerformanceError(null);
      setIsLoading(false);
      return;
    }

    // No auth token � show "not signed in" state, don't hit 401s.
    if (!PortfolioApiService.isAuthenticated()) {
      setSummary(null);
      setPerformance(null);
      setAllocation(null);
      setSummaryError(null);
      setPerformanceError(null);
      setIsLoading(false);
      return;
    }

    // Cancel any in-flight request before starting a new one.
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    let cancelled = false;
    setIsLoading(true);
    setSummaryError(null);
    setPerformanceError(null);

    Promise.allSettled([
      PortfolioApiService.getSummary('USD', abortRef.current.signal),
      PortfolioApiService.getPerformance(abortRef.current.signal),
      PortfolioApiService.getAllocation(abortRef.current.signal),
    ])
      .then(([summaryResult, performanceResult, allocationResult]) => {
        if (cancelled) {
          return;
        }

        if (summaryResult.status === 'fulfilled') {
          setSummary(summaryResult.value);
          setSummaryError(null);
        } else if ((summaryResult.reason as { name?: string } | undefined)?.name !== 'AbortError') {
          const message =
            summaryResult.reason instanceof Error
              ? summaryResult.reason.message
              : 'Failed to load portfolio summary';
          setSummaryError(message);
        }

        if (performanceResult.status === 'fulfilled') {
          setPerformance(performanceResult.value);
          setPerformanceError(null);
        } else if (
          (performanceResult.reason as { name?: string } | undefined)?.name !== 'AbortError'
        ) {
          const message =
            performanceResult.reason instanceof Error
              ? performanceResult.reason.message
              : 'Failed to load portfolio performance';
          setPerformanceError(message);
        }

        if (allocationResult.status === 'fulfilled') {
          setAllocation(allocationResult.value);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : 'Failed to load portfolio data';
        setSummaryError((prev) => prev ?? message);
        setPerformanceError((prev) => prev ?? message);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  // fetchTrigger in deps allows manual refresh without changing publicKey.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKey, fetchTrigger]);

  const refresh = useCallback(() => {
    setFetchTrigger((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!publicKey || !PortfolioApiService.isAuthenticated()) {
      return;
    }

    const handleFocusRefresh = () => {
      refresh();
    };

    const handleVisibilityRefresh = () => {
      if (document.visibilityState === 'visible') {
        refresh();
      }
    };

    window.addEventListener('focus', handleFocusRefresh);
    document.addEventListener('visibilitychange', handleVisibilityRefresh);

    return () => {
      window.removeEventListener('focus', handleFocusRefresh);
      document.removeEventListener('visibilitychange', handleVisibilityRefresh);
    };
  }, [publicKey, refresh]);

  // Derived values
  const isFresh: boolean | null = (() => {
    if (!summary?.lastUpdated) return null;
    const age = Date.now() - new Date(summary.lastUpdated).getTime();
    return age < FRESHNESS_THRESHOLD_MS;
  })();

  const lastUpdatedLabel: string | null = (() => {
    if (!summary?.lastUpdated) return null;
    const diffMs = Date.now() - new Date(summary.lastUpdated).getTime();
    const diffMin = Math.floor(diffMs / 60_000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin} min ago`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h ago`;
    return `${Math.floor(diffH / 24)}d ago`;
  })();

  return {
    summary,
    performance,
    allocation,
    isLoading,
    summaryError,
    performanceError,
    isFresh,
    lastUpdatedLabel,
    refresh,
  };
}
