/**
 * Raw row returned by the aggregation SQL query.
 * TypeORM returns numeric columns as strings from pg driver — we cast in the
 * service layer so the type here reflects what actually arrives at runtime.
 */
export interface AssetAggregationRow {
  asset_symbol: string | null;
  avg_sentiment: string;
  min_sentiment: string | null;
  max_sentiment: string | null;
  signal_count: string;
  total_volume: string | null;
  volume_weighted_sentiment: string | null;
}

/** Parsed, type-safe version used by SnapshotGenerator internally. */
export interface AssetAggregation {
  assetSymbol: string | null;
  avgSentiment: number;
  minSentiment: number | null;
  maxSentiment: number | null;
  signalCount: number;
  totalVolume: number | null;
  volumeWeightedSentiment: number | null;
}

/** Summary returned to callers after a generation run. */
export interface SnapshotRunResult {
  date: Date;
  assetRowsWritten: number;
  globalRowWritten: boolean;
  durationMs: number;
}
