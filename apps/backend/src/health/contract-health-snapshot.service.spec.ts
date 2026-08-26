import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { ContractHealthReport } from './contract-health.service';
import { ContractHealthService } from './contract-health.service';
import { ContractHealthSnapshotRepository } from './contract-health-snapshot.repository';
import { ContractHealthSnapshotService } from './contract-health-snapshot.service';
import type { ContractHealthSnapshot } from './entities/contract-health-snapshot.entity';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const SNAPSHOT_BASE: ContractHealthSnapshot = {
  id: 'aaa-111',
  capturedAt: new Date('2025-01-01T00:00:00Z'),
  network: 'testnet',
  overallStatus: 'ok',
  summary: { total: 6, reachable: 6, misconfigured: 0, unreachable: 0 },
  contracts: [
    {
      name: 'lumenToken',
      envVar: 'STELLAR_CONTRACT_LUMEN_TOKEN',
      configured: true,
      status: 'reachable',
      contractId: 'ABCDEF...UVWXYZ',
      readMethods: [
        { method: 'decimals', status: 'ok' },
        { method: 'symbol', status: 'ok' },
      ],
    },
    {
      name: 'treasury',
      envVar: 'STELLAR_CONTRACT_TREASURY',
      configured: true,
      status: 'reachable',
      contractId: 'GHIJKL...MNOPQR',
      readMethods: [
        { method: 'get_admin', status: 'ok' },
        { method: 'get_token', status: 'ok' },
      ],
    },
  ],
  triggeredBy: 'scheduler',
  createdAt: new Date('2025-01-01T00:00:01Z'),
};

const SNAPSHOT_LATER: ContractHealthSnapshot = {
  ...SNAPSHOT_BASE,
  id: 'bbb-222',
  capturedAt: new Date('2025-01-01T00:30:00Z'),
  overallStatus: 'error',
  summary: { total: 6, reachable: 4, misconfigured: 0, unreachable: 2 },
  contracts: [
    {
      name: 'lumenToken',
      envVar: 'STELLAR_CONTRACT_LUMEN_TOKEN',
      configured: true,
      // Status changed: reachable → unreachable
      status: 'unreachable',
      contractId: 'ABCDEF...UVWXYZ',
      readMethods: [
        { method: 'decimals', status: 'failed' },
        { method: 'symbol', status: 'ok' },
      ],
    },
    {
      name: 'treasury',
      envVar: 'STELLAR_CONTRACT_TREASURY',
      configured: true,
      status: 'reachable',
      contractId: 'GHIJKL...MNOPQR',
      readMethods: [
        { method: 'get_admin', status: 'ok' },
        { method: 'get_token', status: 'ok' },
      ],
    },
  ],
  triggeredBy: 'scheduler',
  createdAt: new Date('2025-01-01T00:30:01Z'),
};

const MOCK_HEALTH_REPORT: ContractHealthReport = {
  status: 'ok',
  summary: { total: 6, reachable: 6, misconfigured: 0, unreachable: 0 },
  network: 'testnet',
  checkedAt: '2025-01-01T01:00:00.000Z',
  contracts: SNAPSHOT_BASE.contracts,
};

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

const mockContractHealthService = () => ({
  getContractHealthReport: jest.fn<Promise<ContractHealthReport>, []>(),
});

