import { cache, CACHE_CONFIGS } from './cache';
import { portfolioApi, stellarApi } from './api';
import { apiClient } from './api-client';
import { crowdfundApi, CrowdfundProject } from './crowdfund';
import { grantsApi, GrantRound, RoundSummary } from './grants';
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

  // Projects list with caching for offline resilience
  static async getProjects() {
    const cacheKey = 'crowdfund_projects';

    const cached = await cache.get<CrowdfundProject[]>(cacheKey, CACHE_CONFIGS.PROJECTS);
    if (
      cached &&
      (!cache.isOnlineStatus() || Date.now() - cached.timestamp < CACHE_CONFIGS.PROJECTS.ttl)
    ) {
      return { success: true, data: cached.data, fromCache: true };
    }

    if (cache.isOnlineStatus()) {
      try {
        const response = await crowdfundApi.listProjects();
        if (response.success && response.data) {
          await cache.set(cacheKey, response.data, CACHE_CONFIGS.PROJECTS);
          return { ...response, fromCache: false };
        }
      } catch (error) {
        console.warn('Failed to fetch fresh projects data:', error);
      }
    }

    if (cached) {
      return { success: true, data: cached.data, fromCache: true, isStale: true };
    }

    return { success: false, error: { message: 'No projects available offline' } };
  }

  // Single project — not cached (detail screens should always show fresh on-chain state)
  static async getProject(id: number) {
    return crowdfundApi.getProject(id);
  }

  // Grants rounds list with caching
  static async getGrantRounds() {
    const cacheKey = 'grants_rounds';

    const cached = await cache.get<GrantRound[]>(cacheKey, CACHE_CONFIGS.GRANTS);
    if (
      cached &&
      (!cache.isOnlineStatus() || Date.now() - cached.timestamp < CACHE_CONFIGS.GRANTS.ttl)
    ) {
      return { success: true, data: cached.data, fromCache: true };
    }

    if (cache.isOnlineStatus()) {
      try {
        const response = await grantsApi.listRounds();
        if (response.success && response.data) {
          await cache.set(cacheKey, response.data, CACHE_CONFIGS.GRANTS);
          return { ...response, fromCache: false };
        }
      } catch (error) {
        console.warn('Failed to fetch fresh grant rounds:', error);
      }
    }

    if (cached) {
      return { success: true, data: cached.data, fromCache: true, isStale: true };
    }

    return { success: false, error: { message: 'No grant rounds available offline' } };
  }

  // Grant round summary with caching
  static async getGrantRoundSummary(roundId: number) {
    const cacheKey = `grants_round_summary_${roundId}`;

    const cached = await cache.get<RoundSummary>(cacheKey, CACHE_CONFIGS.GRANTS);
    if (
      cached &&
      (!cache.isOnlineStatus() || Date.now() - cached.timestamp < CACHE_CONFIGS.GRANTS.ttl)
    ) {
      return { success: true, data: cached.data, fromCache: true };
    }

    if (cache.isOnlineStatus()) {
      try {
        const response = await grantsApi.getRoundSummary(roundId);
        if (response.success && response.data) {
          await cache.set(cacheKey, response.data, CACHE_CONFIGS.GRANTS);
          return { ...response, fromCache: false };
        }
      } catch (error) {
        console.warn('Failed to fetch fresh grant round summary:', error);
      }
    }

    if (cached) {
      return { success: true, data: cached.data, fromCache: true, isStale: true };
    }

    return { success: false, error: { message: 'No grant round summary available offline' } };
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
