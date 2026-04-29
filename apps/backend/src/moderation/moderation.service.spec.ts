import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ModerationService } from './moderation.service';
import {
  ContentReport,
  ReportType,
  ReportReason,
  ReportStatus,
} from './entities/content-report.entity';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('ModerationService', () => {
  let service: ModerationService;

  const mockReport: Partial<ContentReport> = {
    id: 'test-report-id',
    targetType: ReportType.PROJECT,
    targetId: '123',
    reason: ReportReason.SPAM,
    description: 'Test report',
    status: ReportStatus.PENDING,
    reporterId: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockRepository = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    createQueryBuilder: jest.fn(),
    count: jest.fn(),
    findAndCount: jest.fn(),
  };

  const mockQueryBuilder = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getOne: jest.fn(),
    getManyAndCount: jest.fn(),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ModerationService,
        {
          provide: getRepositoryToken(ContentReport),
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = module.get<ModerationService>(ModerationService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createReport', () => {
    it('should create a new report successfully', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(null); // No duplicate
      mockRepository.create.mockReturnValue(mockReport);
      mockRepository.save.mockResolvedValue(mockReport);
      mockRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      const result = await service.createReport('user-1', {
        targetType: ReportType.PROJECT,
        targetId: '123',
        reason: ReportReason.SPAM,
      });

      expect(result).toBeDefined();
      expect(result.targetType).toBe(ReportType.PROJECT);
      expect(mockRepository.save).toHaveBeenCalled();
    });

    it('should throw BadRequestException for duplicate reports', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(mockReport); // Duplicate exists
      mockRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      await expect(
        service.createReport('user-1', {
          targetType: ReportType.PROJECT,
          targetId: '123',
          reason: ReportReason.SPAM,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getReportById', () => {
    it('should return a report by id', async () => {
      mockRepository.findOne.mockResolvedValue(mockReport);

      const result = await service.getReportById('test-report-id');

      expect(result).toBeDefined();
      expect(result.id).toBe('test-report-id');
    });

    it('should throw NotFoundException if report not found', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      await expect(service.getReportById('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateReport', () => {
    it('should update report status', async () => {
      mockRepository.findOne.mockResolvedValue(mockReport);
      mockRepository.save.mockResolvedValue({
        ...mockReport,
        status: ReportStatus.UNDER_REVIEW,
        reviewerId: 'moderator-1',
      });

      const result = await service.updateReport(
        'test-report-id',
        'moderator-1',
        {
          status: ReportStatus.UNDER_REVIEW,
        },
      );

      expect(result.status).toBe(ReportStatus.UNDER_REVIEW);
      expect(result.reviewerId).toBe('moderator-1');
    });
  });

  describe('getModerationStats', () => {
    it('should return moderation statistics', async () => {
      mockRepository.count.mockResolvedValue(10);

      const result = await service.getModerationStats();

      expect(result).toHaveProperty('totalReports');
      expect(result).toHaveProperty('pendingReports');
      expect(result).toHaveProperty('underReviewReports');
      expect(result).toHaveProperty('resolvedReports');
      expect(result).toHaveProperty('dismissedReports');
    });
  });
});
