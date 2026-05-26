import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository, FindOptionsWhere, LessThan } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { ConfigType } from '@nestjs/config';

import { AccountOperation } from './entities/account-operation.entity';
import { HorizonIngestCheckpoint } from './entities/horizon-ingest-checkpoint.entity';
import { OperationQueryDto } from './dto/operation-query.dto';
import horizonIngestConfig from './config/horizon-ingest.config';
import type { IngestAccountPayload } from './horizon-ingest.processor';

/** BullMQ job options shared by all ingest jobs. */
const JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 2_000 },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 50 },
};

@Injectable()
export class HorizonIngestService {
  private readonly logger = new Logger(HorizonIngestService.name);

  constructor(
    @InjectQueue('horizon-ingest')
    private readonly ingestQueue: Queue,
    @InjectRepository(AccountOperation)
    private readonly operationRepo: Repository<AccountOperation>,
    @InjectRepository(HorizonIngestCheckpoint)
    private readonly checkpointRepo: Repository<HorizonIngestCheckpoint>,
    @Inject(horizonIngestConfig.KEY)
    private readonly cfg: ConfigType<typeof horizonIngestConfig>,
  ) {}

  // ─── Scheduled incremental sync ─────────────────────────────────────────

  /**
   * Every minute, enqueue an incremental ingest job for every watched account.
   * The processor resumes from the stored checkpoint cursor so only new
   * operations are fetched.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async scheduleIncrementalSync(): Promise<void> {
    if (this.cfg.accounts.length === 0) {
      this.logger.debug(
        'No accounts configured for Horizon ingestion (HORIZON_INGEST_ACCOUNTS is empty).',
      );
      return;
    }

    this.logger.debug(
      `Scheduling incremental ingest for ${this.cfg.accounts.length} account(s).`,
    );

    for (const accountId of this.cfg.accounts) {
      await this.enqueueIngest(accountId, false);
    }
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Trigger a full backfill for a specific account.
   * Ignores the stored checkpoint and starts from paging_token '0'.
   */
  async triggerBackfill(accountId: string): Promise<{ jobId: string }> {
    this.logger.log(`Triggering backfill for account ${accountId}`);
    const job = await this.enqueueIngest(accountId, true);
    return { jobId: job.id ?? 'unknown' };
  }

  /**
   * Query persisted operations for a given account with optional pagination
   * and type filtering. Suitable for dashboard and activity-feed endpoints.
   */
  async getOperations(
    accountId: string,
    query: OperationQueryDto,
  ): Promise<{ data: AccountOperation[]; nextCursor: string | null }> {
    const limit = query.limit ?? 20;

    const where: FindOptionsWhere<AccountOperation> = { accountId };

    if (query.type) {
      where.type = query.type;
    }

    // Cursor-based pagination: operationId is a numeric string from Horizon,
    // so we can use LessThan for "older than cursor" semantics when paging back.
    if (query.cursor) {
      where.operationId = LessThan(query.cursor);
    }

    const data = await this.operationRepo.find({
      where,
      order: { createdAt: 'DESC' },
      take: limit,
    });

    const nextCursor =
      data.length === limit ? data[data.length - 1].operationId : null;

    return { data, nextCursor };
  }

  /**
   * Returns the current checkpoint (last ingested cursor) for an account.
   */
  async getCheckpoint(
    accountId: string,
  ): Promise<HorizonIngestCheckpoint | null> {
    return this.checkpointRepo.findOne({ where: { accountId } });
  }

  // ─── Internal helpers ────────────────────────────────────────────────────

  private async enqueueIngest(accountId: string, backfill: boolean) {
    const payload: IngestAccountPayload = { accountId, backfill };
    const jobId = `ingest-${accountId}-${backfill ? 'backfill' : 'incremental'}`;

    return this.ingestQueue.add('ingest-account', payload, {
      ...JOB_OPTIONS,
      // Use a deterministic jobId so duplicate cron ticks don't stack up
      // while a previous job for the same account is still running.
      jobId: backfill ? undefined : jobId,
      // Backfill jobs should not be deduplicated — allow multiple explicit
      // backfills to queue independently.
    });
  }
}
