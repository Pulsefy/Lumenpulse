import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom, catchError, timeout } from 'rxjs';
import { AxiosError, AxiosRequestConfig } from 'axios';
import {
  NewsArticleDto,
  NewsArticlesResponseDto,
  NewsSearchResponseDto,
  NewsCategoriesResponseDto,
  NewsCategoryDto,
  SingleArticleResponseDto,
} from './dto/news-article.dto';
import {
  CoinDeskArticle,
  CoinDeskArticleListResponse,
  CoinDeskSearchResponse,
  CoinDeskCategoryListResponse,
  CoinDeskSingleArticleResponse,
  CoinDeskCategory,
} from './interfaces/coindesk-response.interface';

export interface LatestArticlesOptions {
  limit?: number;
  lang?: string;
}

export interface SearchArticlesOptions {
  searchString: string;
  sourceKey: string;
  lang?: string;
  limit?: number;
}

export interface GetArticleOptions {
  sourceKey: string;
  guid: string;
}

export interface ListCategoriesOptions {
  status?: 'ACTIVE' | 'INACTIVE' | 'ALL';
}

@Injectable()
export class NewsProviderService {
  private readonly logger = new Logger(NewsProviderService.name);
  private readonly baseUrl = 'https://data-api.coindesk.com/news/v1';
  private readonly defaultTimeout = 15000;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  async getLatestArticles(
    options: LatestArticlesOptions = {},
  ): Promise<NewsArticlesResponseDto> {
    const { limit = 20, lang = 'EN' } = options;

    const params: Record<string, string> = {
      lang,
      limit: Math.min(limit, 100).toString(),
    };

    const response = await this.makeRequest<CoinDeskArticleListResponse>(
      '/article/list',
      params,
    );

    const articles = this.normalizeArticles(response.Data || []);

    return {
      articles,
      totalCount: articles.length,
      fetchedAt: new Date().toISOString(),
    };
  }

  async searchArticles(
    options: SearchArticlesOptions,
  ): Promise<NewsSearchResponseDto> {
    const { searchString, sourceKey, lang = 'EN', limit = 20 } = options;

    if (!searchString?.trim()) {
      throw new HttpException(
        'Search string is required',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!sourceKey?.trim()) {
      throw new HttpException(
        'Source key is required for search',
        HttpStatus.BAD_REQUEST,
      );
    }

    const params: Record<string, string> = {
      search_string: searchString.trim(),
      source_key: sourceKey.trim(),
      lang,
      limit: Math.min(limit, 100).toString(),
    };

    const response = await this.makeRequest<CoinDeskSearchResponse>(
      '/search',
      params,
    );

    const articles = this.normalizeArticles(response.Data || []);

    return {
      articles,
      searchTerm: searchString,
      totalCount: articles.length,
      fetchedAt: new Date().toISOString(),
    };
  }

  async getArticle(
    options: GetArticleOptions,
  ): Promise<SingleArticleResponseDto> {
    const { sourceKey, guid } = options;

    if (!sourceKey || !guid) {
      throw new HttpException(
        'Source key and GUID are required',
        HttpStatus.BAD_REQUEST,
      );
    }

    const params: Record<string, string> = {
      source_key: sourceKey,
      guid,
    };

    try {
      const response = await this.makeRequest<CoinDeskSingleArticleResponse>(
        '/article/get',
        params,
      );

      const article = response.Data
        ? this.normalizeArticle(response.Data)
        : null;

      return {
        article,
        fetchedAt: new Date().toISOString(),
      };
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === 404) {
        return { article: null, fetchedAt: new Date().toISOString() };
      }
      throw error;
    }
  }

  async getCategories(
    options: ListCategoriesOptions = {},
  ): Promise<NewsCategoriesResponseDto> {
    const { status = 'ACTIVE' } = options;

    const params: Record<string, string> = { status };

    const response = await this.makeRequest<CoinDeskCategoryListResponse>(
      '/category/list',
      params,
    );

    const categories = this.normalizeCategories(response.Data || []);

    return {
      categories,
      totalCount: categories.length,
      fetchedAt: new Date().toISOString(),
    };
  }

  async getArticlesByCoin(
    symbol: string,
    limit = 10,
  ): Promise<NewsArticlesResponseDto> {
    const result = await this.searchArticles({
      searchString: symbol.toUpperCase(),
      sourceKey: 'coindesk',
      limit,
    });

    return {
      articles: result.articles,
      totalCount: result.totalCount,
      fetchedAt: result.fetchedAt,
    };
  }

