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
import { NewsProviderService } from './news-provider.service';
import { NewsService } from './news.service';
import {
  NewsArticlesResponseDto,
  NewsSearchResponseDto,
  NewsCategoriesResponseDto,
  SingleArticleResponseDto,
} from './dto/news-article.dto';

@ApiTags('news')
@Controller('news')
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
  @ApiOperation({ summary: 'Get latest crypto news articles' })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
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
  @ApiResponse({ status: 200, type: NewsArticlesResponseDto })
  async getLatestArticles(
    @Query('limit') limit?: string,
    @Query('lang') lang?: string,
    @Query('tag') tag?: string,
    @Query('category') category?: string,
  ): Promise<NewsArticlesResponseDto> {
    if (tag || category) {
      const articles = await this.newsService.findAll({ tag, category });
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
        totalCount: articles.length,
        fetchedAt: new Date().toISOString(),
      };
    }

    return this.newsProviderService.getLatestArticles({
      limit: limit ? parseInt(limit, 10) : undefined,
      lang,
    });
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
  @ApiOperation({ summary: 'Get news for a specific cryptocurrency' })
  @ApiParam({ name: 'symbol', type: String, example: 'BTC' })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 10 })
  @ApiResponse({ status: 200, type: NewsArticlesResponseDto })
  async getArticlesByCoin(
    @Param('symbol') symbol: string,
    @Query('limit') limit?: string,
  ): Promise<NewsArticlesResponseDto> {
    return this.newsProviderService.getArticlesByCoin(
      symbol,
      limit ? parseInt(limit, 10) : undefined,
    );
  }
}
