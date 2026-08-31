import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  IdempotencyRecord,
  IdempotencyRecordStatus,
} from './idempotency-record.entity';
import { IdempotencyService } from './idempotency.service';

describe('IdempotencyService', () => {
  let service: IdempotencyService;
  let repo: jest.Mocked<
    Pick<
      Repository<IdempotencyRecord>,
      | 'findOne'
      | 'create'
      | 'save'
      | 'delete'
      | 'createQueryBuilder'
    >
  >;

  const record = (overrides: Partial<IdempotencyRecord> = {}) =>
    ({
      id: 'record-id',
      key: 'key-1',
      method: 'POST',
      route: '/grants/:id',
      requestHash: 'hash-1',
      status: IdempotencyRecordStatus.COMPLETED,
      responseStatus: 201,
      responseBody: { ok: true },
      leaseExpiresAt: new Date(Date.now() + 60_000),
      expiresAt: new Date(Date.now() + 86_400_000),
      completedAt: new Date(),
      createdAt: new Date(),
      ...overrides,
    }) as IdempotencyRecord;

  beforeEach(async () => {
    jest.clearAllMocks();

    repo = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      delete: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdempotencyService,
        {
          provide: getRepositoryToken(IdempotencyRecord),
          useValue: repo,
        },
      ],
    }).compile();

    service = module.get<IdempotencyService>(IdempotencyService);
  });

  describe('acquire', () => {
    it('claims a fresh key as in_progress and returns acquired', async () => {
      repo.findOne.mockResolvedValue(null);
      const claim = record({ status: IdempotencyRecordStatus.IN_PROGRESS });
      repo.create.mockReturnValue(claim);
      repo.save.mockResolvedValue({} as never);

      const outcome = await service.acquire(
        'key-1',
        'POST',
        '/grants/:id',
        'hash-1',
      );

      expect(outcome.kind).toBe('acquired');
      expect(repo.save).toHaveBeenCalledTimes(1);
    });

    it('replays the stored response for a completed key with the same body', async () => {
      repo.findOne.mockResolvedValue(record());

      const outcome = await service.acquire(
        'key-1',
        'POST',
        '/grants/:id',
        'hash-1',
      );

      expect(outcome).toMatchObject({ kind: 'replay' });
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('rejects a completed key reused with a different body', async () => {
      repo.findOne.mockResolvedValue(record({ requestHash: 'other-hash' }));

      const outcome = await service.acquire(
        'key-1',
        'POST',
        '/grants/:id',
        'hash-1',
      );

      expect(outcome.kind).toBe('hash-mismatch');
    });

    it('does not replay a completed key whose retention window has passed', async () => {
      repo.findOne.mockResolvedValue(
        record({ expiresAt: new Date(Date.now() - 1_000) }),
      );
      const claim = record({ status: IdempotencyRecordStatus.IN_PROGRESS });
      repo.create.mockReturnValue(claim);
      repo.save.mockResolvedValue({} as never);

      const outcome = await service.acquire(
        'key-1',
        'POST',
        '/grants/:id',
        'hash-1',
      );

      expect(outcome.kind).toBe('acquired');
      expect(repo.delete).toHaveBeenCalledWith('record-id');
    });

    it('returns in-progress for a live claim owned by another request', async () => {
      repo.findOne.mockResolvedValue(
        record({ status: IdempotencyRecordStatus.IN_PROGRESS }),
      );

      const outcome = await service.acquire(
        'key-1',
        'POST',
        '/grants/:id',
        'hash-1',
      );

      expect(outcome.kind).toBe('in-progress');
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('reclaims a claim whose lease has expired', async () => {
      repo.findOne.mockResolvedValue(
        record({
          status: IdempotencyRecordStatus.IN_PROGRESS,
          leaseExpiresAt: new Date(Date.now() - 1_000),
        }),
      );
      const claim = record({ status: IdempotencyRecordStatus.IN_PROGRESS });
      repo.create.mockReturnValue(claim);
      repo.save.mockResolvedValue({} as never);

      const outcome = await service.acquire(
        'key-1',
        'POST',
        '/grants/:id',
        'hash-1',
      );

      expect(outcome.kind).toBe('acquired');
      expect(repo.delete).toHaveBeenCalled();
    });

    it('re-classifies the winner when it loses the insert race', async () => {
      repo.findOne.mockResolvedValueOnce(null);
      repo.create.mockReturnValue(record());
      repo.save.mockRejectedValue(
        new Error('duplicate key value violates unique constraint'),
      );
      repo.findOne.mockResolvedValueOnce(record());

      const outcome = await service.acquire(
        'key-1',
        'POST',
        '/grants/:id',
        'hash-1',
      );

      expect(outcome.kind).toBe('replay');
    });
  });

  describe('complete', () => {
    it('persists the response on the record', async () => {
      repo.save.mockResolvedValue({} as never);

      await service.complete(record(), 201, { ok: true });

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: IdempotencyRecordStatus.COMPLETED,
          responseStatus: 201,
          responseBody: { ok: true },
        }),
      );
    });
  });

  describe('release', () => {
    it('deletes the claim so the client can retry', async () => {
      repo.delete.mockResolvedValue({ affected: 1 } as never);

      await service.release('record-id');

      expect(repo.delete).toHaveBeenCalledWith('record-id');
    });
  });

  describe('waitForCompletion', () => {
    it('returns the completed record once the owner finishes', async () => {
      const completed = record();
      repo.findOne
        .mockResolvedValueOnce(
          record({ status: IdempotencyRecordStatus.IN_PROGRESS }),
        )
        .mockResolvedValueOnce(completed);

      const result = await service.waitForCompletion('record-id', 500);

      expect(result).toEqual(completed);
    });

    it('returns null if the owner does not finish in time', async () => {
      repo.findOne.mockResolvedValue(
        record({ status: IdempotencyRecordStatus.IN_PROGRESS }),
      );

      const result = await service.waitForCompletion('record-id', 50);

      expect(result).toBeNull();
    });
  });

  describe('cleanupExpired', () => {
    it('deletes expired records and stale in-progress claims', async () => {
      const deleteBuilder = {
        where: jest.fn().mockReturnThis(),
        orWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 3 }),
      };
      repo.createQueryBuilder.mockReturnValue({
        delete: jest.fn().mockReturnValue(deleteBuilder),
      } as never);

      const deleted = await service.cleanupExpired(new Date());

      expect(deleted).toBe(3);
      expect(deleteBuilder.where).toHaveBeenCalled();
      expect(deleteBuilder.orWhere).toHaveBeenCalled();
    });
  });

  describe('hashRequest', () => {
    it('is stable for the same method, route and body', () => {
      const a = IdempotencyService.hashRequest('POST', '/x', { a: 1 });
      const b = IdempotencyService.hashRequest('POST', '/x', { a: 1 });
      expect(a).toBe(b);
    });

    it('differs when the body changes', () => {
      const a = IdempotencyService.hashRequest('POST', '/x', { a: 1 });
      const b = IdempotencyService.hashRequest('POST', '/x', { a: 2 });
      expect(a).not.toBe(b);
    });
  });
});
