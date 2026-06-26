import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StellarSyncCheckpoint } from './entities/checkpoint.entity';
import { StellarProcessedEvent } from './entities/processed-event.entity';
import { Horizon } from '@stellar/stellar-sdk';
import stellarConfig from '../stellar/config/stellar.config';
import type { StellarConfig } from '../stellar/config/stellar.config';

export interface SyncLedgerPayload {
  limit?: number;
  cursor?: string;
}

@Processor('stellar-sync', {
  concurrency: 1, // Ensure sequential processing for cursor-based ingestion
})
@Injectable()
export class StellarSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(StellarSyncProcessor.name);
  private readonly server: Horizon.Server;

  constructor(
    @InjectRepository(StellarSyncCheckpoint)
    private readonly checkpointRepo: Repository<StellarSyncCheckpoint>,
    @InjectRepository(StellarProcessedEvent)
    private readonly processedEventRepo: Repository<StellarProcessedEvent>,
    @Inject(stellarConfig.KEY)
    private readonly config: StellarConfig,
  ) {
    super();
    this.server = new Horizon.Server(this.config.horizonUrl);
  }

  async process(
    job: Job<SyncLedgerPayload, unknown, string>,
  ): Promise<unknown> {
    this.logger.debug(`Processing job ${String(job.id)} of type ${job.name}`);
    switch (job.name) {
      case 'sync-ledgers':
        return this.syncLedgers(job);
      default:
        this.logger.warn(`Unknown job name: ${job.name}`);
        throw new Error(`Unknown job name: ${job.name}`);
    }
  }

  private async syncLedgers(
    job: Job<SyncLedgerPayload, unknown, string>,
  ): Promise<unknown> {
    const limit = job.data?.limit ?? 20;

    // Get cursor from DB if not provided in payload
    let cursor: string | undefined = job.data?.cursor;

    const checkpoint = await this.checkpointRepo.findOne({
      where: { type: 'ledger' },
    });
    if (!cursor) {
      cursor = checkpoint?.cursor || 'now'; // 'now' fetches the latest if no history
    }

    try {
      this.logger.log(`Fetching ledgers from cursor: ${cursor}`);
      const ledgers = await this.server
        .ledgers()
        .cursor(cursor)
        .limit(limit)
        .order('asc')
        .call();

      let processedCount = 0;
      let lastCursor = cursor;

      for (const ledger of ledgers.records) {
        // Idempotency check using sequence number
        const eventId = `ledger-${String(ledger.sequence)}`;
        const exists = await this.processedEventRepo.findOne({
          where: { eventId },
        });

        if (!exists) {
          // In a real application, you would also process transactions/effects here.
          // For now we just mark the ledger as processed.
          await this.processedEventRepo.save({ eventId });
          processedCount++;
        }
        lastCursor = ledger.paging_token;
      }

      // Update checkpoint transactionally with the new cursor based on last processed ledger
      if (ledgers.records.length > 0) {
        if (checkpoint) {
          checkpoint.cursor = lastCursor;
          await this.checkpointRepo.save(checkpoint);
        } else {
          await this.checkpointRepo.save({
            type: 'ledger',
            cursor: lastCursor,
          });
        }
      }

      this.logger.log(
        `Processed ${processedCount} ledgers, new cursor: ${lastCursor}`,
      );

      return {
        processedCount,
        nextCursor: lastCursor,
        totalFetched: ledgers.records.length,
      };
    } catch (error) {
      this.logger.error(
        `Error syncing ledgers: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error; // Will trigger BullMQ retry logic
    }
  }
}
