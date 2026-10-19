import { useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { CachedApi } from '../lib/cached-api';
import { scheduleAfterInteractive } from '../lib/defer-after-interactive';

/**
 * Preloads offline caches after first paint. Must not run on the critical path
 * to interactive (issue #1576).
 */
export function DataPreloader() {
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    const task = scheduleAfterInteractive(() => {
      void CachedApi.preloadCriticalData().catch((error) => {
        console.warn('Failed to preload critical data:', error);
      });
    });

    return () => task.cancel();
  }, [isAuthenticated]);

  return null;
}

/**
 * Hook to trigger data preloading manually (settings › cache).
 */
export function useDataPreloader() {
  const preloadData = async () => {
    await CachedApi.preloadCriticalData();
  };

  const clearCache = async () => {
    await CachedApi.clearCache();
  };

  return {
    preloadData,
    clearCache,
  };
}
