import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MaterializedSnapshotService } from './materialized-snapshot.service';
import { PortfolioMaterializedSnapshot } from './entities/portfolio-materialized-snapshot.entity';
import { PortfolioSnapshot } from './entities/portfolio-snapshot.entity';

const USER_ID = 'user-123';
const SNAPSHOT_ID = 'snapshot-456';

const makeAssetBalances = () => [
  { assetCode: 'XLM', assetIssuer: null, amount: '1000.0000', valueUsd: 100.0 },
  {
    assetCode: 'USDC',
    assetIssuer: 'issuer-abc',
    amount: '500.0000',
    valueUsd: 500.0,
  },
];

const makeMaterializedRow = (
  overrides: Partial<PortfolioMaterializedSnapshot> = {},
): PortfolioMaterializedSnapshot =>
  ({
    id: 'mat-789',
    userId: USER_ID,
    totalValueUsd: '600.00',
    assetBalances: makeAssetBalances(),
    assetAllocation: [
      {
        assetCode: 'XLM',
        assetIssuer: null,
        amount: '1000.0000',
        valueUsd: 100.0,
        percentage: 16.6667,
      },
      {
        assetCode: 'USDC',
        assetIssuer: 'issuer-abc',
        amount: '500.0000',
        valueUsd: 500.0,
        percentage: 83.3333,
      },
    ],
    hasLinkedAccount: true,
    sourceSnapshotId: SNAPSHOT_ID,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as PortfolioMaterializedSnapshot;

const makeSnapshot = (): PortfolioSnapshot =>
  ({
    id: SNAPSHOT_ID,
    userId: USER_ID,
    assetBalances: makeAssetBalances(),
    totalValueUsd: '600.00',
    createdAt: new Date(),
  }) as PortfolioSnapshot;

describe('MaterializedSnapshotService', () => {
  let service: MaterializedSnapshotService;
  let materializedRepo: jest.Mocked<Repository<PortfolioMaterializedSnapshot>>;
  let snapshotRepo: jest.Mocked<Repository<PortfolioSnapshot>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MaterializedSnapshotService,
        {
          provide: getRepositoryToken(PortfolioMaterializedSnapshot),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            delete: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(PortfolioSnapshot),
          useValue: {
            findOne: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(MaterializedSnapshotService);
    materializedRepo = module.get(
      getRepositoryToken(PortfolioMaterializedSnapshot),
    );
    snapshotRepo = module.get(getRepositoryToken(PortfolioSnapshot));
  });

  afterEach(() => jest.clearAllMocks());

  describe('upsertForUser', () => {
    it('creates a new materialized snapshot when none exists', async () => {
      materializedRepo.findOne.mockResolvedValue(null);
      const newRow = makeMaterializedRow();
      materializedRepo.create.mockReturnValue(newRow);
      materializedRepo.save.mockResolvedValue(newRow);

      const result = await service.upsertForUser({
        userId: USER_ID,
        totalValueUsd: '600.00',
        assetBalances: makeAssetBalances(),
        hasLinkedAccount: true,
        sourceSnapshotId: SNAPSHOT_ID,
      });

      expect(materializedRepo.findOne).toHaveBeenCalledWith({
        where: { userId: USER_ID },
      });
      expect(materializedRepo.create).toHaveBeenCalled();
      expect(materializedRepo.save).toHaveBeenCalled();
      expect(result).toBe(newRow);
    });

    it('updates an existing materialized snapshot', async () => {
      const existing = makeMaterializedRow();
      materializedRepo.findOne.mockResolvedValue(existing);
      materializedRepo.save.mockImplementation((entity) =>
        Promise.resolve(entity as PortfolioMaterializedSnapshot),
      );

      const result = await service.upsertForUser({
        userId: USER_ID,
        totalValueUsd: '900.00',
        assetBalances: makeAssetBalances(),
        assetAllocation: null,
        hasLinkedAccount: true,
        sourceSnapshotId: 'new-snapshot-id',
      });

      expect(materializedRepo.findOne).toHaveBeenCalledWith({
        where: { userId: USER_ID },
      });
      expect(existing.totalValueUsd).toBe('900.00');
      expect(existing.sourceSnapshotId).toBe('new-snapshot-id');
      expect(materializedRepo.save).toHaveBeenCalledWith(existing);
      expect(result.totalValueUsd).toBe('900.00');
    });

    it('preserves existing assetAllocation when not provided in update', async () => {
      const existing = makeMaterializedRow();
      const originalAllocation = existing.assetAllocation;
      materializedRepo.findOne.mockResolvedValue(existing);
      materializedRepo.save.mockImplementation((entity) =>
        Promise.resolve(entity as PortfolioMaterializedSnapshot),
      );

      await service.upsertForUser({
        userId: USER_ID,
        totalValueUsd: '700.00',
        assetBalances: makeAssetBalances(),
        hasLinkedAccount: true,
        sourceSnapshotId: SNAPSHOT_ID,
        // assetAllocation not provided — should keep existing
      });

      expect(existing.assetAllocation).toBe(originalAllocation);
    });
  });

  describe('getForUser', () => {
    it('returns the materialized snapshot when it exists', async () => {
      const row = makeMaterializedRow();
      materializedRepo.findOne.mockResolvedValue(row);

      const result = await service.getForUser(USER_ID);

      expect(materializedRepo.findOne).toHaveBeenCalledWith({
        where: { userId: USER_ID },
      });
      expect(result).toBe(row);
    });

    it('returns null when no materialized snapshot exists', async () => {
      materializedRepo.findOne.mockResolvedValue(null);

      const result = await service.getForUser(USER_ID);

      expect(result).toBeNull();
    });
  });

  describe('refreshForUser', () => {
    it('returns false when user has no snapshots', async () => {
      snapshotRepo.findOne.mockResolvedValue(null);

      const result = await service.refreshForUser(USER_ID);

      expect(result).toBe(false);
      expect(materializedRepo.save).not.toHaveBeenCalled();
    });

    it('upserts materialized snapshot from latest snapshot data', async () => {
      const snapshot = makeSnapshot();
      snapshotRepo.findOne.mockResolvedValue(snapshot);

      const newRow = makeMaterializedRow();
      materializedRepo.findOne.mockResolvedValue(null);
      materializedRepo.create.mockReturnValue(newRow);
      materializedRepo.save.mockResolvedValue(newRow);

      const result = await service.refreshForUser(USER_ID);

      expect(result).toBe(true);
      expect(snapshotRepo.findOne).toHaveBeenCalledWith({
        where: { userId: USER_ID },
        order: { createdAt: 'DESC' },
      });
      expect(materializedRepo.save).toHaveBeenCalled();
    });

    it('computes allocation with correct percentages', async () => {
      const snapshot = makeSnapshot();
      snapshotRepo.findOne.mockResolvedValue(snapshot);

      materializedRepo.findOne.mockResolvedValue(null);

      let savedData: any = null;
      materializedRepo.create.mockImplementation((data: any) => {
        savedData = data;
        return data as PortfolioMaterializedSnapshot;
      });
      materializedRepo.save.mockImplementation((entity) =>
        Promise.resolve(entity as PortfolioMaterializedSnapshot),
      );

      await service.refreshForUser(USER_ID);

      expect(savedData.assetAllocation).toEqual([
        {
          assetCode: 'XLM',
          assetIssuer: null,
          amount: '1000.0000',
          valueUsd: 100.0,
          percentage: expectCloseTo.create(16.6667, 0.01),
        },
        {
          assetCode: 'USDC',
          assetIssuer: 'issuer-abc',
          amount: '500.0000',
          valueUsd: 500.0,
          percentage: expectCloseTo.create(83.3333, 0.01),
        },
      ]);
    });
  });

  describe('deleteForUser', () => {
    it('deletes the materialized snapshot for the user', async () => {
      materializedRepo.delete.mockResolvedValue({ affected: 1 } as any);

      await service.deleteForUser(USER_ID);

      expect(materializedRepo.delete).toHaveBeenCalledWith({ userId: USER_ID });
    });
  });

  describe('computeAllocation', () => {
    it('computes correct percentages for multiple assets', () => {
      const balances = [
        { assetCode: 'XLM', assetIssuer: null, amount: '1000', valueUsd: 200 },
        { assetCode: 'USDC', assetIssuer: 'abc', amount: '500', valueUsd: 800 },
      ];

      const result = service.computeAllocation(balances);

      expect(result).toHaveLength(2);
      expect(result[0].percentage).toBeCloseTo(20, 1); // 200/1000 * 100
      expect(result[1].percentage).toBeCloseTo(80, 1); // 800/1000 * 100
    });

    it('returns 0% for all assets when total value is 0', () => {
      const balances = [
        { assetCode: 'XLM', assetIssuer: null, amount: '1000', valueUsd: 0 },
        { assetCode: 'USDC', assetIssuer: 'abc', amount: '500', valueUsd: 0 },
      ];

      const result = service.computeAllocation(balances);

      expect(result).toHaveLength(2);
      expect(result[0].percentage).toBe(0);
      expect(result[1].percentage).toBe(0);
    });

    it('returns 100% for a single asset', () => {
      const balances = [
        { assetCode: 'XLM', assetIssuer: null, amount: '1000', valueUsd: 500 },
      ];

      const result = service.computeAllocation(balances);

      expect(result).toHaveLength(1);
      expect(result[0].percentage).toBe(100);
    });

    it('handles empty balances array', () => {
      const result = service.computeAllocation([]);
      expect(result).toHaveLength(0);
    });

    it('preserves asset fields in the output', () => {
      const balances = [
        {
          assetCode: 'XLM',
          assetIssuer: 'issuer-123',
          amount: '500.00',
          valueUsd: 250,
        },
      ];

      const result = service.computeAllocation(balances);

      expect(result[0].assetCode).toBe('XLM');
      expect(result[0].assetIssuer).toBe('issuer-123');
      expect(result[0].amount).toBe('500.00');
      expect(result[0].valueUsd).toBe(250);
      expect(result[0].percentage).toBe(100);
    });
  });
});

/**
 * Custom Jest matcher helper for close-to percentage checks.
 */
const expectCloseTo = {
  create(expected: number, tolerance: number) {
    return {
      $$typeof: Symbol.for('jest.asymmetricMatcher'),
      asymmetricMatch(received: number) {
        return Math.abs(received - expected) <= tolerance;
      },
      toString() {
        return `expectCloseTo(${expected}, ±${tolerance})`;
      },
    };
  },
};
