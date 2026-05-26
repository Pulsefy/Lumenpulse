/**
 * Raw row returned by the testnet aggregation query.
 * TypeORM returns bigint columns as strings from the pg driver.
 */
export interface ContributorAggregationRow {
  contributor_address: string;
  github_handle: string | null;
  reputation_score: string;
  registered_timestamp: string | null;
}

/** Parsed, type-safe version used internally by the generator. */
export interface ContributorAggregation {
  contributorAddress: string;
  githubHandle: string | null;
  reputationScore: number;
  registeredTimestamp: number | null;
}

/** Query params for the leaderboard endpoint. */
export interface LeaderboardQuery {
  /** Number of top contributors to return (default 10, max 100). */
  limit?: number;
  /** UTC date string YYYY-MM-DD; defaults to the most recent snapshot date. */
  date?: string;
}

/** Single entry in the leaderboard response. */
export interface LeaderboardEntry {
  rank: number;
  contributorAddress: string;
  githubHandle: string | null;
  reputationScore: number;
  snapshotDate: string;
}

/** Summary returned to callers after a generation run. */
export interface ContributorSnapshotRunResult {
  date: Date;
  rowsWritten: number;
  durationMs: number;
}
