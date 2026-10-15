import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { SorobanEvent } from './entities/soroban-event.entity';
import { SorobanEventArchive } from './entities/soroban-event-archive.entity';
import { JobLockService } from '../scheduler/job-lock.service';
import { JobHistoryService } from '../scheduler/job-history.service';

const JOB_NAME = 'soroban-event-archival';

/** Max rows to move per archival run to keep the transaction short */
const BATCH_SIZE = 5_000;

export interface ArchivalStats {
  archived: number;
  durationMs: number;
  cutoff: Date;
}

interface TableSizeRow {
  table_name: string;
  total_size: string;
}

interface IndexSizeRow {
  index_name: string;
  index_size: string;
}

interface LedgerRangeRow {
  min_ledger: string | null;
  max_ledger: string | null;
}

/**
 * SorobanEventArchiveService
 * --------------------------
 * Responsible for two concerns:
 *
 * 1. **Archival cron** — runs nightly and moves events older than the hot
 *    window (default: 90 days, env: SOROBAN_HOT_WINDOW_DAYS) from
 *    soroban_events into soroban_events_archive in batches.  Before each
 *    archival run it ensures the next quarterly partition exists so inserts
 *    never fall through to the catch-all partition.
 *
 * 2. **Cross-partition query helpers** — methods that transparently query
 *    both the hot partitioned table and the cold archive so callers do not
 *    need to know where the data lives.
 */
@Injectable()
export class SorobanEventArchiveService {
  private readonly logger = new Logger(SorobanEventArchiveService.name);

  /** Hot-window threshold in days; tunable via env */
  private get hotWindowDays(): number {
    return this.configService.get<number>('SOROBAN_HOT_WINDOW_DAYS', 90);
  }

  constructor(
    @InjectRepository(SorobanEvent)
    private readonly eventRepo: Repository<SorobanEvent>,

    @InjectRepository(SorobanEventArchive)
    private readonly archiveRepo: Repository<SorobanEventArchive>,

    private readonly configService: ConfigService,
    private readonly jobLock: JobLockService,
    private readonly jobHistory: JobHistoryService,
    private readonly dataSource: DataSource,
  ) {}

  // ---------------------------------------------------------------------------
  // Archival cron — runs once daily at 02:00 UTC
  // ---------------------------------------------------------------------------

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async runArchivalCron(): Promise<void> {
    await this.jobLock.withLock(JOB_NAME, () => this.archiveOldEvents());
  }

