import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ReconciliationService } from './reconciliation.service';
import { JobLockService } from '../scheduler/job-lock.service';
import { JobHistoryService } from '../scheduler/job-history.service';

const JOB_NAME = 'reconciliation';

@Injectable()
export class ReconciliationScheduler {
  private readonly logger = new Logger(ReconciliationScheduler.name);

  constructor(
    private readonly reconciliationService: ReconciliationService,
    private readonly jobLock: JobLockService,
    private readonly jobHistory: JobHistoryService,
  ) {}

  /** Run reconciliation every 6 hours */
  @Cron('0 */6 * * *')
  async handleScheduledReconciliation(): Promise<void> {
    this.logger.log('Scheduled reconciliation triggered');

    const acquired = await this.jobLock.tryAcquire(JOB_NAME);
    if (!acquired) {
      await this.jobHistory.markSkipped(JOB_NAME);
      return;
    }

    const run = await this.jobHistory.start(JOB_NAME);
    try {
      const job = await this.reconciliationService.runReconciliation('scheduled');
      await this.jobHistory.complete(run, {
        reconciliationJobId: job.id,
        driftsDetected: job.driftsDetected,
        driftsRepaired: job.driftsRepaired,
        usersProcessed: job.usersProcessed,
      });
      this.logger.log(
        `Scheduled reconciliation complete — jobId=${job.id} drifts=${job.driftsDetected} repaired=${job.driftsRepaired}`,
      );
    } catch (err) {
      await this.jobHistory.fail(run, err);
      this.logger.error(
        `Scheduled reconciliation failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      await this.jobLock.release(JOB_NAME);
    }
  }
}
