import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { SorobanEventIndexerService } from './soroban-event-indexer.service';
import { SorobanEvent } from './entities/soroban-event.entity';
import { SorobanIndexerCursor } from './entities/soroban-indexer-cursor.entity';
import { SorobanRpcClientService } from '../stellar/services/soroban-rpc-client.service';
import { JobLockService } from '../scheduler/job-lock.service';
import { JobHistoryService } from '../scheduler/job-history.service';

describe('SorobanEventIndexerService', () => {
  let service: SorobanEventIndexerService;
  let mockEventRepo: any;
  let mockCursorRepo: any;
  let mockRpcClient: any;
  let mockJobLock: any;
  let mockJobHistory: any;
  let mockConfigService: any;

  const mockCursors: Record<string, SorobanIndexerCursor> = {};

  beforeEach(async () => {
    mockEventRepo = {
      upsert: jest.fn().mockResolvedValue(undefined),
    };

    mockCursorRepo = {
      findOne: jest.fn().mockImplementation(({ where }) => {
        return Promise.resolve(mockCursors[where.cursorKey] || null);
      }),
      save: jest.fn().mockImplementation((entity) => {
        mockCursors[entity.cursorKey] = {
          cursorKey: entity.cursorKey,
          lastLedgerSequence: entity.lastLedgerSequence,
          updatedAt: new Date(),
        };
        return Promise.resolve(mockCursors[entity.cursorKey]);
      }),
      create: jest.fn().mockImplementation((dto) => dto),
    };

    mockRpcClient = {
      rawServer: {
        getLatestLedger: jest.fn().mockResolvedValue({ sequence: 3000 }),
        getEvents: jest.fn().mockResolvedValue({
          events: [],
          cursor: undefined,
        }),
      },
    };

    mockJobLock = {
      withLock: jest.fn().mockImplementation((name, fn) => fn()),
    };

    mockJobHistory = {
      start: jest.fn().mockResolvedValue('run-123'),
      complete: jest.fn().mockResolvedValue(undefined),
      fail: jest.fn().mockResolvedValue(undefined),
    };

    mockConfigService = {
      get: jest.fn().mockReturnValue(0),
    };

    // Reset mock cursors
    Object.keys(mockCursors).forEach((key) => delete mockCursors[key]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SorobanEventIndexerService,
        { provide: SorobanRpcClientService, useValue: mockRpcClient },
        { provide: JobLockService, useValue: mockJobLock },
        { provide: JobHistoryService, useValue: mockJobHistory },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: getRepositoryToken(SorobanEvent), useValue: mockEventRepo },
        { provide: getRepositoryToken(SorobanIndexerCursor), useValue: mockCursorRepo },
      ],
    }).compile();

    service = module.get<SorobanEventIndexerService>(SorobanEventIndexerService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('backfill', () => {
    it('should start backfill from requested ledger and save incremental checkpoints', async () => {
      mockRpcClient.rawServer.getLatestLedger.mockResolvedValue({ sequence: 2500 });
      mockRpcClient.rawServer.getEvents.mockResolvedValue({
        events: [],
        cursor: undefined,
      });

      const result = await service.backfill(1);

      expect(result.resumedFromCheckpoint).toBe(false);
      expect(mockCursorRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          cursorKey: '__backfill__',
          lastLedgerSequence: expect.any(Number),
        }),
      );
      expect(mockCursors['__backfill__'].lastLedgerSequence).toBe(2500);
    });

    it('should resume from existing checkpoint to avoid duplicate processing', async () => {
      mockCursors['__backfill__'] = {
        cursorKey: '__backfill__',
        lastLedgerSequence: 1000,
        updatedAt: new Date(),
      };

      mockRpcClient.rawServer.getLatestLedger.mockResolvedValue({ sequence: 2000 });
      mockRpcClient.rawServer.getEvents.mockResolvedValue({
        events: [],
        cursor: undefined,
      });

      const result = await service.backfill();

      expect(result.resumedFromCheckpoint).toBe(true);
      expect(mockRpcClient.rawServer.getEvents).toHaveBeenCalledWith(
        expect.objectContaining({
          startLedger: 1001,
        }),
      );
      expect(mockCursors['__backfill__'].lastLedgerSequence).toBe(2000);
    });

    it('should update global cursor when backfill sequence advances past global high-water mark', async () => {
      mockCursors['__global__'] = {
        cursorKey: '__global__',
        lastLedgerSequence: 500,
        updatedAt: new Date(),
      };

      mockRpcClient.rawServer.getLatestLedger.mockResolvedValue({ sequence: 1000 });

      await service.backfill(1);

      expect(mockCursors['__global__'].lastLedgerSequence).toBe(1000);
    });

    it('should handle RPC failure gracefully during backfill', async () => {
      mockRpcClient.rawServer.getLatestLedger.mockRejectedValue(new Error('RPC connection failed'));

      const result = await service.backfill(1);

      expect(result.indexed).toBe(0);
      expect(mockJobHistory.complete).toHaveBeenCalledWith(
        'run-123',
        expect.objectContaining({ reason: 'rpc-unavailable' }),
      );
    });
  });

  describe('getBackfillCheckpoint', () => {
    it('should return null when no checkpoint exists', async () => {
      const checkpoint = await service.getBackfillCheckpoint();
      expect(checkpoint).toBeNull();
    });

    it('should return saved checkpoint entity', async () => {
      mockCursors['__backfill__'] = {
        cursorKey: '__backfill__',
        lastLedgerSequence: 1500,
        updatedAt: new Date(),
      };

      const checkpoint = await service.getBackfillCheckpoint();
      expect(checkpoint).toBeDefined();
      expect(checkpoint?.lastLedgerSequence).toBe(1500);
    });
  });
});
