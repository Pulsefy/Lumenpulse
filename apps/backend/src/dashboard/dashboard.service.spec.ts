import { DashboardService } from './dashboard.service';

describe('DashboardService', () => {
  const summary = {
    totalValueUsd: '100.00',
    assets: [],
    lastUpdated: null,
    hasLinkedAccount: true,
  };
  const performance = {
    userId: 'user-1',
    currentValueUsd: 100,
    calculatedAt: new Date(),
    windows: [],
  };
  const allocation = { totalValueUsd: 100, allocation: [] };
  const watchlist = { items: [], total: 0 };
  const signals = { userId: 'user-1', generatedAt: new Date(), signals: [] };
  const news = {
    articles: [],
    totalCount: 0,
    fetchedAt: new Date().toISOString(),
  };

  function createService() {
    const cacheService = {
      getOrSet: jest.fn(async (_key: string, loader: () => Promise<unknown>) =>
        loader(),
      ),
    };
    const portfolioService = {
      getPortfolioSummary: jest.fn().mockResolvedValue(summary),
      getPortfolioPerformance: jest.fn().mockResolvedValue(performance),
      getAssetAllocation: jest.fn().mockResolvedValue(allocation),
    };
    const watchlistService = {
      getWatchlist: jest.fn().mockResolvedValue(watchlist),
    };
    const signalsService = {
      getLatestSignals: jest.fn().mockResolvedValue(signals),
    };
    const newsProviderService = {
      getLatestArticles: jest.fn().mockResolvedValue(news),
    };

    return {
      service: new DashboardService(
        cacheService as never,
        portfolioService as never,
        watchlistService as never,
        signalsService as never,
        newsProviderService as never,
      ),
      cacheService,
      portfolioService,
      watchlistService,
      signalsService,
      newsProviderService,
    };
  }

  it('loads all dashboard sections concurrently and caches the response per user', async () => {
    const {
      service,
      cacheService,
      portfolioService,
      watchlistService,
      signalsService,
      newsProviderService,
    } = createService();

    const result = await service.getDashboard('user-1');

    expect(cacheService.getOrSet).toHaveBeenCalledWith(
      'dashboard:v1:user-1',
      expect.any(Function),
      15_000,
    );
    expect(portfolioService.getPortfolioSummary).toHaveBeenCalledWith('user-1');
    expect(portfolioService.getPortfolioPerformance).toHaveBeenCalledWith(
      'user-1',
    );
    expect(portfolioService.getAssetAllocation).toHaveBeenCalledWith('user-1');
    expect(watchlistService.getWatchlist).toHaveBeenCalledWith('user-1');
    expect(signalsService.getLatestSignals).toHaveBeenCalledWith('user-1');
    expect(newsProviderService.getLatestArticles).toHaveBeenCalledWith({
      limit: 5,
      lang: 'EN',
    });
    expect(result.portfolio).toEqual({
      data: { summary, performance, allocation },
      error: null,
    });
    expect(result.watchlist).toEqual({ data: watchlist, error: null });
  });

  it('keeps healthy sections when one dependency fails', async () => {
    const { service, portfolioService, newsProviderService } = createService();
    portfolioService.getPortfolioPerformance.mockRejectedValue(
      new Error('snapshot unavailable'),
    );
    newsProviderService.getLatestArticles.mockRejectedValue(
      new Error('provider unavailable'),
    );

    const result = await service.getDashboard('user-1');

    expect(result.portfolio).toEqual({ data: null, error: 'unavailable' });
    expect(result.news).toEqual({ data: null, error: 'unavailable' });
    expect(result.watchlist).toEqual({ data: watchlist, error: null });
    expect(result.signals).toEqual({ data: signals, error: null });
  });
});
