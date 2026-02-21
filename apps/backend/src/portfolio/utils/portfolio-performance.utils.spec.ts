import {
  calculateBaselineDate,
  findClosestSnapshot,
  calculateWindowPerformance,
  calculatePortfolioPerformance,
  PERFORMANCE_WINDOWS,
  SnapshotData,
} from './portfolio-performance.utils';

describe('Portfolio Performance Utils', () => {
  describe('calculateBaselineDate', () => {
    it('should calculate correct baseline date for 24 hours', () => {
      const now = new Date('2026-02-20T12:00:00Z');
      const result = calculateBaselineDate(now, 24);
      expect(result).toEqual(new Date('2026-02-19T12:00:00Z'));
    });

    it('should calculate correct baseline date for 7 days', () => {
      const now = new Date('2026-02-20T12:00:00Z');
      const result = calculateBaselineDate(now, 24 * 7);
      expect(result).toEqual(new Date('2026-02-13T12:00:00Z'));
    });

    it('should calculate correct baseline date for 30 days', () => {
      const now = new Date('2026-02-20T12:00:00Z');
      const result = calculateBaselineDate(now, 24 * 30);
      expect(result).toEqual(new Date('2026-01-21T12:00:00Z'));
    });
  });

  describe('findClosestSnapshot', () => {
    it('should return null for empty snapshots array', () => {
      const result = findClosestSnapshot([], new Date('2026-02-20T12:00:00Z'));
      expect(result).toBeNull();
    });

    it('should find the closest snapshot before target date', () => {
      const snapshots: SnapshotData[] = [
        {
          id: '1',
          userId: 'user-1',
          createdAt: new Date('2026-02-19T10:00:00Z'),
          assetBalances: [],
          totalValueUsd: '100.00',
        },
        {
          id: '2',
          userId: 'user-1',
          createdAt: new Date('2026-02-19T14:00:00Z'),
          assetBalances: [],
          totalValueUsd: '110.00',
        },
        {
          id: '3',
          userId: 'user-1',
          createdAt: new Date('2026-02-20T10:00:00Z'),
          assetBalances: [],
          totalValueUsd: '120.00',
        },
      ];

      const targetDate = new Date('2026-02-19T15:00:00Z');
      const result = findClosestSnapshot(snapshots, targetDate);

      expect(result?.id).toBe('2');
      expect(result?.totalValueUsd).toBe('110.00');
    });

    it('should not consider snapshots after target date', () => {
      const snapshots: SnapshotData[] = [
        {
          id: '1',
          userId: 'user-1',
          createdAt: new Date('2026-02-19T10:00:00Z'),
          assetBalances: [],
          totalValueUsd: '100.00',
        },
        {
          id: '2',
          userId: 'user-1',
          createdAt: new Date('2026-02-21T10:00:00Z'),
          assetBalances: [],
          totalValueUsd: '120.00',
        },
      ];

      const targetDate = new Date('2026-02-20T12:00:00Z');
      const result = findClosestSnapshot(snapshots, targetDate);

      expect(result?.id).toBe('1');
    });

    it('should return exact match when available', () => {
      const exactDate = new Date('2026-02-19T12:00:00Z');
      const snapshots: SnapshotData[] = [
        {
          id: '1',
          userId: 'user-1',
          createdAt: exactDate,
          assetBalances: [],
          totalValueUsd: '100.00',
        },
      ];

      const result = findClosestSnapshot(snapshots, exactDate);

      expect(result?.id).toBe('1');
      expect(result?.createdAt).toEqual(exactDate);
    });
  });

  describe('calculateWindowPerformance', () => {
    it('should return hasData=false when baseline snapshot is null', () => {
      const result = calculateWindowPerformance(150.0, null, {
        window: '24h',
        hours: 24,
      });

      expect(result).toEqual({
        window: '24h',
        hasData: false,
        absolutePnl: null,
        percentageChange: null,
        currentValueUsd: 150.0,
        baselineValueUsd: null,
        baselineDate: null,
      });
    });

    it('should calculate positive performance correctly', () => {
      const baselineSnapshot: SnapshotData = {
        id: '1',
        userId: 'user-1',
        createdAt: new Date('2026-02-19T12:00:00Z'),
        assetBalances: [],
        totalValueUsd: '100.00',
      };

      const result = calculateWindowPerformance(150.0, baselineSnapshot, {
        window: '24h',
        hours: 24,
      });

      expect(result.hasData).toBe(true);
      expect(result.absolutePnl).toBe(50.0);
      expect(result.percentageChange).toBe(50.0);
      expect(result.currentValueUsd).toBe(150.0);
      expect(result.baselineValueUsd).toBe(100.0);
      expect(result.baselineDate).toEqual(new Date('2026-02-19T12:00:00Z'));
    });

    it('should calculate negative performance correctly', () => {
      const baselineSnapshot: SnapshotData = {
        id: '1',
        userId: 'user-1',
        createdAt: new Date('2026-02-19T12:00:00Z'),
        assetBalances: [],
        totalValueUsd: '200.00',
      };

      const result = calculateWindowPerformance(150.0, baselineSnapshot, {
        window: '24h',
        hours: 24,
      });

      expect(result.hasData).toBe(true);
      expect(result.absolutePnl).toBe(-50.0);
      expect(result.percentageChange).toBe(-25.0);
    });

    it('should handle zero baseline value gracefully', () => {
      const baselineSnapshot: SnapshotData = {
        id: '1',
        userId: 'user-1',
        createdAt: new Date('2026-02-19T12:00:00Z'),
        assetBalances: [],
        totalValueUsd: '0.00',
      };

      const result = calculateWindowPerformance(100.0, baselineSnapshot, {
        window: '24h',
        hours: 24,
      });

      expect(result.hasData).toBe(true);
      expect(result.absolutePnl).toBe(100.0);
      expect(result.percentageChange).toBe(0);
    });

    it('should round values to correct decimal places', () => {
      const baselineSnapshot: SnapshotData = {
        id: '1',
        userId: 'user-1',
        createdAt: new Date('2026-02-19T12:00:00Z'),
        assetBalances: [],
        totalValueUsd: '100.00',
      };

      const result = calculateWindowPerformance(133.333333, baselineSnapshot, {
        window: '24h',
        hours: 24,
      });

      expect(result.absolutePnl).toBe(33.33);
      expect(result.percentageChange).toBe(33.3333);
    });
  });

  describe('calculatePortfolioPerformance', () => {
    const mockNow = new Date('2026-02-20T12:00:00Z');

    it('should calculate performance for all windows with available data', () => {
      const snapshots: SnapshotData[] = [
        {
          id: '1',
          userId: 'user-1',
          createdAt: new Date('2026-02-19T12:00:00Z'), // 24h ago
          assetBalances: [],
          totalValueUsd: '100.00',
        },
        {
          id: '2',
          userId: 'user-1',
          createdAt: new Date('2026-02-13T12:00:00Z'), // 7d ago
          assetBalances: [],
          totalValueUsd: '80.00',
        },
        {
          id: '3',
          userId: 'user-1',
          createdAt: new Date('2026-01-21T12:00:00Z'), // 30d ago
          assetBalances: [],
          totalValueUsd: '50.00',
        },
      ];

      const result = calculatePortfolioPerformance(
        'user-1',
        150.0,
        snapshots,
        mockNow,
      );

      expect(result.userId).toBe('user-1');
      expect(result.currentValueUsd).toBe(150.0);
      expect(result.calculatedAt).toEqual(mockNow);
      expect(result.windows).toHaveLength(3);

      // 24h window
      const window24h = result.windows.find((w) => w.window === '24h');
      expect(window24h?.hasData).toBe(true);
      expect(window24h?.absolutePnl).toBe(50.0);
      expect(window24h?.percentageChange).toBe(50.0);

      // 7d window
      const window7d = result.windows.find((w) => w.window === '7d');
      expect(window7d?.hasData).toBe(true);
      expect(window7d?.absolutePnl).toBe(70.0);
      expect(window7d?.percentageChange).toBe(87.5);

      // 30d window
      const window30d = result.windows.find((w) => w.window === '30d');
      expect(window30d?.hasData).toBe(true);
      expect(window30d?.absolutePnl).toBe(100.0);
      expect(window30d?.percentageChange).toBe(200.0);
    });

    it('should handle missing historical data gracefully', () => {
      const snapshots: SnapshotData[] = [
        {
          id: '1',
          userId: 'user-1',
          createdAt: new Date('2026-02-19T12:00:00Z'), // Only 24h ago
          assetBalances: [],
          totalValueUsd: '100.00',
        },
      ];

      const result = calculatePortfolioPerformance(
        'user-1',
        150.0,
        snapshots,
        mockNow,
      );

      // 24h window has data
      const window24h = result.windows.find((w) => w.window === '24h');
      expect(window24h?.hasData).toBe(true);

      // 7d and 30d windows don't have data
      const window7d = result.windows.find((w) => w.window === '7d');
      expect(window7d?.hasData).toBe(false);
      expect(window7d?.absolutePnl).toBeNull();
      expect(window7d?.percentageChange).toBeNull();

      const window30d = result.windows.find((w) => w.window === '30d');
      expect(window30d?.hasData).toBe(false);
    });

    it('should handle empty snapshots array', () => {
      const result = calculatePortfolioPerformance(
        'user-1',
        150.0,
        [],
        mockNow,
      );

      expect(result.windows).toHaveLength(3);
      result.windows.forEach((window) => {
        expect(window.hasData).toBe(false);
        expect(window.absolutePnl).toBeNull();
        expect(window.percentageChange).toBeNull();
      });
    });

    it('should use current date as default when not provided', () => {
      const snapshots: SnapshotData[] = [];
      const beforeTest = new Date();

      const result = calculatePortfolioPerformance('user-1', 150.0, snapshots);

      const afterTest = new Date();
      expect(result.calculatedAt.getTime()).toBeGreaterThanOrEqual(
        beforeTest.getTime(),
      );
      expect(result.calculatedAt.getTime()).toBeLessThanOrEqual(
        afterTest.getTime(),
      );
    });

    it('should include current value in all windows even without historical data', () => {
      const result = calculatePortfolioPerformance(
        'user-1',
        150.0,
        [],
        mockNow,
      );

      result.windows.forEach((window) => {
        expect(window.currentValueUsd).toBe(150.0);
      });
    });
  });

  describe('PERFORMANCE_WINDOWS', () => {
    it('should have correct window configurations', () => {
      expect(PERFORMANCE_WINDOWS).toHaveLength(3);

      const window24h = PERFORMANCE_WINDOWS.find((w) => w.window === '24h');
      expect(window24h?.hours).toBe(24);

      const window7d = PERFORMANCE_WINDOWS.find((w) => w.window === '7d');
      expect(window7d?.hours).toBe(24 * 7);

      const window30d = PERFORMANCE_WINDOWS.find((w) => w.window === '30d');
      expect(window30d?.hours).toBe(24 * 30);
    });
  });
});
