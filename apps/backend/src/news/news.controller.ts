import {
  Controller,
  Get,
  Query,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiQuery,
  ApiParam,
  ApiResponse,
} from '@nestjs/swagger';
import { NewsProviderService } from './news-provider.service';
import {
  NewsArticlesResponseDto,
  NewsSearchResponseDto,
  NewsCategoriesResponseDto,
  SingleArticleResponseDto,
} from './dto/news-article.dto';

@ApiTags('news')
@Controller('news')
export class NewsController {
  constructor(private readonly newsProviderService: NewsProviderService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get latest crypto news articles' })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiQuery({ name: 'lang', required: false, type: String, example: 'EN' })
  @ApiResponse({ status: 200, type: NewsArticlesResponseDto })
  async getLatestArticles(
    @Query('limit') limit?: string,
    @Query('lang') lang?: string,
  ): Promise<NewsArticlesResponseDto> {
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
