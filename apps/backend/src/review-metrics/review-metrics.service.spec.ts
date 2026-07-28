import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ReviewMetricsService } from './review-metrics.service';
import { ContentReport } from '../moderation/entities/content-report.entity';
import { PortfolioAnomaly } from '../portfolio/entities/portfolio-anomaly.entity';
import { ReviewDomain } from './dto/review-metrics.dto';

describe('ReviewMetricsService', () => {
  let service: ReviewMetricsService;

  const mockReportsRepo = {
    createQueryBuilder: jest.fn(),
  };

  const mockAnomaliesRepo = {
    createQueryBuilder: jest.fn(),
  };

  function createMockQueryBuilder(rawResults: { createdAt: string }[]) {
    return {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue(rawResults),
    };
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReviewMetricsService,
        {
          provide: getRepositoryToken(ContentReport),
          useValue: mockReportsRepo,
        },
        {
          provide: getRepositoryToken(PortfolioAnomaly),
          useValue: mockAnomaliesRepo,
        },
      ],
    }).compile();

    service = module.get<ReviewMetricsService>(ReviewMetricsService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getReviewMetrics', () => {
    it('should return empty snapshots when no open items exist', async () => {
      mockReportsRepo.createQueryBuilder.mockReturnValue(
        createMockQueryBuilder([]),
      );
      mockAnomaliesRepo.createQueryBuilder.mockReturnValue(
        createMockQueryBuilder([]),
      );

      const result = await service.getReviewMetrics({});

      expect(result).toBeDefined();
      expect(result.grandTotalOpen).toBe(0);
      expect(result.domains).toHaveLength(2);
      expect(result.computedAt).toBeDefined();

      for (const domain of result.domains) {
        expect(domain.totalOpen).toBe(0);
        expect(domain.averageAgeMs).toBe(0);
        expect(domain.medianAgeMs).toBeNull();
        expect(domain.oldestAgeMs).toBeNull();
        expect(domain.newestAgeMs).toBeNull();
        expect(domain.buckets.every((b) => b.count === 0)).toBe(true);
      }
    });

    it('should compute aging metrics for moderation open items', async () => {
      const now = Date.now();
      const twoDaysMs = 2 * 24 * 60 * 60 * 1000;
      const rawItems = [
        { createdAt: new Date(now - twoDaysMs).toISOString() },
        { createdAt: new Date(now - 1 * 60 * 60 * 1000).toISOString() },
      ];

      mockReportsRepo.createQueryBuilder.mockReturnValue(
        createMockQueryBuilder(rawItems),
      );
      mockAnomaliesRepo.createQueryBuilder.mockReturnValue(
        createMockQueryBuilder([]),
      );

      const result = await service.getReviewMetrics({});

      const moderation = result.domains.find(
        (d) => d.domain === ReviewDomain.MODERATION,
      )!;
      expect(moderation.totalOpen).toBe(2);
      expect(moderation.averageAgeMs).toBeGreaterThan(0);
      expect(moderation.medianAgeMs).toBeGreaterThan(0);
      expect(moderation.oldestAgeMs).toBeGreaterThan(0);
      expect(moderation.newestAgeMs).toBeGreaterThan(0);
    });

    it('should filter by domain', async () => {
      const now = Date.now();
      const rawItems = [{ createdAt: new Date(now - 3_600_000).toISOString() }];

      mockReportsRepo.createQueryBuilder.mockReturnValue(
        createMockQueryBuilder(rawItems),
      );
      mockAnomaliesRepo.createQueryBuilder.mockReturnValue(
        createMockQueryBuilder([]),
      );

      const result = await service.getReviewMetrics({
        domain: ReviewDomain.MODERATION,
      });

      expect(result.domains).toHaveLength(1);
      expect(result.domains[0].domain).toBe(ReviewDomain.MODERATION);
    });

    it('should apply reviewerId filter to both repos', async () => {
      const qbReports = createMockQueryBuilder([]);
      const qbAnomalies = createMockQueryBuilder([]);

      mockReportsRepo.createQueryBuilder.mockReturnValue(qbReports);
      mockAnomaliesRepo.createQueryBuilder.mockReturnValue(qbAnomalies);

      await service.getReviewMetrics({ reviewerId: 'reviewer-42' });

      expect(qbReports.andWhere).toHaveBeenCalledWith(
        'report.reviewerId = :reviewerId',
        { reviewerId: 'reviewer-42' },
      );
      expect(qbAnomalies.andWhere).toHaveBeenCalledWith(
        'anomaly.reviewerId = :reviewerId',
        { reviewerId: 'reviewer-42' },
      );
    });

    it('should compute correct grand total across domains', async () => {
      const now = Date.now();
      const moderationItems = [
        { createdAt: new Date(now - 3_600_000).toISOString() },
      ];
      const anomalyItems = [
        { createdAt: new Date(now - 7_200_000).toISOString() },
        { createdAt: new Date(now - 14_400_000).toISOString() },
      ];

      mockReportsRepo.createQueryBuilder.mockReturnValue(
        createMockQueryBuilder(moderationItems),
      );
      mockAnomaliesRepo.createQueryBuilder.mockReturnValue(
        createMockQueryBuilder(anomalyItems),
      );

      const result = await service.getReviewMetrics({});
      expect(result.grandTotalOpen).toBe(3);
    });

    it('should populate aging buckets correctly', async () => {
      const now = Date.now();
      // < 1 hour item
      const rawItems = [
        { createdAt: new Date(now - 30 * 60 * 1000).toISOString() },
      ];

      mockReportsRepo.createQueryBuilder.mockReturnValue(
        createMockQueryBuilder(rawItems),
      );
      mockAnomaliesRepo.createQueryBuilder.mockReturnValue(
        createMockQueryBuilder([]),
      );

      const result = await service.getReviewMetrics({});
      const moderation = result.domains.find(
        (d) => d.domain === ReviewDomain.MODERATION,
      )!;
      const underOneHour = moderation.buckets.find(
        (b) => b.label === '< 1 hour',
      )!;
      expect(underOneHour.count).toBe(1);
    });
  });
});
