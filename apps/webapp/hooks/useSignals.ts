import { useState, useEffect, useCallback, useRef } from 'react';
import { SignalsApiService, UserSignalsResponse } from '../lib/signals-service';

const FRESHNESS_THRESHOLD_MS = 60 * 60 * 1000;

export interface SignalsState {
  data: UserSignalsResponse | null;
  isLoading: boolean;
  error: string | null;
  isFresh: boolean | null;
  ageLabel: string | null;
  isAuthenticated: boolean;
  refresh: () => void;
}

export function useSignals(): SignalsState {
  const [data, setData] = useState<UserSignalsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [fetchTrigger, setFetchTrigger] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!SignalsApiService.isAuthenticated()) {
      setData(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    SignalsApiService.getLatestSignals(abortRef.current.signal)
      .then((response) => {
        if (cancelled) return;
        setData(response);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if ((err as { name?: string } | undefined)?.name === 'AbortError') return;
        const message =
          err instanceof Error ? err.message : 'Failed to load signals';
        setError(message);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, [fetchTrigger]);

  const refresh = useCallback(() => {
    setFetchTrigger((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!SignalsApiService.isAuthenticated()) return;

    const handleFocusRefresh = () => refresh();
    const handleVisibilityRefresh = () => {
      if (document.visibilityState === 'visible') refresh();
    };

    window.addEventListener('focus', handleFocusRefresh);
    document.addEventListener('visibilitychange', handleVisibilityRefresh);

    return () => {
      window.removeEventListener('focus', handleFocusRefresh);
      document.removeEventListener('visibilitychange', handleVisibilityRefresh);
    };
  }, [refresh]);

  const isFresh: boolean | null = (() => {
    if (!data?.generatedAt) return null;
    const age = Date.now() - new Date(data.generatedAt).getTime();
    return age < FRESHNESS_THRESHOLD_MS;
  })();

  const ageLabel: string | null = (() => {
    if (!data?.generatedAt) return null;
    const diffMs = Date.now() - new Date(data.generatedAt).getTime();
    const diffMin = Math.floor(diffMs / 60_000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin} min ago`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h ago`;
    return `${Math.floor(diffH / 24)}d ago`;
  })();

  const isAuthenticated = SignalsApiService.isAuthenticated();

  return { data, isLoading, error, isFresh, ageLabel, isAuthenticated, refresh };
}
