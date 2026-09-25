import { Injectable } from '@nestjs/common';
import { CacheService } from '../cache/cache.service';
import { NewsArticlesResponseDto } from '../news/dto/news-article.dto';
import { NewsProviderService } from '../news/news-provider.service';
import { PortfolioService } from '../portfolio/portfolio.service';
import { SignalsService } from '../signals/signals.service';
import { WatchlistResponseDto } from '../watchlist/dto/watchlist.dto';
import { WatchlistService } from '../watchlist/watchlist.service';
import { UserSignalsResponseDto } from '../signals/dto/signals.dto';

const DASHBOARD_CACHE_TTL_MS = 15_000;

type Section<T> = {
  data: T | null;
  error: 'unavailable' | null;
};

export interface DashboardResponse {
  generatedAt: string;
  cacheTtlMs: number;
  portfolio: Section<{
    summary: Awaited<ReturnType<PortfolioService['getPortfolioSummary']>>;
    performance: Awaited<
      ReturnType<PortfolioService['getPortfolioPerformance']>
    >;
    allocation: Awaited<ReturnType<PortfolioService['getAssetAllocation']>>;
  }>;
  watchlist: Section<WatchlistResponseDto>;
  signals: Section<UserSignalsResponseDto>;
  news: Section<NewsArticlesResponseDto>;
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly cacheService: CacheService,
    private readonly portfolioService: PortfolioService,
    private readonly watchlistService: WatchlistService,
    private readonly signalsService: SignalsService,
    private readonly newsProviderService: NewsProviderService,
  ) {}

  async getDashboard(userId: string): Promise<DashboardResponse> {
    const cacheKey = `dashboard:v1:${userId}`;
    return this.cacheService.getOrSet(
      cacheKey,
      () => this.loadDashboard(userId),
      DASHBOARD_CACHE_TTL_MS,
    );
  }

  private async loadDashboard(userId: string): Promise<DashboardResponse> {
    const [summary, performance, allocation, watchlist, signals, news] =
      await Promise.allSettled([
        this.portfolioService.getPortfolioSummary(userId),
        this.portfolioService.getPortfolioPerformance(userId),
        this.portfolioService.getAssetAllocation(userId),
        this.watchlistService.getWatchlist(userId),
        this.signalsService.getLatestSignals(userId),
        this.newsProviderService.getLatestArticles({ limit: 5, lang: 'EN' }),
      ]);

    const portfolio = this.combinePortfolio(summary, performance, allocation);
    return {
      generatedAt: new Date().toISOString(),
      cacheTtlMs: DASHBOARD_CACHE_TTL_MS,
      portfolio,
      watchlist: this.section(watchlist),
      signals: this.section(signals),
      news: this.section(news),
    };
  }

  private combinePortfolio(
    summary: PromiseSettledResult<
      Awaited<ReturnType<PortfolioService['getPortfolioSummary']>>
    >,
    performance: PromiseSettledResult<
      Awaited<ReturnType<PortfolioService['getPortfolioPerformance']>>
    >,
    allocation: PromiseSettledResult<
      Awaited<ReturnType<PortfolioService['getAssetAllocation']>>
    >,
  ): DashboardResponse['portfolio'] {
    if (
      summary.status === 'fulfilled' &&
      performance.status === 'fulfilled' &&
      allocation.status === 'fulfilled'
    ) {
      return {
        data: {
          summary: summary.value,
          performance: performance.value,
          allocation: allocation.value,
        },
        error: null,
      };
    }

    return { data: null, error: 'unavailable' };
  }

  private section<T>(result: PromiseSettledResult<T>): Section<T> {
    return result.status === 'fulfilled'
      ? { data: result.value, error: null }
      : { data: null, error: 'unavailable' };
  }
}
