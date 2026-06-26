import { useCallback, useEffect, useState } from 'react';
import { DeviceEventEmitter } from 'react-native';
import { cache, CacheConfig } from '../lib/cache';

export interface UseCachedDataOptions<T> extends CacheConfig {
  key: string;
  fetcher: () => Promise<T>;
  enabled?: boolean;
  onError?: (error: Error) => void;
}

export interface UseCachedDataResult<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  isStale: boolean;
  lastUpdated: number | null;
}

export function useCachedData<T>({
  key,
  fetcher,
  enabled = true,
  onError,
  ...cacheConfig
}: UseCachedDataOptions<T>): UseCachedDataResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isStale, setIsStale] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  const fetchData = useCallback(
    async (forceRefresh = false) => {
      if (!enabled) return;

      setLoading(true);
      setError(null);

      try {
        // Try to get cached data first (unless forcing refresh)
        if (!forceRefresh) {
          const cached = await cache.get<T>(key, cacheConfig);
          if (cached) {
            setData(cached.data);
            setLastUpdated(cached.timestamp);

            // Check if data is stale
            const now = Date.now();
            const isDataStale = now > cached.timestamp + cacheConfig.ttl;
            setIsStale(isDataStale);

            // If not stale or offline, we're done
            if (!isDataStale || !cache.isOnlineStatus()) {
              setLoading(false);
              return;
            }
          }
        }

        // Fetch fresh data
        if (cache.isOnlineStatus()) {
          const freshData = await fetcher();
          await cache.set(key, freshData, cacheConfig);
          setData(freshData);
          setLastUpdated(Date.now());
          setIsStale(false);
        } else if (!data) {
          // No cached data and offline
          throw new Error('No internet connection and no cached data available');
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Unknown error');
        setError(error);
        onError?.(error);
      } finally {
        setLoading(false);
      }
    },
    [key, fetcher, enabled, cacheConfig, onError, data],
  );

  const refresh = useCallback(() => fetchData(true), [fetchData]);

  // Listen for cache refresh events
  useEffect(() => {
    const handleCacheRefresh = (event: { key: string }) => {
      if (event.key === key) {
        fetchData(true);
      }
    };

    const subscription = DeviceEventEmitter.addListener('cache-refresh', handleCacheRefresh);
    return () => {
      subscription.remove();
    };
  }, [key, fetchData]);

  // Initial fetch
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    data,
    loading,
    error,
    refresh,
    isStale,
    lastUpdated,
  };
}
