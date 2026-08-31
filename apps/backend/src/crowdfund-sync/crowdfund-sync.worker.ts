import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { CROWDFUND_VAULT_QUEUE } from './crowdfund-sync.module';
import { CrowdfundSyncService } from './crowdfund-sync.service';
import { SyncVaultDto } from './dto/crowdfund-sync.dto';

@Processor(CROWDFUND_VAULT_QUEUE)
@Injectable()
export class CrowdfundSyncWorker extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(CrowdfundSyncWorker.name);

  constructor(private readonly syncService: CrowdfundSyncService) {
    super();
  }

  onModuleInit(): void {
    this.logger.log('Crowdfund sync worker initialized');
  }

  async process(
    job: Job<SyncVaultDto>,
  ): Promise<{ success: boolean; processed: number }> {
    this.logger.log(
      `Processing job ${job.id} for vault ${job.data.vaultAddress}`,
    );

    try {
      const result = await this.syncService.syncVault(job.data);

      if (result.status === 'failed') {
        throw new Error(result.error ?? 'Sync failed');
      }

      return {
        success: true,
        processed: result.eventsProcessed,
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Job ${job.id} failed: ${errorMessage}`);
      throw error;
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<SyncVaultDto>): void {
    this.logger.log(
      `Job ${job.id} completed for vault ${job.data.vaultAddress}`,
    );
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<SyncVaultDto>, error: Error): void {
    this.logger.error(
      `Job ${job.id} failed for vault ${job.data.vaultAddress}: ${error.message}`,
    );
  }

  @OnWorkerEvent('stalled')
  onStalled(jobId: string): void {
    this.logger.warn(`Job ${jobId} stalled`);
  }
}
