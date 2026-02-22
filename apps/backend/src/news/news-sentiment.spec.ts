import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { AxiosResponse } from 'axios';
import { News } from './news.entity';
import { NewsService } from './news.service';
import { NewsSentimentService } from './news-sentiment.services';

// ─── Types ───────────────────────────────────────────────────────────────────

interface SentimentApiResponse {
  sentiment: number;
}

interface RawOverallResult {
  average: string | null;
  totalArticles: string;
}

interface RawSourceResult {
  source: string;
  averageScore: string;
  articleCount: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeAxiosResponse<T>(data: T): AxiosResponse<T> {
  return {
    data,
    status: 200,
    statusText: 'OK',
    headers: {},
    config: { headers: {} } as AxiosResponse['config'],
  };
}

function makeArticle(overrides: Partial<News> = {}): News {
  return {
    id: 'article-uuid-1',
    title: 'Bitcoin hits new high',
    url: 'https://example.com/btc',
    source: 'coindesk',
    publishedAt: new Date(),
    sentimentScore: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ─── NewsSentimentService Unit Tests ─────────────────────────────────────────

describe('NewsSentimentService', () => {
  let sentimentService: NewsSentimentService;
  let newsService: jest.Mocked<
    Pick<NewsService, 'findUnscoredArticles' | 'update'>
  >;
  let httpService: jest.Mocked<Pick<HttpService, 'post'>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NewsSentimentService,
        {
          provide: HttpService,
          useValue: { post: jest.fn() },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('http://localhost:8000'),
          },
        },
        {
          provide: NewsService,
          useValue: {
            findUnscoredArticles: jest.fn(),
            update: jest.fn(),
          },
        },
      ],
    }).compile();

    sentimentService = module.get<NewsSentimentService>(NewsSentimentService);
    newsService = module.get<NewsService>(NewsService) as jest.Mocked<
      Pick<NewsService, 'findUnscoredArticles' | 'update'>
    >;
    httpService = module.get<HttpService>(HttpService) as jest.Mocked<
      Pick<HttpService, 'post'>
    >;
  });

  // ── analyzeSentiment ───────────────────────────────────────────────────────

  describe('analyzeSentiment()', () => {
    it('should return score from Python service', async () => {
      const mockResponse = makeAxiosResponse<SentimentApiResponse>({
        sentiment: 0.75,
      });
      (httpService.post as jest.Mock).mockReturnValue(of(mockResponse));

      const score = await sentimentService.analyzeSentiment('Bitcoin is up!');
      expect(score).toBe(0.75);
    });

    it('should return null when Python service is down (non-blocking)', async () => {
      (httpService.post as jest.Mock).mockReturnValue(
        throwError(() => new Error('ECONNREFUSED')),
      );

      const score = await sentimentService.analyzeSentiment('some text');
      expect(score).toBeNull();
    });

    it('should return null on timeout', async () => {
      (httpService.post as jest.Mock).mockReturnValue(
        throwError(() => ({ code: 'ECONNABORTED' })),
      );

      const score = await sentimentService.analyzeSentiment('some text');
      expect(score).toBeNull();
    });

    it('should handle boundary values (-1 and 1)', async () => {
      const negResponse = makeAxiosResponse<SentimentApiResponse>({
        sentiment: -1,
      });
      const posResponse = makeAxiosResponse<SentimentApiResponse>({
        sentiment: 1,
      });

      (httpService.post as jest.Mock).mockReturnValueOnce(of(negResponse));
      expect(await sentimentService.analyzeSentiment('terrible news')).toBe(-1);

      (httpService.post as jest.Mock).mockReturnValueOnce(of(posResponse));
      expect(await sentimentService.analyzeSentiment('great news')).toBe(1);
    });
  });

  // ── updateMissingSentiments (cron) ────────────────────────────────────────

  describe('updateMissingSentiments()', () => {
    it('should update articles that have no sentiment score', async () => {
      const articles = [makeArticle({ id: '1' }), makeArticle({ id: '2' })];
      const mockResponse = makeAxiosResponse<SentimentApiResponse>({
        sentiment: 0.5,
      });

      (newsService.findUnscoredArticles as jest.Mock).mockResolvedValue(
        articles,
      );
      (httpService.post as jest.Mock).mockReturnValue(of(mockResponse));

      await sentimentService.updateMissingSentiments();

      expect(newsService.update).toHaveBeenCalledTimes(2);
      expect(newsService.update).toHaveBeenCalledWith('1', {
        sentimentScore: 0.5,
      });
      expect(newsService.update).toHaveBeenCalledWith('2', {
        sentimentScore: 0.5,
      });
    });

    it('should skip update when sentiment service fails', async () => {
      const articles = [makeArticle({ id: '1' })];
      (newsService.findUnscoredArticles as jest.Mock).mockResolvedValue(
        articles,
      );
      (httpService.post as jest.Mock).mockReturnValue(
        throwError(() => new Error('service down')),
      );

      await sentimentService.updateMissingSentiments();

      expect(newsService.update).not.toHaveBeenCalled();
    });

    it('should not throw when all articles fail scoring', async () => {
      const articles = [makeArticle(), makeArticle({ id: 'article-uuid-2' })];
      (newsService.findUnscoredArticles as jest.Mock).mockResolvedValue(
        articles,
      );
      (httpService.post as jest.Mock).mockReturnValue(
        throwError(() => new Error('down')),
      );

      await expect(
        sentimentService.updateMissingSentiments(),
      ).resolves.not.toThrow();
    });

    it('should do nothing when no unscored articles exist', async () => {
      (newsService.findUnscoredArticles as jest.Mock).mockResolvedValue([]);

      await sentimentService.updateMissingSentiments();

      expect(newsService.update).not.toHaveBeenCalled();
    });
  });
});

