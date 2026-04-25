import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ReconciliationService } from './reconciliation.service';

@Injectable()
export class ReconciliationScheduler {
  private readonly logger = new Logger(ReconciliationScheduler.name);

  constructor(private readonly reconciliationService: ReconciliationService) {}

  /** Run reconciliation every 6 hours */
  @Cron('0 */6 * * *')
  async handleScheduledReconciliation(): Promise<void> {
    this.logger.log('Scheduled reconciliation triggered');
    try {
      const job =
        await this.reconciliationService.runReconciliation('scheduled');
      this.logger.log(
        `Scheduled reconciliation complete — jobId=${job.id} drifts=${job.driftsDetected} repaired=${job.driftsRepaired}`,
      );
    } catch (err) {
      this.logger.error(
        `Scheduled reconciliation failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
