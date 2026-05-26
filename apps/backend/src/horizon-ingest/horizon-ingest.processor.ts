import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bullmq';
import { Horizon } from '@stellar/stellar-sdk';
import type { ConfigType } from '@nestjs/config';

import { AccountOperation } from './entities/account-operation.entity';
import { HorizonIngestCheckpoint } from './entities/horizon-ingest-checkpoint.entity';
import horizonIngestConfig from './config/horizon-ingest.config';

export interface IngestAccountPayload {
  /** Stellar account public key to ingest operations for. */
  accountId: string;
  /**
   * When true, ignore the stored checkpoint and start from the very beginning
   * (paging_token '0'). Used for explicit backfill requests.
   */
  backfill?: boolean;
}

/**
 * BullMQ worker that pages through Horizon operations for a single account.
 *
 * Dedup strategy: INSERT … ON CONFLICT (operationId) DO NOTHING via the
 * unique constraint on `horizon_account_operations.operationId`.
 *
 * Rate-limit strategy: configurable inter-page delay
 * (HORIZON_INGEST_RATE_LIMIT_DELAY_MS, default 200 ms) between Horizon calls.
 */
@Processor('horizon-ingest', { concurrency: 1 })
@Injectable()
export class HorizonIngestProcessor extends WorkerHost {
  private readonly logger = new Logger(HorizonIngestProcessor.name);
  private readonly server: Horizon.Server;

  constructor(
    @InjectRepository(AccountOperation)
    private readonly operationRepo: Repository<AccountOperation>,
    @InjectRepository(HorizonIngestCheckpoint)
    private readonly checkpointRepo: Repository<HorizonIngestCheckpoint>,
    @Inject(horizonIngestConfig.KEY)
    private readonly cfg: ConfigType<typeof horizonIngestConfig>,
  ) {
    super();
    this.server = new Horizon.Server(cfg.horizonUrl);
  }

  async process(
    job: Job<IngestAccountPayload, unknown, string>,
  ): Promise<unknown> {
    switch (job.name) {
      case 'ingest-account':
        return this.ingestAccount(job.data);
      default:
        this.logger.warn(`Unknown job name: ${job.name}`);
        throw new Error(`Unknown job name: ${job.name}`);
    }
  }

  // ─── Core ingestion logic ────────────────────────────────────────────────

  private async ingestAccount(payload: IngestAccountPayload): Promise<unknown> {
    const { accountId, backfill = false } = payload;

    // Resolve starting cursor
    let checkpoint = await this.checkpointRepo.findOne({
      where: { accountId },
    });

    const startCursor =
      backfill || !checkpoint ? '0' : checkpoint.cursor;

    this.logger.log(
      `Ingesting operations for ${accountId} from cursor ${startCursor}` +
        (backfill ? ' (backfill)' : ''),
    );

    let cursor = startCursor;
    let totalInserted = 0;
    let totalSkipped = 0;
    let pagesFetched = 0;

    // Page through all available operations in ascending order
    while (true) {
      // Respect Horizon rate limits between pages
      if (pagesFetched > 0) {
        await this.sleep(this.cfg.rateLimitDelayMs);
      }

      let records: Horizon.ServerApi.OperationRecord[];

      try {
        const response = await this.server
          .operations()
          .forAccount(accountId)
          .cursor(cursor)
          .order('asc')
          .limit(this.cfg.pageSize)
          .call();

        records = response.records;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `Horizon fetch failed for ${accountId} at cursor ${cursor}: ${msg}`,
        );
        throw err; // Let BullMQ retry with exponential backoff
      }

      pagesFetched++;

      if (records.length === 0) {
        // No more operations — we're caught up
        break;
      }

      const { inserted, skipped } = await this.persistPage(
        accountId,
        records,
      );

      totalInserted += inserted;
      totalSkipped += skipped;

      // Advance cursor to the last record's paging_token
      const lastRecord = records[records.length - 1];
      cursor = lastRecord.paging_token;

      // Persist checkpoint after every page so a crash mid-run resumes cleanly
      checkpoint = await this.upsertCheckpoint(accountId, cursor, checkpoint);

      this.logger.debug(
        `Page ${pagesFetched}: inserted=${inserted} skipped=${skipped} cursor=${cursor}`,
      );

      // If we got fewer records than the page size we've reached the tip
      if (records.length < this.cfg.pageSize) {
        break;
      }
    }

    this.logger.log(
      `Finished ingesting ${accountId}: pages=${pagesFetched} inserted=${totalInserted} skipped=${totalSkipped} finalCursor=${cursor}`,
    );

    return { accountId, pagesFetched, totalInserted, totalSkipped, cursor };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  /**
   * Bulk-insert a page of operations.
   * Uses INSERT … ON CONFLICT DO NOTHING so duplicate op IDs are silently
   * skipped — this is the primary dedup mechanism.
   */
  private async persistPage(
    accountId: string,
    records: Horizon.ServerApi.OperationRecord[],
  ): Promise<{ inserted: number; skipped: number }> {
    const entities = records.map((record) =>
      this.operationRepo.create({
        operationId: String(record.id),
        accountId,
        type: record.type,
        pagingToken: record.paging_token,
        createdAt: new Date(record.created_at),
        raw: record as unknown as Record<string, unknown>,
      }),
    );

    // TypeORM upsert with conflict on the unique operationId column
    const result = await this.operationRepo
      .createQueryBuilder()
      .insert()
      .into(AccountOperation)
      .values(entities)
      .orIgnore() // ON CONFLICT (operationId) DO NOTHING
      .execute();

    const inserted = result.identifiers.filter((i) => i.id != null).length;
    const skipped = entities.length - inserted;

    return { inserted, skipped };
  }

  private async upsertCheckpoint(
    accountId: string,
    cursor: string,
    existing: HorizonIngestCheckpoint | null,
  ): Promise<HorizonIngestCheckpoint> {
    if (existing) {
      existing.cursor = cursor;
      return this.checkpointRepo.save(existing);
    }

    const created = this.checkpointRepo.create({ accountId, cursor });
    return this.checkpointRepo.save(created);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
