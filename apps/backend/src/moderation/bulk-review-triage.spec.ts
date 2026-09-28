import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { ReviewHistoryService } from './review-history.service';
import { ReviewComment } from './entities/review-comment.entity';
import {
  ReviewDecisionHistory,
  DecisionType,
} from './entities/review-decision-history.entity';
import { AuditService } from '../audit/audit.service';
import { BulkReviewTriageDto } from './dto/bulk-review-triage.dto';
import { MAX_BATCH_SIZE } from '../common/bulk/bulk-operation.helper';

const makeDecision = (
  targetId: string,
  decisionType: DecisionType,
): ReviewDecisionHistory =>
  ({
    id: `decision-${targetId}`,
    targetId,
    targetType: 'project',
    decisionType,
    reviewerId: 'admin-1',
    createdAt: new Date(),
  }) as ReviewDecisionHistory;

describe('ReviewHistoryService.bulkTriage', () => {
  let service: ReviewHistoryService;
  let auditLog: jest.Mock;

  beforeEach(async () => {
    auditLog = jest.fn().mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReviewHistoryService,
        { provide: getRepositoryToken(ReviewComment), useValue: {} },
        { provide: getRepositoryToken(ReviewDecisionHistory), useValue: {} },
        { provide: AuditService, useValue: { log: auditLog } },
      ],
    }).compile();

    service = module.get<ReviewHistoryService>(ReviewHistoryService);

    // Stub createDecision
    jest
      .spyOn(service, 'createDecision')
      .mockImplementation((_reviewerId, _role, dto) => {
        if (dto.targetId === 'bad-target')
          return Promise.reject(new ForbiddenException('Forbidden'));
        return Promise.resolve(makeDecision(dto.targetId, dto.decisionType));
      });
  });

  it('processes all items and returns correct aggregates', async () => {
    const dto: BulkReviewTriageDto = {
      items: [
        {
          targetId: 'p1',
          targetType: 'project',
          decisionType: DecisionType.APPROVED,
        },
        {
          targetId: 'p2',
          targetType: 'project',
          decisionType: DecisionType.REJECTED,
        },
      ],
    };

    const result = await service.bulkTriage('admin-1', '1.2.3.4', dto);

    expect(result.total).toBe(2);
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(0);
    result.results.forEach((r) => expect(r.success).toBe(true));
  });

  it('records one audit entry per succeeded item with shared bulkOperationId', async () => {
    const dto: BulkReviewTriageDto = {
      items: [
        {
          targetId: 'p1',
          targetType: 'project',
          decisionType: DecisionType.APPROVED,
        },
        {
          targetId: 'p2',
          targetType: 'project',
          decisionType: DecisionType.DEFERRED,
        },
      ],
    };

    const result = await service.bulkTriage('admin-1', null, dto);

    expect(auditLog).toHaveBeenCalledTimes(2);
    auditLog.mock.calls.forEach((call) => {
      expect(call[0]).toBe('bulk_review_triage_decision');
      expect(call[3].bulkOperationId).toBe(result.bulkOperationId);
    });
  });

  it('isolates failures — a bad target does not abort other items', async () => {
    const dto: BulkReviewTriageDto = {
      items: [
        {
          targetId: 'p1',
          targetType: 'project',
          decisionType: DecisionType.APPROVED,
        },
        {
          targetId: 'bad-target',
          targetType: 'project',
          decisionType: DecisionType.APPROVED,
        },
        {
          targetId: 'p3',
          targetType: 'project',
          decisionType: DecisionType.REJECTED,
        },
      ],
    };

    const result = await service.bulkTriage('admin-1', null, dto);

    expect(result.total).toBe(3);
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(1);

    const failed = result.results.find((r) => r.id.includes('bad-target'))!;
    expect(failed.success).toBe(false);
  });

  it('throws BadRequestException for empty items array', async () => {
    await expect(
      service.bulkTriage('admin-1', null, { items: [] }),
    ).rejects.toThrow(BadRequestException);
  });

  it(`throws BadRequestException when batch exceeds ${MAX_BATCH_SIZE}`, async () => {
    const dto: BulkReviewTriageDto = {
      items: Array.from({ length: MAX_BATCH_SIZE + 1 }, (_, i) => ({
        targetId: `p${i}`,
        targetType: 'project',
        decisionType: DecisionType.APPROVED,
      })),
    };
    await expect(service.bulkTriage('admin-1', null, dto)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('uses compound targetType:targetId as the item id in results', async () => {
    const dto: BulkReviewTriageDto = {
      items: [
        {
          targetId: 'p1',
          targetType: 'project',
          decisionType: DecisionType.APPROVED,
        },
      ],
    };

    const result = await service.bulkTriage('admin-1', null, dto);

    expect(result.results[0].id).toBe('project:p1');
  });
});
