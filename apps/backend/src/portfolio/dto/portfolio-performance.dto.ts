export class TimeWindowPerformanceDto {
  /**
   * The time window identifier (24h, 7d, 30d)
   */
  window: '24h' | '7d' | '30d';

  /**
   * Whether data is available for this time window
   */
  hasData: boolean;

  /**
   * Absolute profit/loss in USD
   */
  absolutePnl: number | null;

  /**
   * Percentage change from baseline
   */
  percentageChange: number | null;

  /**
   * Current portfolio value in USD
   */
  currentValueUsd: number;

  /**
   * Baseline portfolio value in USD (value at start of window)
   */
  baselineValueUsd: number | null;

  /**
   * Date of the baseline snapshot
   */
  baselineDate: Date | null;
}

export class PortfolioPerformanceResponseDto {
  /**
   * User ID
   */
  userId: string;

  /**
   * Current total portfolio value in USD
   */
  currentValueUsd: number;

  /**
   * Timestamp when performance was calculated
   */
  calculatedAt: Date;

  /**
   * Performance metrics for each time window
   */
  windows: TimeWindowPerformanceDto[];
}