const mockSnapshotRepo = () => ({
  save: jest.fn<
    Promise<ContractHealthSnapshot>,
    [Partial<ContractHealthSnapshot>]
  >(),
  findLatest: jest.fn<Promise<ContractHealthSnapshot | null>, [string?]>(),
  findHistory: jest.fn<Promise<ContractHealthSnapshot[]>, [object?]>(),
  findById: jest.fn<Promise<ContractHealthSnapshot | null>, [string]>(),
  findLatestTwo: jest.fn<
    Promise<[ContractHealthSnapshot | null, ContractHealthSnapshot | null]>,
    [string?]
  >(),
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ContractHealthSnapshotService', () => {
  let service: ContractHealthSnapshotService;
  let healthService: ReturnType<typeof mockContractHealthService>;
  let repo: ReturnType<typeof mockSnapshotRepo>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractHealthSnapshotService,
        {
          provide: ContractHealthService,
          useFactory: mockContractHealthService,
        },
        {
          provide: ContractHealthSnapshotRepository,
          useFactory: mockSnapshotRepo,
        },
      ],
    }).compile();

    service = module.get(ContractHealthSnapshotService);
    healthService = module.get(ContractHealthService);
    repo = module.get(ContractHealthSnapshotRepository);
  });

  afterEach(() => jest.clearAllMocks());

  // -------------------------------------------------------------------------
  // captureSnapshot
  // -------------------------------------------------------------------------

  describe('captureSnapshot', () => {
    it('calls ContractHealthService, persists the result, and returns the saved entity', async () => {
      healthService.getContractHealthReport.mockResolvedValue(
        MOCK_HEALTH_REPORT,
      );
      const saved: ContractHealthSnapshot = {
        ...SNAPSHOT_BASE,
        triggeredBy: 'scheduler',
      };
      repo.save.mockResolvedValue(saved);

      const result = await service.captureSnapshot('scheduler');

      expect(healthService.getContractHealthReport).toHaveBeenCalledTimes(1);
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          network: 'testnet',
          overallStatus: 'ok',
          summary: MOCK_HEALTH_REPORT.summary,
          contracts: MOCK_HEALTH_REPORT.contracts,
          triggeredBy: 'scheduler',
        }),
      );
      expect(result).toBe(saved);
    });

    it('passes triggeredBy=manual when called explicitly', async () => {
      healthService.getContractHealthReport.mockResolvedValue(
        MOCK_HEALTH_REPORT,
      );
      const saved: ContractHealthSnapshot = {
        ...SNAPSHOT_BASE,
        triggeredBy: 'manual',
      };
      repo.save.mockResolvedValue(saved);

      await service.captureSnapshot('manual');

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ triggeredBy: 'manual' }),
      );
    });

    it('propagates errors from ContractHealthService', async () => {
      healthService.getContractHealthReport.mockRejectedValue(
        new Error('rpc unavailable'),
      );

      await expect(service.captureSnapshot()).rejects.toThrow(
        'rpc unavailable',
      );
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('converts checkedAt ISO string to a Date for capturedAt', async () => {
      const checkedAt = '2025-06-01T12:00:00.000Z';
      healthService.getContractHealthReport.mockResolvedValue({
        ...MOCK_HEALTH_REPORT,
        checkedAt,
      });
      repo.save.mockResolvedValue(SNAPSHOT_BASE);

      await service.captureSnapshot();

      const savedArg = repo.save.mock.calls[0][0];
      expect(savedArg.capturedAt).toEqual(new Date(checkedAt));
    });
  });

  // -------------------------------------------------------------------------
  // getLatest
  // -------------------------------------------------------------------------

  describe('getLatest', () => {
    it('returns the snapshot when one exists', async () => {
      repo.findLatest.mockResolvedValue(SNAPSHOT_BASE);

      const result = await service.getLatest();

      expect(result).toBe(SNAPSHOT_BASE);
    });

    it('throws NotFoundException when no snapshots exist', async () => {
      repo.findLatest.mockResolvedValue(null);

      await expect(service.getLatest()).rejects.toThrow(NotFoundException);
    });

    it('passes network filter to the repository', async () => {
      repo.findLatest.mockResolvedValue(SNAPSHOT_BASE);

      await service.getLatest('testnet');

      expect(repo.findLatest).toHaveBeenCalledWith('testnet');
    });
  });

  // -------------------------------------------------------------------------
  // getHistory
  // -------------------------------------------------------------------------

  describe('getHistory', () => {
    it('delegates to the repository and returns rows', async () => {
      const rows = [SNAPSHOT_LATER, SNAPSHOT_BASE];
      repo.findHistory.mockResolvedValue(rows);

      const result = await service.getHistory({ limit: 10, offset: 0 });

      expect(repo.findHistory).toHaveBeenCalledWith({ limit: 10, offset: 0 });
      expect(result).toBe(rows);
    });

    it('returns an empty array when no history exists', async () => {
      repo.findHistory.mockResolvedValue([]);

      const result = await service.getHistory();

      expect(result).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // getById
  // -------------------------------------------------------------------------

  describe('getById', () => {
    it('returns the snapshot when found', async () => {
      repo.findById.mockResolvedValue(SNAPSHOT_BASE);

      const result = await service.getById('aaa-111');

      expect(repo.findById).toHaveBeenCalledWith('aaa-111');
      expect(result).toBe(SNAPSHOT_BASE);
    });

    it('throws NotFoundException when id does not exist', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(service.getById('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // getDiff — no drift
  // -------------------------------------------------------------------------

  describe('getDiff — no drift', () => {
    it('returns noDrift=true when both snapshots are identical', async () => {
      repo.findLatestTwo.mockResolvedValue([SNAPSHOT_BASE, SNAPSHOT_BASE]);

      const diff = await service.getDiff();

      expect(diff.noDrift).toBe(true);
      expect(diff.contractStatusChanges).toHaveLength(0);
      expect(diff.readMethodChanges).toHaveLength(0);
      expect(diff.overallStatusChange).toBe('unchanged');
      expect(diff.summaryDelta).toEqual({
        reachable: 0,
        misconfigured: 0,
        unreachable: 0,
      });
    });
  });

  // -------------------------------------------------------------------------
  // getDiff — contract status drift detected
  // -------------------------------------------------------------------------

  describe('getDiff — contract status change', () => {
    it('reports a contract moving from reachable to unreachable as degraded', async () => {
      // findLatestTwo returns [current, baseline]
      repo.findLatestTwo.mockResolvedValue([SNAPSHOT_LATER, SNAPSHOT_BASE]);

      const diff = await service.getDiff();

      expect(diff.overallStatusChange).toBe('degraded');
      expect(diff.contractStatusChanges).toEqual([
        { name: 'lumenToken', from: 'reachable', to: 'unreachable' },
      ]);
    });

    it('reports a contract recovering as improved at the overall level', async () => {
      const recovered: ContractHealthSnapshot = {
        ...SNAPSHOT_BASE,
        id: 'ccc-333',
        capturedAt: new Date('2025-01-01T01:00:00Z'),
      };
      // baseline is the errored snapshot, current has recovered
      repo.findLatestTwo.mockResolvedValue([recovered, SNAPSHOT_LATER]);

      const diff = await service.getDiff();

      expect(diff.overallStatusChange).toBe('improved');
    });
  });

  // -------------------------------------------------------------------------
  // getDiff — read method drift detected
  // -------------------------------------------------------------------------

  describe('getDiff — read method change', () => {
    it('records individual read method status transitions', async () => {
      repo.findLatestTwo.mockResolvedValue([SNAPSHOT_LATER, SNAPSHOT_BASE]);

      const diff = await service.getDiff();

      expect(diff.readMethodChanges).toContainEqual({
        contractName: 'lumenToken',
        method: 'decimals',
        from: 'ok',
        to: 'failed',
      });
    });

    it('does not report unchanged read methods', async () => {
      repo.findLatestTwo.mockResolvedValue([SNAPSHOT_LATER, SNAPSHOT_BASE]);

      const diff = await service.getDiff();

      // symbol stayed ok → should not appear
      const symbolChange = diff.readMethodChanges.find(
        (c) => c.contractName === 'lumenToken' && c.method === 'symbol',
      );
      expect(symbolChange).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // getDiff — explicit id pair
  // -------------------------------------------------------------------------

  describe('getDiff — explicit ids', () => {
    it('fetches both snapshots by id and diffs them', async () => {
      repo.findById
        .mockResolvedValueOnce(SNAPSHOT_BASE) // baseline
        .mockResolvedValueOnce(SNAPSHOT_LATER); // current

      const diff = await service.getDiff('aaa-111', 'bbb-222');

      expect(repo.findById).toHaveBeenCalledWith('aaa-111');
      expect(repo.findById).toHaveBeenCalledWith('bbb-222');
      expect(diff.baselineId).toBe('aaa-111');
      expect(diff.currentId).toBe('bbb-222');
    });

    it('throws NotFoundException when baseline id is unknown', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(service.getDiff('unknown', 'bbb-222')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // getDiff — not enough snapshots
  // -------------------------------------------------------------------------

  describe('getDiff — insufficient history', () => {
    it('throws NotFoundException when only one snapshot exists', async () => {
      repo.findLatestTwo.mockResolvedValue([SNAPSHOT_BASE, null]);

      await expect(service.getDiff()).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when zero snapshots exist', async () => {
      repo.findLatestTwo.mockResolvedValue([null, null]);

      await expect(service.getDiff()).rejects.toThrow(NotFoundException);
    });
  });

  // -------------------------------------------------------------------------
  // getDiff — summary delta correctness
  // -------------------------------------------------------------------------

  describe('getDiff — summary delta', () => {
    it('computes positive unreachable delta when contracts degrade', async () => {
      repo.findLatestTwo.mockResolvedValue([SNAPSHOT_LATER, SNAPSHOT_BASE]);

      const diff = await service.getDiff();

      expect(diff.summaryDelta.unreachable).toBe(2); // 2 - 0
      expect(diff.summaryDelta.reachable).toBe(-2); // 4 - 6
      expect(diff.summaryDelta.misconfigured).toBe(0);
    });

    it('includes capturedAt timestamps for both snapshots', async () => {
      repo.findLatestTwo.mockResolvedValue([SNAPSHOT_LATER, SNAPSHOT_BASE]);

      const diff = await service.getDiff();

      expect(diff.baselineCapturedAt).toBe(
        SNAPSHOT_BASE.capturedAt.toISOString(),
      );
      expect(diff.currentCapturedAt).toBe(
        SNAPSHOT_LATER.capturedAt.toISOString(),
      );
    });
  });
});