  private async makeRequest<T>(
    endpoint: string,
    params: Record<string, string>,
  ): Promise<T> {
    const apiKey = this.configService.get<string>('COINDESK_API_KEY');

    if (!apiKey) {
      this.logger.warn('COINDESK_API_KEY not configured');
    }

    const config: AxiosRequestConfig = {
      params,
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey && { Authorization: `Apikey ${apiKey}` }),
      },
    };

    try {
      const response = await firstValueFrom(
        this.httpService.get<T>(`${this.baseUrl}${endpoint}`, config).pipe(
          timeout(this.defaultTimeout),
          catchError((error: AxiosError) => {
            this.handleAxiosError(error);
            throw error;
          }),
        ),
      );

      if (!response.data) {
        throw new HttpException(
          'Empty response from provider',
          HttpStatus.BAD_GATEWAY,
        );
      }

      return response.data;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error(
        `Request error: ${error instanceof Error ? error.message : 'Unknown'}`,
      );
      throw new HttpException(
        'Failed to fetch from provider',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private normalizeArticles(rawArticles: CoinDeskArticle[]): NewsArticleDto[] {
    if (!Array.isArray(rawArticles)) {
      this.logger.warn('Received non-array data');
      return [];
    }
    return rawArticles.map((article) => this.normalizeArticle(article));
  }

  private normalizeArticle(raw: CoinDeskArticle): NewsArticleDto {
    const categories = (raw.CATEGORY_DATA || []).map((cat) => cat.NAME);
    const keywords = raw.KEYWORDS
      ? raw.KEYWORDS.split('|')
          .map((k) => k.trim())
          .filter(Boolean)
      : [];

    const coinSymbols = this.extractCoinSymbols([...categories, ...keywords]);

    return {
      id: raw.ID?.toString() || '',
      guid: raw.GUID || '',
      title: raw.TITLE || '',
      subtitle: raw.SUBTITLE || null,
      body: raw.BODY || '',
      url: raw.URL || '',
      imageUrl: raw.IMAGE_URL || null,
      authors: raw.AUTHORS || '',
      source: raw.SOURCE_DATA?.NAME || '',
      sourceKey: raw.SOURCE_DATA?.SOURCE_KEY || '',
      sourceImageUrl: raw.SOURCE_DATA?.IMAGE_URL || null,
      categories,
      keywords,
      sentiment: raw.SENTIMENT || 'NEUTRAL',
      publishedAt: raw.PUBLISHED_ON
        ? new Date(raw.PUBLISHED_ON * 1000).toISOString()
        : new Date().toISOString(),
      relatedCoins: coinSymbols,
    };
  }

  private normalizeCategories(
    rawCategories: CoinDeskCategory[],
  ): NewsCategoryDto[] {
    if (!Array.isArray(rawCategories)) return [];
    return rawCategories.map((cat) => ({
      id: cat.ID?.toString() || '',
      name: cat.NAME || '',
      status: cat.STATUS || '',
    }));
  }

  private extractCoinSymbols(items: string[]): string[] {
    const knownSymbols = new Set([
      'BTC',
      'ETH',
      'XRP',
      'SOL',
      'ADA',
      'DOGE',
      'DOT',
      'MATIC',
      'LINK',
      'UNI',
      'AVAX',
      'ATOM',
      'LTC',
      'XLM',
      'ALGO',
      'VET',
      'FIL',
      'NEAR',
      'APT',
      'ARB',
      'OP',
      'USDT',
      'USDC',
      'BNB',
      'TRX',
      'SHIB',
      'TON',
      'SUI',
      'SEI',
      'INJ',
      'BITCOIN',
      'ETHEREUM',
      'SOLANA',
      'CARDANO',
      'POLKADOT',
      'POLYGON',
    ]);

    const symbolMap: Record<string, string> = {
      BITCOIN: 'BTC',
      ETHEREUM: 'ETH',
      SOLANA: 'SOL',
      CARDANO: 'ADA',
      POLKADOT: 'DOT',
      POLYGON: 'MATIC',
    };

    const found: string[] = [];
    for (const item of items) {
      const upper = item.toUpperCase();
      if (knownSymbols.has(upper)) {
        found.push(symbolMap[upper] || upper);
      }
    }
    return [...new Set(found)];
  }

  private handleAxiosError(error: AxiosError): never {
    const status = error.response?.status;
    this.logger.error(`API error: ${status || 'unknown'} - ${error.message}`);

    if (status === 401 || status === 403) {
      throw new HttpException(
        'Invalid or missing API key',
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (status === 404) {
      throw new HttpException('Resource not found', HttpStatus.NOT_FOUND);
    }
    if (status === 429) {
      throw new HttpException(
        'Rate limit exceeded',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (status && status >= 500) {
      throw new HttpException('Provider unavailable', HttpStatus.BAD_GATEWAY);
    }
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      throw new HttpException('Request timed out', HttpStatus.GATEWAY_TIMEOUT);
    }
    throw new HttpException(
      'Failed to communicate with provider',
      HttpStatus.BAD_GATEWAY,
    );
  }
}