// ─── NewsService Unit Tests ───────────────────────────────────────────────────

describe('NewsService - sentiment methods', () => {
  let newsService: NewsService;

  const mockQueryBuilder = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getRawOne: jest.fn(),
    getRawMany: jest.fn(),
    getMany: jest.fn(),
  };

  const mockRepo = {
    find: jest.fn(),
    createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NewsService,
        {
          provide: getRepositoryToken(News),
          useValue: mockRepo,
        },
      ],
    }).compile();

    newsService = module.get<NewsService>(NewsService);
    jest.clearAllMocks();
    mockRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);
  });

  // ── findUnscoredArticles ──────────────────────────────────────────────────

  describe('findUnscoredArticles()', () => {
    it('should return only articles with null sentimentScore', async () => {
      const unscoredArticles = [makeArticle()];
      mockRepo.find.mockResolvedValue(unscoredArticles);

      const result = await newsService.findUnscoredArticles();

      expect(result).toEqual(unscoredArticles);
      expect(mockRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
    });

    it('should return empty array when all articles are scored', async () => {
      mockRepo.find.mockResolvedValue([]);
      const result = await newsService.findUnscoredArticles();
      expect(result).toEqual([]);
    });
  });

  // ── getSentimentSummary ───────────────────────────────────────────────────

  describe('getSentimentSummary()', () => {
    it('should return overall and bySource breakdown', async () => {
      const overallRaw: RawOverallResult = {
        average: '0.4200',
        totalArticles: '10',
      };
      const bySourceRaw: RawSourceResult[] = [
        { source: 'coindesk', averageScore: '0.6500', articleCount: '6' },
        { source: 'cointelegraph', averageScore: '0.1200', articleCount: '4' },
      ];

      mockQueryBuilder.getRawOne.mockResolvedValue(overallRaw);
      mockQueryBuilder.getRawMany.mockResolvedValue(bySourceRaw);

      const result = await newsService.getSentimentSummary();

      expect(result.overall.averageSentiment).toBe(0.42);
      expect(result.overall.totalArticles).toBe(10);
      expect(result.bySource).toHaveLength(2);
      expect(result.bySource[0]).toEqual({
        source: 'coindesk',
        averageScore: 0.65,
        articleCount: 6,
      });
    });

    it('should return 0 when no articles are scored', async () => {
      const overallRaw: RawOverallResult = {
        average: null,
        totalArticles: '0',
      };

      mockQueryBuilder.getRawOne.mockResolvedValue(overallRaw);
      mockQueryBuilder.getRawMany.mockResolvedValue([]);

      const result = await newsService.getSentimentSummary();

      expect(result.overall.averageSentiment).toBe(0);
      expect(result.bySource).toEqual([]);
    });
  });

  // ── findBySentimentRange ──────────────────────────────────────────────────

  describe('findBySentimentRange()', () => {
    it('should return articles within the given score range', async () => {
      const articles = [makeArticle({ sentimentScore: 0.5 })];
      mockQueryBuilder.getMany.mockResolvedValue(articles);

      const result = await newsService.findBySentimentRange(0.3, 0.8);
      expect(result).toEqual(articles);
    });

    it('should exclude articles with null sentimentScore', async () => {
      mockQueryBuilder.getMany.mockResolvedValue([]);

      const result = await newsService.findBySentimentRange(0, 1);
      expect(result).toEqual([]);

      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'news.sentimentScore IS NOT NULL',
      );
    });
  });
});
