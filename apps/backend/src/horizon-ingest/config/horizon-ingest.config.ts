import { registerAs } from '@nestjs/config';
import { config } from '../../lib/config';

export interface HorizonIngestConfig {
  /** Horizon base URL (reuses the global Stellar config). */
  horizonUrl: string;
  /** Stellar account IDs to watch, parsed from HORIZON_INGEST_ACCOUNTS CSV. */
  accounts: string[];
  /** Number of operations to fetch per Horizon page (1–200). */
  pageSize: number;
  /** Milliseconds to wait between consecutive Horizon page requests. */
  rateLimitDelayMs: number;
}

export default registerAs('horizonIngest', (): HorizonIngestConfig => {
  const raw = process.env.HORIZON_INGEST_ACCOUNTS ?? '';
  const accounts = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const pageSize = Math.min(
    Math.max(
      parseInt(process.env.HORIZON_INGEST_PAGE_SIZE ?? '200', 10) || 200,
      1,
    ),
    200,
  );

  const rateLimitDelayMs = Math.max(
    parseInt(process.env.HORIZON_INGEST_RATE_LIMIT_DELAY_MS ?? '200', 10) ||
      200,
    0,
  );

  return {
    horizonUrl: config.stellar.horizonUrl,
    accounts,
    pageSize,
    rateLimitDelayMs,
  };
});
