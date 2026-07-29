import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { Repository } from 'typeorm';
import { ModerationService } from './moderation.service';
import { ModerationEventPublisherService } from './services/moderation-event-publisher.service';
import {
  ContentReport,
  ReportType,
  ReportReason,
  ReportStatus,
} from './entities/content-report.entity';

describe('ModerationService - Event Integration', () => {
  let service: ModerationService;
  let repository: Repository<ContentReport>;
  let mockQueue: any;

  const mockReport: Partial<ContentReport> = {
    id: 'test-report-id',
    targetType: ReportType.PROJECT,
    targetId: 'project-123',
    reason: ReportReason.SPAM,
    description: 'Test description',
    status: ReportStatus.PENDING,
    reporterId: 'reporter-id',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    mockQueue = {
      add: jest.fn().mockResolvedValue({}),
    };

    const mockRepository = {
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ModerationService,
        ModerationEventPublisherService,
        {
          provide: getRepositoryToken(ContentReport),
          useValue: mockRepository,
        },
        {
          provide: getQueueToken('moderation-events'),
          useValue: mockQueue,
        },
      ],
    }).compile();

    service = module.get<ModerationService>(ModerationService);
    repository = module.get<Repository<ContentReport>>(
      getRepositoryToken(ContentReport),
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('End-to-end: state change emits processable event', () => {
    it('should emit event after report creation', async () => {
      (repository.create as jest.Mock).mockReturnValue(mockReport);
      (repository.save as jest.Mock).mockResolvedValue(mockReport);

      await service.createReport('reporter-id', {
        targetType: ReportType.PROJECT,
        targetId: 'project-123',
        reason: ReportReason.SPAM,
      });

      expect(mockQueue.add).toHaveBeenCalledTimes(1);
      const [jobName, event] = mockQueue.add.mock.calls[0];

      expect(jobName).toBe('moderation-decision');
      expect(event).toMatchObject({
        eventType: 'moderation.pending',
        schemaVersion: '1',
        payload: {
          reportId: 'test-report-id',
          targetType: ReportType.PROJECT,
          targetId: 'project-123',
          newStatus: ReportStatus.PENDING,
          previousStatus: null,
          reason: ReportReason.SPAM,
        },
      });

      // Verify consumer can extract required fields
      expect(event.payload.reportId).toBeTruthy();
      expect(event.payload.newStatus).toBe(ReportStatus.PENDING);
      expect(event.eventId).toBeTruthy();
      expect(event.occurredAt).toBeTruthy();
    });

    it('should emit event after status update', async () => {
      const updatedReport = {
        ...mockReport,
        status: ReportStatus.UNDER_REVIEW,
        reviewerId: 'reviewer-id',
      };

      (repository.findOne as jest.Mock).mockResolvedValue(mockReport);
      (repository.save as jest.Mock).mockResolvedValue(updatedReport);

      await service.updateReport('test-report-id', 'reviewer-id', {
        status: ReportStatus.UNDER_REVIEW,
      });

      expect(mockQueue.add).toHaveBeenCalledTimes(1);
      const [jobName, event] = mockQueue.add.mock.calls[0];

      expect(jobName).toBe('moderation-decision');
      expect(event).toMatchObject({
        eventType: 'moderation.under_review',
        payload: {
          reportId: 'test-report-id',
          newStatus: ReportStatus.UNDER_REVIEW,
          previousStatus: ReportStatus.PENDING,
        },
      });

      // Verify no sensitive field is accessible
      expect(event.payload.reviewerId).toBeUndefined();
      expect(event.payload.reviewNotes).toBeUndefined();
    });

    it('should NOT emit event when only reviewNotes updated without status change', async () => {
      (repository.findOne as jest.Mock).mockResolvedValue(mockReport);
      (repository.save as jest.Mock).mockResolvedValue({
        ...mockReport,
        reviewNotes: 'Updated notes',
      });

      await service.updateReport('test-report-id', 'reviewer-id', {
        reviewNotes: 'Updated notes',
      });

      expect(mockQueue.add).not.toHaveBeenCalled();
    });
  });

  describe('State change independence', () => {
    it('should complete state change even when event publish fails', async () => {
      mockQueue.add.mockRejectedValue(new Error('Queue unavailable'));

      (repository.create as jest.Mock).mockReturnValue(mockReport);
      (repository.save as jest.Mock).mockResolvedValue(mockReport);

      const result = await service.createReport('reporter-id', {
        targetType: ReportType.PROJECT,
        targetId: 'project-123',
        reason: ReportReason.SPAM,
      });

      // State change succeeded
      expect(result).toBeDefined();
      expect(repository.save).toHaveBeenCalled();

      // Event publish was attempted but failed gracefully
      expect(mockQueue.add).toHaveBeenCalled();
    });

    it('should complete update even when queue throws', async () => {
      const updatedReport = {
        ...mockReport,
        status: ReportStatus.RESOLVED,
      };

      mockQueue.add.mockRejectedValue(new Error('Redis connection lost'));
      (repository.findOne as jest.Mock).mockResolvedValue(mockReport);
      (repository.save as jest.Mock).mockResolvedValue(updatedReport);

      const result = await service.updateReport('test-report-id', 'reviewer-id', {
        status: ReportStatus.RESOLVED,
      });

      expect(result.status).toBe(ReportStatus.RESOLVED);
      expect(repository.save).toHaveBeenCalled();
    });
  });

  describe('Privacy guarantees', () => {
    it('should never include reviewerId in event payload', async () => {
      // Clear any previous calls
      jest.clearAllMocks();

      const reportWithReviewer = {
        ...mockReport,
        status: ReportStatus.RESOLVED,
        reviewerId: 'secret-reviewer-id',
        reviewNotes: 'Confidential notes',
      };

      // Mock findOne with the exact call signature used by getReportById
      (repository.findOne as jest.Mock).mockResolvedValue({
        ...mockReport,
        id: 'test-report-id',
        status: ReportStatus.PENDING, // Original status
      });
      (repository.save as jest.Mock).mockResolvedValue(reportWithReviewer);

      await service.updateReport('test-report-id', 'secret-reviewer-id', {
        status: ReportStatus.RESOLVED, // New status
        reviewNotes: 'Confidential notes',
      });

      // Verify the queue was called
      expect(mockQueue.add).toHaveBeenCalledTimes(1);
      const [jobName, event] = mockQueue.add.mock.calls[0];
      
      expect(jobName).toBe('moderation-decision');
      
      const serialized = JSON.stringify(event);
      expect(serialized).not.toContain('secret-reviewer-id');
      expect(serialized).not.toContain('Confidential notes');
    });
  });
});
