import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class StellarSyncService {
  private readonly logger = new Logger(StellarSyncService.name);

  constructor(@InjectQueue('stellar-sync') private syncQueue: Queue) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleCron() {
    this.logger.debug('Triggering sync-ledgers job with cron');
    await this.syncQueue.add(
      'sync-ledgers',
      { limit: 50 },
      { attempts: 3, backoff: { type: 'exponential', delay: 1000 } },
    );
  }
}
