/**
 * @file portfolio-n-plus-one.spec.ts
 *
 * Regression guard for N+1 patterns in PortfolioService.
 *
 * Acceptance criterion from Issue #1420:
 *   "A test asserts query count stays bounded for a list endpoint as
 *    result size grows."
 *
 * Strategy
 * --------
 * We spy on `PriceService.getPricesForAssets` (the batch method introduced
 * by this fix).  When the service is N+1-free, that method is called exactly
 * once per snapshot creation regardless of how many assets are in the
 * portfolio.  The test creates snapshots for portfolios of increasing sizes
 * (1, 5, 10 assets) and asserts the call count is always 1.
 *
 * If anyone reverts the fix and re-introduces per-asset `getCurrentPrice`
 * calls, the spy count will equal the number of assets and the test will
 * fail.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PortfolioService } from './portfolio.service';
import { PortfolioSnapshot } from './entities/portfolio-snapshot.entity';
import { PortfolioAsset } from './portfolio-asset.entity';
import { User } from '../users/entities/user.entity';
import { StellarBalanceService } from './stellar-balance.service';
import { StellarService } from '../stellar/stellar.service';
import { PriceService } from '../price/price.service';
import { ExchangeRatesService } from '../exchange-rates/exchange-rates.service';
import { PortfolioSnapshotQueueService } from './queue/portfolio-snapshot.queue.service';
import { MaterializedSnapshotService } from './materialized-snapshot.service';
import { QueryProfilerService } from '../common/profiling/query-profiler.service';

// ─── Minimal stub factories ───────────────────────────────────────────────────

const mockUser = (id: string) => ({
  id,
  email: `${id}@test.com`,
  stellarAccounts: [],
});

const makeRepo = (entity?: unknown) => ({
  findOne: jest.fn().mockResolvedValue(entity ?? null),
  find: jest.fn().mockResolvedValue([]),
  create: jest.fn().mockImplementation((dto: unknown) => dto),
  save: jest.fn().mockImplementation((e: unknown) => Promise.resolve({ id: 'snap-1', ...e as object })),
  findAndCount: jest.fn().mockResolvedValue([[], 0]),
  createQueryBuilder: jest.fn().mockReturnValue({
    select: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    having: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue([]),
  }),
  query: jest.fn().mockResolvedValue([]),
});

const makeBalancesForAssets = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    assetCode: i === 0 ? 'XLM' : `TOKEN${i}`,
    assetIssuer: i === 0 ? null : `GISSUER${i}`,
    balance: '100',
  }));

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('PortfolioService – N+1 regression guard', () => {
  let service: PortfolioService;
  let priceService: PriceService;
  let stellarBalanceService: StellarBalanceService;
  let getPricesForAssetsSpy: jest.SpyInstance;

  const userId = 'user-test-123';

  beforeEach(async () => {
    const userRepo = makeRepo(mockUser(userId));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PortfolioService,
        {
          provide: getRepositoryToken(PortfolioSnapshot),
          useValue: makeRepo(),
        },
        {
          provide: getRepositoryToken(PortfolioAsset),
          useValue: makeRepo(),
        },
        {
          provide: getRepositoryToken(User),
          useValue: userRepo,
        },
        {
          provide: StellarBalanceService,
          useValue: {
            getAccountBalances: jest.fn(),
            getAssetValueUsd: jest.fn(),
            getAssetValuesUsd: jest.fn(),
          },
        },
        {
          provide: StellarService,
          useValue: {},
        },
        {
          provide: PriceService,
          useValue: {
            getCurrentPrice: jest.fn().mockResolvedValue(0.12),
            getPricesForAssets: jest.fn().mockResolvedValue(new Map([['XLM', 0.12], ['USDC', 1.0]])),
          },
        },
        {
          provide: ExchangeRatesService,
          useValue: {
            getExchangeRate: jest.fn().mockResolvedValue(1),
          },
        },
        {
          provide: PortfolioSnapshotQueueService,
          useValue: {
            enqueueSnapshotBatch: jest.fn(),
            getBatchStatus: jest.fn(),
          },
        },
        {
          provide: MaterializedSnapshotService,
          useValue: {
            getForUser: jest.fn().mockResolvedValue(null),
            upsertForUser: jest.fn().mockResolvedValue(undefined),
            computeAllocation: jest.fn().mockReturnValue([]),
            refreshForUser: jest.fn().mockResolvedValue(true),
          },
        },
        {
          provide: QueryProfilerService,
          useValue: {
            profile: jest.fn().mockImplementation((fn: () => Promise<unknown>) => fn()),
            trackCall: jest.fn(),
            getCallCount: jest.fn().mockReturnValue(-1),
            isEnabled: false,
          },
        },
      ],
    }).compile();

    service = module.get<PortfolioService>(PortfolioService);
    priceService = module.get<PriceService>(PriceService);
    stellarBalanceService = module.get<StellarBalanceService>(StellarBalanceService);

    getPricesForAssetsSpy = jest.spyOn(priceService, 'getPricesForAssets');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  /**
   * Core assertion: no matter how many assets a portfolio has, we must call
   * `getPricesForAssets` exactly once (not once per asset).
   */
  describe('createSnapshot – price call count is O(1) not O(N)', () => {
    const sizes = [1, 5, 10];

    sizes.forEach((n) => {
      it(`portfolio with ${n} asset(s) → exactly 1 batch price call`, async () => {
        const balances = makeBalancesForAssets(n);

        // Stub stellar balance service to return N balances
        jest
          .spyOn(stellarBalanceService, 'getAccountBalances')
          .mockResolvedValue(balances);

        // Stub the batch method to return priced results
        const priceMap = new Map<string, number>(
          balances.map((b) => [b.assetCode, 0.12]),
        );
        getPricesForAssetsSpy.mockResolvedValue(priceMap);

        // Wire up getAssetValuesUsd to use the batch price method
        jest
          .spyOn(stellarBalanceService, 'getAssetValuesUsd')
          .mockImplementation(async (assets) => {
            const map = await priceService.getPricesForAssets(
              assets.map((a) => a.assetCode),
            );
            return assets.map((a) => ({
              ...a,
              valueUsd: parseFloat(a.amount) * (map.get(a.assetCode) ?? 0),
            }));
          });

        await service.createSnapshot(userId);

        // Should have called getPricesForAssets exactly once regardless of N
        expect(getPricesForAssetsSpy).toHaveBeenCalledTimes(1);

        // The single call must have received ALL asset codes at once
        const callArgs = getPricesForAssetsSpy.mock.calls[0][0] as string[];
        expect(callArgs.length).toBe(n);
      });
    });

    it('call count does NOT grow with portfolio size (O(1) assertion)', async () => {
      const callCounts: number[] = [];

      for (const n of sizes) {
        getPricesForAssetsSpy.mockClear();

        const balances = makeBalancesForAssets(n);
        jest
          .spyOn(stellarBalanceService, 'getAccountBalances')
          .mockResolvedValue(balances);

        const priceMap = new Map<string, number>(
          balances.map((b) => [b.assetCode, 0.12]),
        );
        getPricesForAssetsSpy.mockResolvedValue(priceMap);

        jest
          .spyOn(stellarBalanceService, 'getAssetValuesUsd')
          .mockImplementation(async (assets) => {
            const map = await priceService.getPricesForAssets(
              assets.map((a) => a.assetCode),
            );
            return assets.map((a) => ({
              ...a,
              valueUsd: parseFloat(a.amount) * (map.get(a.assetCode) ?? 0),
            }));
          });

        await service.createSnapshot(userId);
        callCounts.push(getPricesForAssetsSpy.mock.calls.length);
      }

      // All counts must be equal (1) — not growing with portfolio size
      const unique = new Set(callCounts);
      expect(unique.size).toBe(1);
      expect(callCounts[0]).toBe(1);
    });
  });

  /**
   * getAssetAllocation – the slow-path (no materialized snapshot) should also
   * make exactly 1 price batch call regardless of how many assets are present.
   */
  describe('getAssetAllocation – price call count is O(1) not O(N)', () => {
    const sizes = [1, 5, 10];

    sizes.forEach((n) => {
      it(`${n} aggregated asset(s) → exactly 1 batch price call`, async () => {
        const userWithAccounts = {
          ...mockUser(userId),
          stellarAccounts: [{ publicKey: 'GPUBKEY', isActive: true }],
        };

        // Return a user with one linked account
        jest
          .spyOn(
            service['userRepository'],
            'findOne',
          )
          .mockResolvedValue(userWithAccounts as unknown as User);

        // No materialized snapshot → falls back to live computation
        jest
          .spyOn(
            service['materializedSnapshotService'],
            'getForUser',
          )
          .mockResolvedValue(null);

        const balances = makeBalancesForAssets(n);
        jest
          .spyOn(stellarBalanceService, 'getAccountBalances')
          .mockResolvedValue(balances);

        const priceMap = new Map<string, number>(
          balances.map((b) => [b.assetCode, 0.12]),
        );
        getPricesForAssetsSpy.mockResolvedValue(priceMap);

        jest
          .spyOn(stellarBalanceService, 'getAssetValuesUsd')
          .mockImplementation(async (assets) => {
            const map = await priceService.getPricesForAssets(
              assets.map((a) => a.assetCode),
            );
            return assets.map((a) => ({
              ...a,
              valueUsd: parseFloat(a.amount) * (map.get(a.assetCode) ?? 0),
            }));
          });

        await service.getAssetAllocation(userId);

        expect(getPricesForAssetsSpy).toHaveBeenCalledTimes(1);
      });
    });
  });
});
