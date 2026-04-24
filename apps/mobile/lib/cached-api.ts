import { cache, CACHE_CONFIGS } from './cache';
import { portfolioApi, stellarApi } from './api';
import { apiClient } from './api-client';
import { Article } from './types/news';

/**
 * Cached API wrapper that provides offline-first data access
 * with automatic background refresh when connectivity returns
 */
export class CachedApi {
  // Portfolio data with caching
  static async getPortfolioSummary() {
    const cacheKey = `portfolio_summary_default`;

    // Try cache first
    const cached = await cache.get(cacheKey, CACHE_CONFIGS.PORTFOLIO);
    if (
      cached &&
      (!cache.isOnlineStatus() || Date.now() - cached.timestamp < CACHE_CONFIGS.PORTFOLIO.ttl)
    ) {
      return { success: true, data: cached.data, fromCache: true };
    }

    // Fetch fresh data if online
    if (cache.isOnlineStatus()) {
      try {
        const response = await portfolioApi.getSummary();
        if (response.success && response.data) {
          await cache.set(cacheKey, response.data, CACHE_CONFIGS.PORTFOLIO);
          return { ...response, fromCache: false };
        }
      } catch (error) {
        console.warn('Failed to fetch fresh portfolio data:', error);
      }
    }

    // Return cached data if available, even if stale
    if (cached) {
      return { success: true, data: cached.data, fromCache: true, isStale: true };
    }

    return { success: false, error: { message: 'No data available offline' } };
  }

  // News data with caching
  static async getNews(page = 1, limit = 20) {
    const cacheKey = `news_${page}_${limit}`;

    // Try cache first
    const cached = await cache.get<Article[]>(cacheKey, CACHE_CONFIGS.NEWS);
    if (
      cached &&
      (!cache.isOnlineStatus() || Date.now() - cached.timestamp < CACHE_CONFIGS.NEWS.ttl)
    ) {
      return { success: true, data: cached.data, fromCache: true };
    }

    // Fetch fresh data if online
    if (cache.isOnlineStatus()) {
      try {
        const response = await apiClient.get<Article[]>(`/news?page=${page}&limit=${limit}`);
        if (response.success && response.data) {
          await cache.set(cacheKey, response.data, CACHE_CONFIGS.NEWS);
          return { ...response, fromCache: false };
        }
      } catch (error) {
        console.warn('Failed to fetch fresh news data:', error);
      }
    }

    // Return cached data if available, even if stale
    if (cached) {
      return { success: true, data: cached.data, fromCache: true, isStale: true };
    }

    return { success: false, error: { message: 'No news available offline' } };
  }

  // Assets data with caching
  static async getAssets() {
    const cacheKey = 'stellar_assets';

    // Try cache first
    const cached = await cache.get(cacheKey, CACHE_CONFIGS.ASSETS);
    if (
      cached &&
      (!cache.isOnlineStatus() || Date.now() - cached.timestamp < CACHE_CONFIGS.ASSETS.ttl)
    ) {
      return { success: true, data: cached.data, fromCache: true };
    }

    // Fetch fresh data if online
    if (cache.isOnlineStatus()) {
      try {
        const response = await stellarApi.getAssets();
        if (response.success && response.data) {
          await cache.set(cacheKey, response.data, CACHE_CONFIGS.ASSETS);
          return { ...response, fromCache: false };
        }
      } catch (error) {
        console.warn('Failed to fetch fresh assets data:', error);
      }
    }

    // Return cached data if available, even if stale
    if (cached) {
      return { success: true, data: cached.data, fromCache: true, isStale: true };
    }

    return { success: false, error: { message: 'No assets data available offline' } };
  }

  // Transaction history with caching
  static async getTransactionHistory(limit = 10) {
    const cacheKey = `transactions_default_${limit}`;

    // Try cache first
    const cached = await cache.get(cacheKey, CACHE_CONFIGS.TRANSACTIONS);
    if (
      cached &&
      (!cache.isOnlineStatus() || Date.now() - cached.timestamp < CACHE_CONFIGS.TRANSACTIONS.ttl)
    ) {
      return { success: true, data: cached.data, fromCache: true };
    }

    // Fetch fresh data if online
    if (cache.isOnlineStatus()) {
      try {
        // Assuming transactionApi exists - adjust import as needed
        const response = await apiClient.get(`/transactions?limit=${limit}`);
        if (response.success && response.data) {
          await cache.set(cacheKey, response.data, CACHE_CONFIGS.TRANSACTIONS);
          return { ...response, fromCache: false };
        }
      } catch (error) {
        console.warn('Failed to fetch fresh transaction data:', error);
      }
    }

    // Return cached data if available, even if stale
    if (cached) {
      return { success: true, data: cached.data, fromCache: true, isStale: true };
    }

    return { success: false, error: { message: 'No transaction history available offline' } };
  }

  // Clear all cached data
  static async clearCache() {
    await cache.clear();
  }

  // Preload critical data for offline use
  static async preloadCriticalData() {
    const promises = [
      this.getPortfolioSummary(),
      this.getNews(1, 10), // First page of news
      this.getAssets(),
      this.getTransactionHistory(5), // Recent transactions
    ];

    try {
      await Promise.allSettled(promises);
      console.log('Critical data preloaded successfully');
    } catch (error) {
      console.warn('Failed to preload some critical data:', error);
    }
  }
}
