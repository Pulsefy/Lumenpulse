import {
  TimeWindowPerformanceDto,
  PortfolioPerformanceResponseDto,
} from '../dto/portfolio-performance.dto';

// Interface for snapshot data used in calculations
export interface SnapshotData {
  id: string;
  userId: string;
  createdAt: Date;
  assetBalances: {
    assetCode: string;
    assetIssuer: string | null;
    amount: string;
    valueUsd: number;
  }[];
  totalValueUsd: string;
}

export interface PerformanceWindowConfig {
  window: '24h' | '7d' | '30d';
  hours: number;
}

export const PERFORMANCE_WINDOWS: PerformanceWindowConfig[] = [
  { window: '24h', hours: 24 },
  { window: '7d', hours: 24 * 7 },
  { window: '30d', hours: 24 * 30 },
];

/**
 * Calculate the target date for a given time window
 * @param now - Current date
 * @param hours - Number of hours to look back
 * @returns Target baseline date
 */
export function calculateBaselineDate(now: Date, hours: number): Date {
  const baselineDate = new Date(now);
  baselineDate.setHours(baselineDate.getHours() - hours);
  return baselineDate;
}

/**
 * Find the closest snapshot to a target date
 * @param snapshots - Array of portfolio snapshots
 * @param targetDate - Target date to find closest snapshot to
 * @returns Closest snapshot or null if none found
 */
export function findClosestSnapshot(
  snapshots: SnapshotData[],
  targetDate: Date,
): SnapshotData | null {
  if (snapshots.length === 0) {
    return null;
  }

  // Sort snapshots by createdAt ascending
  const sortedSnapshots = [...snapshots].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );

  // Find the snapshot closest to the target date
  let closestSnapshot: SnapshotData | null = null;
  let minDiff = Infinity;

  for (const snapshot of sortedSnapshots) {
    const diff = Math.abs(snapshot.createdAt.getTime() - targetDate.getTime());
    // Only consider snapshots that are at or before the target date
    if (snapshot.createdAt <= targetDate && diff < minDiff) {
      minDiff = diff;
      closestSnapshot = snapshot;
    }
  }

  return closestSnapshot;
}

/**
 * Calculate performance metrics for a single time window
 * @param currentValue - Current portfolio value
 * @param baselineSnapshot - Baseline snapshot for comparison
 * @param windowConfig - Time window configuration
 * @returns Performance metrics for the time window
 */
export function calculateWindowPerformance(
  currentValue: number,
  baselineSnapshot: SnapshotData | null,
  windowConfig: PerformanceWindowConfig,
): TimeWindowPerformanceDto {
  if (!baselineSnapshot) {
    return {
      window: windowConfig.window,
      hasData: false,
      absolutePnl: null,
      percentageChange: null,
      currentValueUsd: currentValue,
      baselineValueUsd: null,
      baselineDate: null,
    };
  }

  const baselineValue = parseFloat(baselineSnapshot.totalValueUsd);
  const absolutePnl = currentValue - baselineValue;
  const percentageChange =
    baselineValue !== 0 ? (absolutePnl / baselineValue) * 100 : 0;

  return {
    window: windowConfig.window,
    hasData: true,
    absolutePnl: parseFloat(absolutePnl.toFixed(2)),
    percentageChange: parseFloat(percentageChange.toFixed(4)),
    currentValueUsd: currentValue,
    baselineValueUsd: baselineValue,
    baselineDate: baselineSnapshot.createdAt,
  };
}

/**
 * Calculate portfolio performance across all time windows
 * Pure function - all dependencies are passed as parameters
 * @param userId - User ID
 * @param currentValueUsd - Current portfolio value
 * @param snapshots - Historical portfolio snapshots
 * @param now - Current timestamp
 * @returns Complete portfolio performance response
 */
export function calculatePortfolioPerformance(
  userId: string,
  currentValueUsd: number,
  snapshots: SnapshotData[],
  now: Date = new Date(),
): PortfolioPerformanceResponseDto {
  const windows: TimeWindowPerformanceDto[] = PERFORMANCE_WINDOWS.map(
    (config) => {
      const baselineDate = calculateBaselineDate(now, config.hours);
      const baselineSnapshot = findClosestSnapshot(snapshots, baselineDate);
      return calculateWindowPerformance(
        currentValueUsd,
        baselineSnapshot,
        config,
      );
    },
  );

  return {
    userId,
    currentValueUsd,
    calculatedAt: now,
    windows,
  };
}
