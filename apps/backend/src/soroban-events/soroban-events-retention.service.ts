import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { JobLockService } from '../scheduler/job-lock.service';
import { JobHistoryService } from '../scheduler/job-history.service';

const JOB_NAME = 'soroban-events-retention';

/**
 * Default number of days to keep events in the hot (partitioned) table.
 * Events older than this are moved to soroban_events_archive each night.
 */
const DEFAULT_HOT_WINDOW_DAYS = 90;

/**
 * Maximum rows to move in a single retention run to limit lock contention.
 * The job will run again the next night if more rows need to be archived.
 */
const MAX_ROWS_PER_RUN = 50_000;

/**
 * SorobanEventsRetentionService
 *
 * Nightly job (02:00 UTC) that:
 *   1. Moves rows from soroban_events (hot, partitioned) that are older than
 *      SOROBAN_HOT_WINDOW_DAYS (default 90) to soroban_events_archive.
 *   2. Uses a single atomic INSERT … SELECT + DELETE transaction so no row is
 *      ever lost or duplicated, even if the process is interrupted mid-run.
 *   3. Respects the MAX_ROWS_PER_RUN limit so the job never locks the table
 *      for an unbounded amount of time.
 *   4. Uses JobLockService (pg_advisory_lock) so only one instance runs in a
 *      multi-replica deployment.
 *
 * The hot window is configurable via the SOROBAN_HOT_WINDOW_DAYS environment
 * variable.  Setting it to 0 disables archival (no rows will be moved).
 *
 * Replay and backfill are unaffected: the indexer upserts directly into
 * soroban_events (the partitioned hot table) and the soroban_events_all VIEW
 * lets any cross-boundary query transparently scan both tables.
 */
@Injectable()
export class SorobanEventsRetentionService {
  private readonly logger = new Logger(SorobanEventsRetentionService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly jobLock: JobLockService,
    private readonly jobHistory: JobHistoryService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Manual trigger — useful in tests or for operator-initiated archival.
   * Returns the number of rows moved.
   */
  async runRetention(): Promise<{ archived: number }> {
    const result = await this.jobLock.withLock(JOB_NAME, () => this.archive());
    // withLock returns null when the advisory lock is held by another instance
    return result ?? { archived: 0 };
  }

  /**
   * Scheduled trigger — runs every night at 02:00 UTC.
   */
  @Cron('0 2 * * *', { name: JOB_NAME, timeZone: 'UTC' })
  async runScheduled(): Promise<void> {
    await this.jobLock.withLock(JOB_NAME, () => this.archive());
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async archive(): Promise<{ archived: number }> {
    const hotWindowDays = this.configService.get<number>(
      'SOROBAN_HOT_WINDOW_DAYS',
      DEFAULT_HOT_WINDOW_DAYS,
    );

    if (hotWindowDays <= 0) {
      this.logger.log(
        'SOROBAN_HOT_WINDOW_DAYS=0 — archival disabled, skipping',
      );
      return { archived: 0 };
    }

    const run = await this.jobHistory.start(JOB_NAME, 'scheduled');

    try {
      const cutoff = new Date(
        Date.now() - hotWindowDays * 24 * 60 * 60 * 1000,
      );

      this.logger.log(
        `Archiving events older than ${cutoff.toISOString()} ` +
          `(hot_window_days=${hotWindowDays})`,
      );

      const archived = await this.moveToArchive(cutoff);

      await this.jobHistory.complete(run, {
        archived,
        cutoff: cutoff.toISOString(),
        hotWindowDays,
      });

      this.logger.log(`Retention complete — archived ${archived} rows`);
      return { archived };
    } catch (err) {
      await this.jobHistory.fail(run, err);
      this.logger.error('Retention job failed', err);
      return { archived: 0 };
    }
  }

  /**
   * Move at most MAX_ROWS_PER_RUN rows older than `cutoff` from
   * soroban_events to soroban_events_archive inside a single transaction.
   *
   * Uses a CTE to atomically select, insert, and delete in one round-trip:
   *
   *   WITH candidates AS (
   *     SELECT * FROM soroban_events
   *     WHERE created_at < $cutoff
   *     ORDER BY created_at
   *     LIMIT $limit
   *     FOR UPDATE SKIP LOCKED
   *   ),
   *   moved AS (
   *     INSERT INTO soroban_events_archive
   *     SELECT * FROM candidates
   *     ON CONFLICT (tx_hash, event_index, created_at) DO NOTHING
   *     RETURNING id
   *   )
   *   DELETE FROM soroban_events
   *   WHERE (id, created_at) IN (
   *     SELECT c.id, c.created_at FROM candidates c
   *     JOIN moved m ON m.id = c.id
   *   )
   *
   * The SKIP LOCKED clause means this query is safe to run in a hot replica
   * scenario — rows locked by concurrent writers are simply skipped and will
   * be picked up on the next nightly run.
   */
  private async moveToArchive(cutoff: Date): Promise<number> {
    const result = await this.dataSource.query<Array<{ count: string }>>(
      `
      WITH candidates AS (
        SELECT *
        FROM   soroban_events
        WHERE  created_at < $1
        ORDER  BY created_at
        LIMIT  $2
        FOR UPDATE SKIP LOCKED
      ),
      moved AS (
        INSERT INTO soroban_events_archive
        SELECT * FROM candidates
        ON CONFLICT (tx_hash, event_index, created_at) DO NOTHING
        RETURNING id
      ),
      deleted AS (
        DELETE FROM soroban_events
        WHERE (id, created_at) IN (
          SELECT c.id, c.created_at
          FROM   candidates c
          JOIN   moved      m ON m.id = c.id
        )
        RETURNING id
      )
      SELECT count(*)::text AS count FROM deleted
      `,
      [cutoff, MAX_ROWS_PER_RUN],
    );

    return parseInt(result[0]?.count ?? '0', 10);
  }
}
