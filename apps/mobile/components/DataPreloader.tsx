import { useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { CachedApi } from '../lib/cached-api';

/**
 * Component that preloads critical data for offline use
 * Should be mounted at the app level to ensure data is available
 */
export function DataPreloader() {
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    if (isAuthenticated) {
      // Preload critical data in the background
      CachedApi.preloadCriticalData().catch((error) => {
        console.warn('Failed to preload critical data:', error);
      });
    }
  }, [isAuthenticated]);

  // This component doesn't render anything
  return null;
}

/**
 * Hook to trigger data preloading manually
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
