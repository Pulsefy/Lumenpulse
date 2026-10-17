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
import { NEWS_CACHE_KEY } from '../cache/cache.service';
import { RateLimitPolicy } from '../common/rate-limit/rate-limit.config';
import { NewsProviderService } from './news-provider.service';
import { NewsService } from './news.service';
import {
  NewsArticleDto,
  NewsSearchResponseDto,
  NewsCategoriesResponseDto,
  SingleArticleResponseDto,
  NewsArticlesPaginatedResponseDto,
} from './dto/news-article.dto';
import { resolvePagination } from '../common/pagination/pagination-response.dto';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from '../common/pagination/pagination.constants';

@ApiTags('news')
@Controller('news')
@RateLimitPolicy('newsRead')
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
  @ApiOperation({ summary: 'Get paginated latest crypto news articles' })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    example: 1,
    description: 'Page number (1-indexed)',
  })
  @ApiQuery({
    name: 'pageSize',
    required: false,
    type: Number,
    example: DEFAULT_PAGE_SIZE,
    description: `Items per page (1–${MAX_PAGE_SIZE}, default ${DEFAULT_PAGE_SIZE})`,
  })
  @ApiQuery({ name: 'lang', required: false, type: String, example: 'EN' })
  @ApiQuery({
    name: 'tag',
    required: false,
    type: String,
    example: 'stellar',
    description: 'Filter by article tag',
  })
  @ApiQuery({
    name: 'category',
    required: false,
    type: String,
    example: 'DeFi',
    description: 'Filter by article category',
  })
  @ApiResponse({ status: 200, type: NewsArticlesPaginatedResponseDto })
  async getLatestArticles(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('lang') lang?: string,
    @Query('tag') tag?: string,
    @Query('category') category?: string,
  ): Promise<NewsArticlesPaginatedResponseDto> {
    const pagination = resolvePagination(
      page ? parseInt(page, 10) : undefined,
      pageSize ? parseInt(pageSize, 10) : undefined,
    );

    let allArticles: NewsArticleDto[];
    const fetchedAt = new Date().toISOString();

    if (tag || category) {
      const articles = await this.newsService.findAll({ tag, category });
      allArticles = articles.map((a) => ({
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
      }));
    } else {
      // Fetch enough to satisfy pagination; provider is already capped at 100
      const providerResponse = await this.newsProviderService.getLatestArticles(
        {
          limit: pagination.pageSize,
          lang,
        },
      );
      allArticles = providerResponse.articles;
    }

    const total = allArticles.length;
    const pageItems = allArticles.slice(
      pagination.offset,
      pagination.offset + pagination.pageSize,
    );

    return new NewsArticlesPaginatedResponseDto(
      pageItems,
      pagination,
      total,
      fetchedAt,
    );
  }

  @Get('search')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Search news articles by keyword' })
  @ApiQuery({ name: 'q', required: true, type: String, example: 'Bitcoin ETF' })
  @ApiQuery({
    name: 'source',
    required: true,
    type: String,
    example: 'coindesk',
  })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiQuery({ name: 'lang', required: false, type: String, example: 'EN' })
  @ApiResponse({ status: 200, type: NewsSearchResponseDto })
  async searchArticles(
    @Query('q') searchString: string,
    @Query('source') sourceKey: string,
    @Query('limit') limit?: string,
    @Query('lang') lang?: string,
  ): Promise<NewsSearchResponseDto> {
    return this.newsProviderService.searchArticles({
      searchString,
      sourceKey,
      limit: limit ? parseInt(limit, 10) : undefined,
      lang,
    });
  }

  @Get('categories')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get all news categories' })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['ACTIVE', 'INACTIVE', 'ALL'],
  })
  @ApiResponse({ status: 200, type: NewsCategoriesResponseDto })
  async getCategories(
    @Query('status') status?: 'ACTIVE' | 'INACTIVE' | 'ALL',
  ): Promise<NewsCategoriesResponseDto> {
    return this.newsProviderService.getCategories({ status });
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
  @ApiOperation({ summary: 'Get paginated news for a specific cryptocurrency' })
  @ApiParam({ name: 'symbol', type: String, example: 'BTC' })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    example: 1,
    description: 'Page number (1-indexed)',
  })
  @ApiQuery({
    name: 'pageSize',
    required: false,
    type: Number,
    example: DEFAULT_PAGE_SIZE,
    description: `Items per page (1–${MAX_PAGE_SIZE}, default ${DEFAULT_PAGE_SIZE})`,
  })
  @ApiResponse({ status: 200, type: NewsArticlesPaginatedResponseDto })
  async getArticlesByCoin(
    @Param('symbol') symbol: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<NewsArticlesPaginatedResponseDto> {
    const pagination = resolvePagination(
      page ? parseInt(page, 10) : undefined,
      pageSize ? parseInt(pageSize, 10) : undefined,
    );
    const fetchedAt = new Date().toISOString();

    const response = await this.newsProviderService.getArticlesByCoin(
      symbol,
      // Fetch enough for the page; provider caps at 100
      Math.min(pagination.offset + pagination.pageSize, MAX_PAGE_SIZE),
    );

    const allArticles = response.articles;
    const total = allArticles.length;
    const pageItems = allArticles.slice(
      pagination.offset,
      pagination.offset + pagination.pageSize,
    );

    return new NewsArticlesPaginatedResponseDto(
      pageItems,
      pagination,
      total,
      fetchedAt,
    );
  }
}
