import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { HttpStatus } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { AxiosResponse, AxiosError, AxiosHeaders } from 'axios';
import { NewsProviderService } from './news-provider.service';
import {
  CoinDeskArticleListResponse,
  CoinDeskSearchResponse,
  CoinDeskCategoryListResponse,
  CoinDeskSingleArticleResponse,
} from './interfaces/coindesk-response.interface';

import { Logger } from '@nestjs/common';

jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

describe('NewsProviderService', () => {
  let service: NewsProviderService;
  let httpService: HttpService;

  const mockApiKey = 'test-api-key';

  const mockArticle = {
    TYPE: '121',
    ID: 123456,
    GUID: 'https://coindesk.com/article/123',
    PUBLISHED_ON: 1706184000,
    PUBLISHED_ON_NS: null,
    IMAGE_URL: 'https://example.com/image.jpg',
    TITLE: 'Bitcoin Reaches New Milestone',
    SUBTITLE: 'Major price movement',
    AUTHORS: 'John Doe',
    URL: 'https://coindesk.com/article/123',
    SOURCE_ID: 5,
    BODY: 'Bitcoin has reached a significant milestone...',
    KEYWORDS: 'BTC|Cryptocurrency|Market',
    LANG: 'EN',
    UPVOTES: 10,
    DOWNVOTES: 2,
    SCORE: 8,
    SENTIMENT: 'POSITIVE',
    STATUS: 'ACTIVE',
    CREATED_ON: 1706184000,
    UPDATED_ON: 1706184000,
    SOURCE_DATA: {
      TYPE: '120',
      ID: 5,
      SOURCE_KEY: 'coindesk',
      NAME: 'CoinDesk',
      IMAGE_URL: 'https://coindesk.com/logo.png',
      URL: 'https://coindesk.com',
      LANG: 'EN',
      SOURCE_TYPE: 'RSS',
      LAUNCH_DATE: 1367884800,
      SORT_ORDER: 0,
      BENCHMARK_SCORE: 71,
      STATUS: 'ACTIVE',
      LAST_UPDATED_TS: 1706184000,
      CREATED_ON: 1657730129,
      UPDATED_ON: 1706184000,
    },
    CATEGORY_DATA: [
      { TYPE: '122', ID: 14, NAME: 'BTC', CATEGORY: 'BTC' },
      { TYPE: '122', ID: 37, NAME: 'MARKET', CATEGORY: 'MARKET' },
    ],
  };

  const mockArticleListResponse: CoinDeskArticleListResponse = {
    Data: [mockArticle],
    Err: {},
  };

  const mockSearchResponse: CoinDeskSearchResponse = {
    Data: [mockArticle],
    Err: {},
  };

  const mockCategoryResponse: CoinDeskCategoryListResponse = {
    Data: [
      {
        TYPE: '122',
        ID: 14,
        NAME: 'BTC',
        STATUS: 'ACTIVE',
        CREATED_ON: 1657730110,
        UPDATED_ON: null,
      },
      {
        TYPE: '122',
        ID: 23,
        NAME: 'ETH',
        STATUS: 'ACTIVE',
        CREATED_ON: 1657730110,
        UPDATED_ON: null,
      },
    ],
    Err: {},
  };

  const mockSingleArticleResponse: CoinDeskSingleArticleResponse = {
    Data: mockArticle,
    Err: {},
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NewsProviderService,
        { provide: HttpService, useValue: { get: jest.fn() } },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) =>
              key === 'COINDESK_API_KEY' ? mockApiKey : undefined,
            ),
          },
        },
      ],
    }).compile();

    service = module.get<NewsProviderService>(NewsProviderService);
    httpService = module.get<HttpService>(HttpService);
  });

  const mockResponse = <T>(data: T): AxiosResponse<T> => ({
    data,
    status: 200,
    statusText: 'OK',
    headers: {},
    config: { headers: new AxiosHeaders() },
  });

  describe('getLatestArticles', () => {
    it('should fetch and normalize latest articles', async () => {
      jest
        .spyOn(httpService, 'get')
        .mockReturnValue(of(mockResponse(mockArticleListResponse)));

      const result = await service.getLatestArticles({ limit: 20 });

      expect(result.articles).toHaveLength(1);
      expect(result.articles[0].id).toBe('123456');
      expect(result.articles[0].title).toBe('Bitcoin Reaches New Milestone');
      expect(result.articles[0].source).toBe('CoinDesk');
      expect(result.articles[0].sourceKey).toBe('coindesk');
      expect(result.articles[0].sentiment).toBe('POSITIVE');
      expect(result.articles[0].authors).toBe('John Doe');
      expect(result.articles[0].relatedCoins).toContain('BTC');
    });

    it('should call correct endpoint with Authorization header', async () => {
      const getSpy = jest.spyOn(httpService, 'get');
      getSpy.mockReturnValue(of(mockResponse(mockArticleListResponse)));

      await service.getLatestArticles({ limit: 30, lang: 'EN' });

      expect(getSpy).toHaveBeenCalledWith(
        expect.stringContaining('/article/list'),
        expect.objectContaining({
          params: { lang: 'EN', limit: '30' },
          headers: expect.objectContaining({
            Authorization: `Apikey ${mockApiKey}`,
          }),
        }),
      );
    });
  });

  describe('searchArticles', () => {
    it('should search articles with source_key', async () => {
      const getSpy = jest.spyOn(httpService, 'get');
      getSpy.mockReturnValue(of(mockResponse(mockSearchResponse)));

      const result = await service.searchArticles({
        searchString: 'Bitcoin',
        sourceKey: 'coindesk',
      });

      expect(result.articles).toHaveLength(1);
      expect(result.searchTerm).toBe('Bitcoin');
      expect(getSpy).toHaveBeenCalledWith(
        expect.stringContaining('/search'),
        expect.objectContaining({
          params: expect.objectContaining({
            search_string: 'Bitcoin',
            source_key: 'coindesk',
          }),
        }),
      );
    });

    it('should throw error for empty search string', async () => {
      await expect(
        service.searchArticles({ searchString: '', sourceKey: 'coindesk' }),
      ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
    });

    it('should throw error for missing source_key', async () => {
      await expect(
        service.searchArticles({ searchString: 'Bitcoin', sourceKey: '' }),
      ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
    });
  });

  describe('getArticle', () => {
    it('should fetch single article', async () => {
      jest
        .spyOn(httpService, 'get')
        .mockReturnValue(of(mockResponse(mockSingleArticleResponse)));

      const result = await service.getArticle({
        sourceKey: 'coindesk',
        guid: 'https://coindesk.com/article/123',
      });

      expect(result.article).not.toBeNull();
      expect(result.article?.id).toBe('123456');
    });

    it('should return null for 404', async () => {
      const axiosError = new AxiosError('Not Found');
      axiosError.response = {
        status: 404,
        statusText: 'Not Found',
        data: {},
        headers: {},
        config: { headers: new AxiosHeaders() },
      };
      jest
        .spyOn(httpService, 'get')
        .mockReturnValue(throwError(() => axiosError));

      const result = await service.getArticle({
        sourceKey: 'coindesk',
        guid: 'not-found',
      });
      expect(result.article).toBeNull();
    });
  });

  describe('getCategories', () => {
    it('should fetch categories', async () => {
      jest
        .spyOn(httpService, 'get')
        .mockReturnValue(of(mockResponse(mockCategoryResponse)));

      const result = await service.getCategories();

      expect(result.categories).toHaveLength(2);
      expect(result.categories[0].name).toBe('BTC');
      expect(result.categories[1].name).toBe('ETH');
    });
  });

  describe('getArticlesByCoin', () => {
    it('should search with coin symbol', async () => {
      const getSpy = jest.spyOn(httpService, 'get');
      getSpy.mockReturnValue(of(mockResponse(mockSearchResponse)));

      await service.getArticlesByCoin('btc', 10);

      expect(getSpy).toHaveBeenCalledWith(
        expect.stringContaining('/search'),
        expect.objectContaining({
          params: expect.objectContaining({
            search_string: 'BTC',
            source_key: 'coindesk',
          }),
        }),
      );
    });
  });

  describe('error handling', () => {
    it('should handle 401', async () => {
      const axiosError = new AxiosError('Unauthorized');
      axiosError.response = {
        status: 401,
        statusText: 'Unauthorized',
        data: {},
        headers: {},
        config: { headers: new AxiosHeaders() },
      };
      jest
        .spyOn(httpService, 'get')
        .mockReturnValue(throwError(() => axiosError));

      await expect(service.getLatestArticles()).rejects.toMatchObject({
        status: HttpStatus.UNAUTHORIZED,
      });
    });

    it('should handle 429', async () => {
      const axiosError = new AxiosError('Too Many Requests');
      axiosError.response = {
        status: 429,
        statusText: 'Too Many Requests',
        data: {},
        headers: {},
        config: { headers: new AxiosHeaders() },
      };
      jest
        .spyOn(httpService, 'get')
        .mockReturnValue(throwError(() => axiosError));

      await expect(service.getLatestArticles()).rejects.toMatchObject({
        status: HttpStatus.TOO_MANY_REQUESTS,
      });
    });

    it('should handle timeout', async () => {
      const axiosError = new AxiosError('Timeout');
      axiosError.code = 'ECONNABORTED';
      jest
        .spyOn(httpService, 'get')
        .mockReturnValue(throwError(() => axiosError));

      await expect(service.getLatestArticles()).rejects.toMatchObject({
        status: HttpStatus.GATEWAY_TIMEOUT,
      });
    });
  });

  describe('normalization', () => {
    it('should parse CATEGORY_DATA correctly', async () => {
      jest
        .spyOn(httpService, 'get')
        .mockReturnValue(of(mockResponse(mockArticleListResponse)));

      const result = await service.getLatestArticles();

      expect(result.articles[0].categories).toContain('BTC');
      expect(result.articles[0].categories).toContain('MARKET');
    });

    it('should extract keywords from pipe-separated string', async () => {
      jest
        .spyOn(httpService, 'get')
        .mockReturnValue(of(mockResponse(mockArticleListResponse)));

      const result = await service.getLatestArticles();

      expect(result.articles[0].keywords).toContain('BTC');
      expect(result.articles[0].keywords).toContain('Cryptocurrency');
    });

    it('should include source metadata', async () => {
      jest
        .spyOn(httpService, 'get')
        .mockReturnValue(of(mockResponse(mockArticleListResponse)));

      const result = await service.getLatestArticles();

      expect(result.articles[0].sourceImageUrl).toBe(
        'https://coindesk.com/logo.png',
      );
    });
  });
});
