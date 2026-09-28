import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { SorobanEventsDeadLetterService } from './soroban-events-dead-letter.service';
import { SorobanEventDeadLetter } from './entities/soroban-event-dead-letter.entity';
import { SorobanEvent } from './entities/soroban-event.entity';
import { AdminAuditService } from '../admin-audit/admin-audit.service';
import { BulkDeadLetterReplayDto } from './dto/bulk-dead-letter-replay.dto';
import { MAX_BATCH_SIZE } from '../common/bulk/bulk-operation.helper';
import { SOROBAN_EVENTS_QUEUE } from './soroban-events.service';

describe('SorobanEventsDeadLetterService.bulkReplay', () => {
  let service: SorobanEventsDeadLetterService;
  let auditCreate: jest.Mock;

  const makeReplayResult = (id: string) => ({
    message: 'Event queued for replay',
    jobId: `hash:0`,
    eventId: id,
    replayCount: 1,
  });

  beforeEach(async () => {
    auditCreate = jest.fn().mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SorobanEventsDeadLetterService,
        {
          provide: getRepositoryToken(SorobanEventDeadLetter),
          useValue: {},
        },
        {
          provide: getRepositoryToken(SorobanEvent),
          useValue: {},
        },
        {
          provide: getQueueToken(SOROBAN_EVENTS_QUEUE),
          useValue: { add: jest.fn() },
        },
        {
          provide: AdminAuditService,
          useValue: { create: auditCreate },
        },
      ],
    }).compile();

    service = module.get<SorobanEventsDeadLetterService>(
      SorobanEventsDeadLetterService,
    );

    // Stub replayEvent
    jest.spyOn(service, 'replayEvent').mockImplementation((dlqId, _reason) => {
      if (dlqId === 'bad-id')
        return Promise.reject(
          new BadRequestException('Dead letter queue entry not found'),
        );
      return Promise.resolve(makeReplayResult(dlqId));
    });
  });

  it('processes all items and returns correct aggregates', async () => {
    const dto: BulkDeadLetterReplayDto = {
      items: [{ id: 'dlq-1', reason: 'Contract deployed' }, { id: 'dlq-2' }],
    };

    const result = await service.bulkReplay(
      'admin-1',
      'admin@example.com',
      dto,
    );

    expect(result.total).toBe(2);
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(0);
    result.results.forEach((r) => expect(r.success).toBe(true));
  });

  it('records one audit entry per succeeded item with shared bulkOperationId', async () => {
    const dto: BulkDeadLetterReplayDto = {
      items: [{ id: 'dlq-1', reason: 'Fixed upstream' }, { id: 'dlq-2' }],
    };

    const result = await service.bulkReplay(
      'admin-1',
      'admin@example.com',
      dto,
    );

    expect(auditCreate).toHaveBeenCalledTimes(2);
    auditCreate.mock.calls.forEach((call) => {
      const params = call[0].params;
      expect(params.bulkOperationId).toBe(result.bulkOperationId);
      expect(call[0].endpoint).toBe(
        'POST /soroban-events/dead-letter/bulk-replay',
      );
    });
  });

  it('isolates failures — a missing entry does not abort remaining replays', async () => {
    const dto: BulkDeadLetterReplayDto = {
      items: [{ id: 'dlq-1' }, { id: 'bad-id' }, { id: 'dlq-3' }],
    };

    const result = await service.bulkReplay('admin-1', null, dto);

    expect(result.total).toBe(3);
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(1);

    const failed = result.results.find((r) => r.id === 'bad-id')!;
    expect(failed.success).toBe(false);
    expect(failed.error).toBeDefined();
  });

  it('throws BadRequestException for empty items array', async () => {
    await expect(
      service.bulkReplay('admin-1', null, { items: [] }),
    ).rejects.toThrow(BadRequestException);
  });

  it(`throws BadRequestException when batch exceeds ${MAX_BATCH_SIZE}`, async () => {
    const dto: BulkDeadLetterReplayDto = {
      items: Array.from({ length: MAX_BATCH_SIZE + 1 }, (_, i) => ({
        id: `dlq-${i}`,
      })),
    };
    await expect(service.bulkReplay('admin-1', null, dto)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('passes per-item reason through to replayEvent', async () => {
    const replaySpy = jest.spyOn(service, 'replayEvent');
    const dto: BulkDeadLetterReplayDto = {
      items: [{ id: 'dlq-1', reason: 'specific reason' }],
    };

    await service.bulkReplay('admin-1', null, dto);

    expect(replaySpy).toHaveBeenCalledWith('dlq-1', 'specific reason');
  });
});
