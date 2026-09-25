import {
  Controller,
  Get,
  Query,
  Param,
  HttpCode,
  HttpStatus,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiQuery,
  ApiParam,
  ApiResponse,
} from '@nestjs/swagger';
import { CacheInterceptor, CacheKey, CacheTTL } from '@nestjs/cache-manager';
import { Throttle } from '@nestjs/throttler';
import { NEWS_CACHE_KEY } from '../cache/cache.service';
import { getNewsReadThrottleOverride } from '../common/rate-limit/rate-limit.config';
import { NewsProviderService } from './news-provider.service';
import { NewsService } from './news.service';
import {
  NewsArticlesResponseDto,
  NewsSearchResponseDto,
  NewsCategoriesResponseDto,
  SingleArticleResponseDto,
} from './dto/news-article.dto';
import {
  NewsListQueryDto,
  NewsSearchQueryDto,
  NewsCategoriesQueryDto,
} from './dto/news-query.dto';
import {
  PaginationQueryDto,
  createOffsetMeta,
  DEFAULT_PAGE_SIZE,
} from '../common/pagination';

@ApiTags('news')
@Controller('news')
@Throttle(getNewsReadThrottleOverride())
export class NewsController {
  constructor(
    private readonly newsProviderService: NewsProviderService,
    private readonly newsService: NewsService,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(CacheInterceptor)
  @CacheKey(NEWS_CACHE_KEY)
  @CacheTTL(300_000)
  @ApiOperation({
    summary: 'Get latest crypto news articles',
    description:
      'Returns a page of news articles. Supports the standard pagination parameters (page, limit, cursor) and returns standard pagination metadata.',
  })
  @ApiResponse({ status: 200, type: NewsArticlesResponseDto })
  async getLatestArticles(
    @Query() query: NewsListQueryDto,
  ): Promise<NewsArticlesResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    const { tag, category, lang } = query;

    if (tag || category) {
      const { articles, total } = await this.newsService.findAll(
        { tag, category },
        { page, limit },
      );
      return {
        articles: articles.map((a) => ({
          id: a.id,
          guid: '',
          title: a.title,
          subtitle: null,
          body: '',
          url: a.url,
          imageUrl: null,
          authors: '',
          source: a.source,
          sourceKey: '',
          sourceImageUrl: null,
          categories: a.category ? [a.category] : [],
          keywords: a.tags ?? [],
          sentiment: 'NEUTRAL',
          publishedAt: a.publishedAt.toISOString(),
          relatedCoins: [],
        })),
        totalCount: total,
        fetchedAt: new Date().toISOString(),
        meta: createOffsetMeta({ page, limit, total }),
      };
    }

    return this.newsProviderService.getLatestArticles({
      limit,
      page,
      lang,
    });
  }

  @Get('search')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Search news articles by keyword',
    description:
      'Returns a page of search results. Supports the standard pagination parameters (page, limit, cursor) and returns standard pagination metadata.',
  })
  @ApiResponse({ status: 200, type: NewsSearchResponseDto })
  async searchArticles(
    @Query() query: NewsSearchQueryDto,
  ): Promise<NewsSearchResponseDto> {
    return this.newsProviderService.searchArticles({
      searchString: query.q,
      sourceKey: query.source,
      limit: query.limit ?? DEFAULT_PAGE_SIZE,
      page: query.page ?? 1,
      lang: query.lang,
    });
  }

  @Get('categories')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get all news categories',
    description:
      'Returns a page of news categories. Supports the standard pagination parameters (page, limit, cursor) and returns standard pagination metadata.',
  })
  @ApiResponse({ status: 200, type: NewsCategoriesResponseDto })
  async getCategories(
    @Query() query: NewsCategoriesQueryDto,
  ): Promise<NewsCategoriesResponseDto> {
    return this.newsProviderService.getCategories({
      status: query.status,
      page: query.page ?? 1,
      limit: query.limit ?? DEFAULT_PAGE_SIZE,
    });
  }

  @Get('sentiment-summary')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get aggregated sentiment scores across all articles',
  })
  @ApiResponse({
    status: 200,
    description: 'Overall sentiment and breakdown by source',
    schema: {
      example: {
        overall: { averageSentiment: 0.42, totalArticles: 120 },
        bySource: [
          { source: 'coindesk', averageScore: 0.65, articleCount: 40 },
          { source: 'cointelegraph', averageScore: 0.31, articleCount: 80 },
        ],
      },
    },
  })
  async sentimentSummary() {
    return this.newsService.getSentimentSummary();
  }

  @Get('article')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get single article by source and GUID' })
  @ApiQuery({
    name: 'source_key',
    required: true,
    type: String,
    example: 'coindesk',
  })
  @ApiQuery({ name: 'guid', required: true, type: String })
  @ApiResponse({ status: 200, type: SingleArticleResponseDto })
  async getArticle(
    @Query('source_key') sourceKey: string,
    @Query('guid') guid: string,
  ): Promise<SingleArticleResponseDto> {
    return this.newsProviderService.getArticle({ sourceKey, guid });
  }

  @Get('coin/:symbol')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get news for a specific cryptocurrency',
    description:
      'Returns a page of news for the given coin. Supports the standard pagination parameters (page, limit, cursor) and returns standard pagination metadata.',
  })
  @ApiParam({ name: 'symbol', type: String, example: 'BTC' })
  @ApiResponse({ status: 200, type: NewsArticlesResponseDto })
  async getArticlesByCoin(
    @Param('symbol') symbol: string,
    @Query() query: PaginationQueryDto,
  ): Promise<NewsArticlesResponseDto> {
    return this.newsProviderService.getArticlesByCoin(
      symbol,
      query.limit ?? DEFAULT_PAGE_SIZE,
      query.page ?? 1,
    );
  }
}
