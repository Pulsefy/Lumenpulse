import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ModerationService } from './moderation.service';
import { ContentReport, ReportStatus } from './entities/content-report.entity';
import { ModerationEventPublisherService } from './services/moderation-event-publisher.service';
import { AuditService } from '../audit/audit.service';
import { BulkModerationDecisionDto } from './dto/bulk-moderation-decision.dto';
import { MAX_BATCH_SIZE } from '../common/bulk/bulk-operation.helper';
import { BadRequestException } from '@nestjs/common';

const makeReport = (id: string): ContentReport =>
  ({
    id,
    status: ReportStatus.PENDING,
    reporterId: 'reporter-1',
    reviewNotes: undefined,
    resolvedAt: undefined,
  }) as ContentReport;

describe('ModerationService.bulkUpdateReports', () => {
  let service: ModerationService;
  let auditLog: jest.Mock;

  beforeEach(async () => {
    auditLog = jest.fn().mockResolvedValue({});

    const mockRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
        getOne: jest.fn().mockResolvedValue(null),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ModerationService,
        { provide: getRepositoryToken(ContentReport), useValue: mockRepo },
        {
          provide: ModerationEventPublisherService,
          useValue: {
            publishModerationEvent: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: AuditService,
          useValue: { log: auditLog },
        },
      ],
    }).compile();

    service = module.get<ModerationService>(ModerationService);

    // Stub getReportById and updateReport at the service level
    jest.spyOn(service, 'getReportById').mockImplementation((id) => {
      if (id === 'missing')
        return Promise.reject(new BadRequestException('Report not found'));
      return Promise.resolve(makeReport(id));
    });

    jest
      .spyOn(service, 'updateReport')
      .mockImplementation((id, _reviewerId, dto) => {
        if (id === 'missing')
          return Promise.reject(new BadRequestException('Report not found'));
        return Promise.resolve({
          ...makeReport(id),
          status: dto.status ?? ReportStatus.PENDING,
          reviewNotes: dto.reviewNotes,
        } as ContentReport);
      });
  });

  it('processes all items and returns correct aggregate counts', async () => {
    const dto: BulkModerationDecisionDto = {
      items: [
        { id: 'r1', status: ReportStatus.RESOLVED },
        { id: 'r2', status: ReportStatus.DISMISSED, reviewNotes: 'not spam' },
      ],
    };

    const result = await service.bulkUpdateReports('admin-1', '1.2.3.4', dto);

    expect(result.total).toBe(2);
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.bulkOperationId).toBeDefined();
    result.results.forEach((r) => expect(r.success).toBe(true));
  });

  it('records one audit log entry per succeeded item, each with bulkOperationId', async () => {
    const dto: BulkModerationDecisionDto = {
      items: [
        { id: 'r1', status: ReportStatus.RESOLVED },
        { id: 'r2', status: ReportStatus.DISMISSED },
      ],
    };

    const result = await service.bulkUpdateReports('admin-1', null, dto);

    expect(auditLog).toHaveBeenCalledTimes(2);
    auditLog.mock.calls.forEach((call) => {
      expect(call[0]).toBe('bulk_moderation_decision');
      expect(call[1]).toBe('admin-1');
      expect(call[3].bulkOperationId).toBe(result.bulkOperationId);
    });
  });

  it('isolates failures — a missing report does not abort remaining items', async () => {
    const dto: BulkModerationDecisionDto = {
      items: [
        { id: 'r1', status: ReportStatus.RESOLVED },
        { id: 'missing', status: ReportStatus.DISMISSED },
        { id: 'r3', status: ReportStatus.RESOLVED },
      ],
    };

    const result = await service.bulkUpdateReports('admin-1', null, dto);

    expect(result.total).toBe(3);
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(1);

    const failed = result.results.find((r) => r.id === 'missing')!;
    expect(failed.success).toBe(false);
    expect(failed.error).toBeDefined();
  });

  it('throws BadRequestException immediately when items array is empty', async () => {
    await expect(
      service.bulkUpdateReports('admin-1', null, { items: [] }),
    ).rejects.toThrow(BadRequestException);
  });

  it(`throws BadRequestException when batch size exceeds ${MAX_BATCH_SIZE}`, async () => {
    const dto: BulkModerationDecisionDto = {
      items: Array.from({ length: MAX_BATCH_SIZE + 1 }, (_, i) => ({
        id: `r${i}`,
        status: ReportStatus.RESOLVED,
      })),
    };
    await expect(
      service.bulkUpdateReports('admin-1', null, dto),
    ).rejects.toThrow(BadRequestException);
  });
});
