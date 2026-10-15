import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { ModerationEventPublisherService } from './moderation-event-publisher.service';
import {
  ContentReport,
  ReportType,
  ReportReason,
  ReportStatus,
} from '../entities/content-report.entity';

describe('ModerationEventPublisherService', () => {
  let service: ModerationEventPublisherService;
  let mockQueue: any;

  const mockReport: ContentReport = {
    id: 'test-report-id',
    targetType: ReportType.PROJECT,
    targetId: 'project-123',
    reason: ReportReason.SPAM,
    description: 'This is spam content',
    status: ReportStatus.PENDING,
    reporterId: 'reporter-user-id',
    reviewerId: 'reviewer-user-id',
    reviewNotes: 'Internal notes from reviewer',
    resolvedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  } as ContentReport;

  beforeEach(async () => {
    mockQueue = {
      add: jest.fn().mockResolvedValue({}),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ModerationEventPublisherService,
        {
          provide: getQueueToken('moderation-events'),
          useValue: mockQueue,
        },
      ],
    }).compile();

    service = module.get<ModerationEventPublisherService>(
      ModerationEventPublisherService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('toPublicPayload (privacy enforcement)', () => {
    it('should exclude reviewer-only fields', async () => {
      await service.publishModerationEvent(
        'moderation.pending',
        mockReport,
        null,
      );

      expect(mockQueue.add).toHaveBeenCalledTimes(1);
      const [, event] = mockQueue.add.mock.calls[0];

      // Verify excluded fields
      expect(event.payload).not.toHaveProperty('reviewerId');
      expect(event.payload).not.toHaveProperty('reviewNotes');
      expect(event.payload).not.toHaveProperty('reporter');
      expect(event.payload).not.toHaveProperty('reviewer');
      expect(event.payload).not.toHaveProperty('reporterId');
      expect(event.payload).not.toHaveProperty('description');
      expect(event.payload).not.toHaveProperty('resolvedAt');
      expect(event.payload).not.toHaveProperty('createdAt');
      expect(event.payload).not.toHaveProperty('updatedAt');
    });

    it('should include all required public fields', async () => {
      const reportUnderReview = {
        ...mockReport,
        status: ReportStatus.UNDER_REVIEW,
      };

      await service.publishModerationEvent(
        'moderation.under_review',
        reportUnderReview,
        ReportStatus.PENDING,
      );

      expect(mockQueue.add).toHaveBeenCalledTimes(1);
      const [, event] = mockQueue.add.mock.calls[0];

      expect(event.payload).toEqual({
        reportId: 'test-report-id',
        targetType: ReportType.PROJECT,
        targetId: 'project-123',
        previousStatus: ReportStatus.PENDING,
        newStatus: ReportStatus.UNDER_REVIEW,
        reason: ReportReason.SPAM,
      });
    });

    it('should not leak reviewer data when serialized to JSON', async () => {
      const resolvedReport = {
        ...mockReport,
        status: ReportStatus.RESOLVED,
      };

      await service.publishModerationEvent(
        'moderation.resolved',
        resolvedReport,
        ReportStatus.UNDER_REVIEW,
      );

      expect(mockQueue.add).toHaveBeenCalledTimes(1);
      const [, event] = mockQueue.add.mock.calls[0];
      const serialized = JSON.stringify(event);

      // Ensure no sensitive strings appear in JSON
      expect(serialized).not.toContain('reviewer-user-id');
      expect(serialized).not.toContain('Internal notes from reviewer');
      expect(serialized).not.toContain('reporter-user-id');
      expect(serialized).not.toContain('This is spam content');
    });
  });

  describe('publishModerationEvent', () => {
    it('should emit event with correct eventType', async () => {
      await service.publishModerationEvent(
        'moderation.under_review',
        mockReport,
        ReportStatus.PENDING,
      );

      expect(mockQueue.add).toHaveBeenCalledTimes(1);
      const [, event] = mockQueue.add.mock.calls[0];
      expect(event.eventType).toBe('moderation.under_review');
    });

    it('should generate unique eventId for each emission', async () => {
      await service.publishModerationEvent(
        'moderation.pending',
        mockReport,
        null,
      );
      await service.publishModerationEvent(
        'moderation.under_review',
        mockReport,
        ReportStatus.PENDING,
      );

      expect(mockQueue.add).toHaveBeenCalledTimes(2);
      const [, event1] = mockQueue.add.mock.calls[0];
      const [, event2] = mockQueue.add.mock.calls[1];

      expect(event1.eventId).toBeTruthy();
      expect(event2.eventId).toBeTruthy();
      expect(event1.eventId).not.toBe(event2.eventId);

      // Verify UUID v4 format
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(event1.eventId).toMatch(uuidRegex);
      expect(event2.eventId).toMatch(uuidRegex);
    });

    it('should set occurredAt as valid ISO 8601 UTC string', async () => {
      await service.publishModerationEvent(
        'moderation.dismissed',
        mockReport,
        ReportStatus.UNDER_REVIEW,
      );

      expect(mockQueue.add).toHaveBeenCalledTimes(1);
      const [, event] = mockQueue.add.mock.calls[0];

      expect(event.occurredAt).toBeTruthy();
      const date = new Date(event.occurredAt);
      expect(date.toISOString()).toBe(event.occurredAt);
    });

    it('should always set schemaVersion to "1"', async () => {
      await service.publishModerationEvent(
        'moderation.resolved',
        mockReport,
        ReportStatus.DISMISSED,
      );

      expect(mockQueue.add).toHaveBeenCalledTimes(1);
      const [, event] = mockQueue.add.mock.calls[0];
      expect(event.schemaVersion).toBe('1');
    });

    it('should add event to queue with retry configuration', async () => {
      await service.publishModerationEvent(
        'moderation.pending',
        mockReport,
        null,
      );

      expect(mockQueue.add).toHaveBeenCalledWith(
        'moderation-decision',
        expect.objectContaining({
          eventType: 'moderation.pending',
          schemaVersion: '1',
        }),
        expect.objectContaining({
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
        }),
      );
    });

    it('should not throw when queue.add fails', async () => {
      mockQueue.add.mockRejectedValue(new Error('Queue unavailable'));

      await expect(
        service.publishModerationEvent('moderation.pending', mockReport, null),
      ).resolves.not.toThrow();
    });

    it('should log error without sensitive data when publish fails', async () => {
      const loggerErrorSpy = jest.spyOn(service['logger'], 'error');
      mockQueue.add.mockRejectedValue(new Error('Queue connection failed'));

      await service.publishModerationEvent(
        'moderation.resolved',
        mockReport,
        ReportStatus.PENDING,
      );

      expect(loggerErrorSpy).toHaveBeenCalled();
      const logMessage = loggerErrorSpy.mock.calls[0][0];

      // Ensure log contains event metadata
      expect(logMessage).toContain('moderation.resolved');
      expect(logMessage).toContain('test-report-id');

      // Ensure log does NOT contain sensitive data
      expect(logMessage).not.toContain('reviewer-user-id');
      expect(logMessage).not.toContain('Internal notes from reviewer');
    });
  });

  describe('all state transitions emit events', () => {
    it('should emit moderation.pending for new reports', async () => {
      await service.publishModerationEvent(
        'moderation.pending',
        { ...mockReport, status: ReportStatus.PENDING },
        null,
      );

      expect(mockQueue.add).toHaveBeenCalledTimes(1);
      const [, event] = mockQueue.add.mock.calls[0];
      expect(event.eventType).toBe('moderation.pending');
      expect(event.payload.newStatus).toBe(ReportStatus.PENDING);
      expect(event.payload.previousStatus).toBeNull();
    });

    it('should emit moderation.under_review for status transition', async () => {
      await service.publishModerationEvent(
        'moderation.under_review',
        { ...mockReport, status: ReportStatus.UNDER_REVIEW },
        ReportStatus.PENDING,
      );

      expect(mockQueue.add).toHaveBeenCalledTimes(1);
      const [, event] = mockQueue.add.mock.calls[0];
      expect(event.eventType).toBe('moderation.under_review');
      expect(event.payload.newStatus).toBe(ReportStatus.UNDER_REVIEW);
      expect(event.payload.previousStatus).toBe(ReportStatus.PENDING);
    });

    it('should emit moderation.resolved for resolution', async () => {
      await service.publishModerationEvent(
        'moderation.resolved',
        { ...mockReport, status: ReportStatus.RESOLVED },
        ReportStatus.UNDER_REVIEW,
      );

      expect(mockQueue.add).toHaveBeenCalledTimes(1);
      const [, event] = mockQueue.add.mock.calls[0];
      expect(event.eventType).toBe('moderation.resolved');
      expect(event.payload.newStatus).toBe(ReportStatus.RESOLVED);
    });

    it('should emit moderation.dismissed for dismissal', async () => {
      await service.publishModerationEvent(
        'moderation.dismissed',
        { ...mockReport, status: ReportStatus.DISMISSED },
        ReportStatus.UNDER_REVIEW,
      );

      expect(mockQueue.add).toHaveBeenCalledTimes(1);
      const [, event] = mockQueue.add.mock.calls[0];
      expect(event.eventType).toBe('moderation.dismissed');
      expect(event.payload.newStatus).toBe(ReportStatus.DISMISSED);
    });
  });
});
