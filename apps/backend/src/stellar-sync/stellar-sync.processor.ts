import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { CorrelationService } from '../common/correlation/correlation.service';

@Processor('stellar-sync')
export class StellarSyncProcessor {
  private readonly logger = new Logger(StellarSyncProcessor.name);

  constructor(private readonly correlationService: CorrelationService) {}

  @Process('sync-transactions')
  async handleSyncTransactions(job: Job<any>) {
    const correlationId = job.data.correlationId || randomUUID();

    return this.correlationService.runWithId(correlationId, async () => {
      this.logger.log(`Starting transaction sync for account ${job.data.accountId}`);

      try {
        // Implementation of sync logic
        // ...
        this.logger.log(`Sync completed for account ${job.data.accountId}`);
      } catch (error) {
        this.logger.error(`Sync failed for account ${job.data.accountId}: ${error.message}`);
        throw error;
      }
    });
  }
}