  /**
   * Manually trigger archival. Useful for backfilling or testing.
   * Returns stats about what was archived.
   */
  async archiveOldEvents(): Promise<ArchivalStats> {
    const start = Date.now();
    const cutoff = this.hotWindowCutoff();

    const run = await this.jobHistory.start(JOB_NAME, 'scheduled');
    let totalArchived = 0;

    try {
      // Ensure next quarter's partition is pre-created so new inserts
      // always land in a named partition rather than the default catch-all.
      await this.ensureNextQuarterPartition();

      // Archive in batches to limit transaction duration and lock contention
      let batch: number;
      do {
        batch = await this.archiveBatch(cutoff);
        totalArchived += batch;
        this.logger.debug(`Archived batch of ${batch} events`);
      } while (batch === BATCH_SIZE);

      const durationMs = Date.now() - start;
      await this.jobHistory.complete(run, {
        archived: totalArchived,
        durationMs,
        cutoff: cutoff.toISOString(),
      });

      this.logger.log(
        `Archival complete: ${totalArchived} events moved in ${durationMs}ms (cutoff=${cutoff.toISOString()})`,
      );

      return { archived: totalArchived, durationMs, cutoff };
    } catch (err) {
      await this.jobHistory.fail(run, err);
      this.logger.error('Soroban event archival failed', err);
      return {
        archived: totalArchived,
        durationMs: Date.now() - start,
        cutoff,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Cross-partition query helpers
  // ---------------------------------------------------------------------------

  /**
   * Query events by ledger range, looking in hot partitions first, then
   * falling back to the archive if the range predates the hot window.
   *
   * PostgreSQL's partition pruning already makes hot-table queries efficient
   * when they include created_at filters, but ledger_sequence is the
   * natural query key for replay/backfill so we support both.
   */
  async findByLedgerRange(
    fromLedger: number,
    toLedger: number,
  ): Promise<Array<SorobanEvent | SorobanEventArchive>> {
    const hotResults = await this.eventRepo
      .createQueryBuilder('e')
      .where('e.ledger_sequence >= :from', { from: fromLedger })
      .andWhere('e.ledger_sequence <= :to', { to: toLedger })
      .orderBy('e.ledger_sequence', 'ASC')
      .addOrderBy('e.event_index', 'ASC')
      .getMany();

    const archiveResults = await this.archiveRepo
      .createQueryBuilder('a')
      .where('a.ledger_sequence >= :from', { from: fromLedger })
      .andWhere('a.ledger_sequence <= :to', { to: toLedger })
      .orderBy('a.ledger_sequence', 'ASC')
      .addOrderBy('a.event_index', 'ASC')
      .getMany();

    // Merge and de-duplicate by (txHash, eventIndex), preferring hot rows
    const seen = new Set<string>();
    const merged: Array<SorobanEvent | SorobanEventArchive> = [];

    for (const row of [...hotResults, ...archiveResults]) {
      const key = `${row.txHash}:${row.eventIndex}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(row);
      }
    }

    return merged.sort((a, b) => {
      const ledgerDiff = (a.ledgerSequence ?? 0) - (b.ledgerSequence ?? 0);
      return ledgerDiff !== 0 ? ledgerDiff : a.eventIndex - b.eventIndex;
    });
  }

  /**
   * Return the total event count across both hot and archive tables.
   * Useful for health checks and reporting.
   */
  async totalEventCount(): Promise<{
    hot: number;
    archive: number;
    total: number;
  }> {
    const [hot, archive] = await Promise.all([
      this.eventRepo.count(),
      this.archiveRepo.count(),
    ]);
    return { hot, archive, total: hot + archive };
  }

  /**
   * Return the oldest and newest ledger sequences across hot + archive.
   */
  async ledgerSequenceRange(): Promise<{
    minLedger: number | null;
    maxLedger: number | null;
  }> {
    const [hotRange, archiveRange] = await Promise.all([
      this.dataSource.query<LedgerRangeRow[]>(`
        SELECT MIN(ledger_sequence) AS min_ledger, MAX(ledger_sequence) AS max_ledger
        FROM soroban_events
        WHERE ledger_sequence IS NOT NULL
      `),
      this.dataSource.query<LedgerRangeRow[]>(`
        SELECT MIN(ledger_sequence) AS min_ledger, MAX(ledger_sequence) AS max_ledger
        FROM soroban_events_archive
        WHERE ledger_sequence IS NOT NULL
      `),
    ]);

    const allMins = [hotRange[0]?.min_ledger, archiveRange[0]?.min_ledger]
      .filter((v): v is string => v != null)
      .map(Number);
    const allMaxes = [hotRange[0]?.max_ledger, archiveRange[0]?.max_ledger]
      .filter((v): v is string => v != null)
      .map(Number);

    return {
      minLedger: allMins.length > 0 ? Math.min(...allMins) : null,
      maxLedger: allMaxes.length > 0 ? Math.max(...allMaxes) : null,
    };
  }

  /**
   * Return per-table size info. Used by the benchmark and health endpoints.
   */
  async tableSizes(): Promise<Record<string, string>> {
    const rows = await this.dataSource.query<TableSizeRow[]>(`
      SELECT
        relname AS table_name,
        pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'p')
        AND relname LIKE 'soroban_events%'
      ORDER BY pg_total_relation_size(c.oid) DESC
    `);
    return Object.fromEntries(rows.map((r) => [r.table_name, r.total_size]));
  }

  /**
   * Return per-index size info. Used by the benchmark.
   */
  async indexSizes(): Promise<Record<string, string>> {
    const rows = await this.dataSource.query<IndexSizeRow[]>(`
      SELECT
        indexrelid::regclass::text AS index_name,
        pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
      FROM pg_stat_user_indexes
      WHERE relname LIKE 'soroban_events%'
      ORDER BY pg_relation_size(indexrelid) DESC
    `);
    return Object.fromEntries(rows.map((r) => [r.index_name, r.index_size]));
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Archive a single batch of up to BATCH_SIZE rows older than cutoff.
   * Uses a CTE-based DELETE … RETURNING pattern to atomically move rows
   * from the hot table to the archive without a window where they exist
   * in neither.
   *
   * Returns the number of rows archived.
   */
  private async archiveBatch(cutoff: Date): Promise<number> {
    const result = await this.dataSource.query<Array<Record<string, unknown>>>(
      `
      WITH to_archive AS (
        DELETE FROM soroban_events
        WHERE id IN (
          SELECT id FROM soroban_events
          WHERE created_at < $1
          ORDER BY created_at ASC
          LIMIT $2
          FOR UPDATE SKIP LOCKED
        )
        RETURNING
          id, tx_hash, event_index, contract_id, event_type, canonical_type,
          category, raw_payload, ledger_sequence, status, error_message,
          created_at, processed_at
      )
      INSERT INTO soroban_events_archive (
        id, tx_hash, event_index, contract_id, event_type, canonical_type,
        category, raw_payload, ledger_sequence, status, error_message,
        created_at, processed_at, archived_at
      )
      SELECT
        id, tx_hash, event_index, contract_id, event_type, canonical_type,
        category, raw_payload, ledger_sequence, status, error_message,
        created_at, processed_at, NOW()
      FROM to_archive
      ON CONFLICT (tx_hash, event_index) DO NOTHING
      RETURNING 1
      `,
      [cutoff, BATCH_SIZE],
    );

    return result.length;
  }

  /**
   * Call the soroban_events_ensure_partition() PL/pgSQL helper for the
   * current date + 1 quarter so writes never land in the default partition.
   */
  private async ensureNextQuarterPartition(): Promise<void> {
    const nextQuarter = new Date();
    nextQuarter.setMonth(nextQuarter.getMonth() + 3);
    await this.dataSource.query(
      `SELECT soroban_events_ensure_partition($1::TIMESTAMPTZ)`,
      [nextQuarter.toISOString()],
    );
  }

  private hotWindowCutoff(): Date {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - this.hotWindowDays);
    return cutoff;
  }
}
