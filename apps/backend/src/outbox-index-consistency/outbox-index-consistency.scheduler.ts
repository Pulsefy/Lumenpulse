import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OutboxIndexConsistencyService } from './outbox-index-consistency.service';
import { JobLockService } from '../scheduler/job-lock.service';
import { JobHistoryService } from '../scheduler/job-history.service';

const JOB_NAME = 'outbox-index-consistency';

/** Discrepancies kept in the job-history record; the rest are in the logs. */
const HISTORY_SAMPLE = 50;

@Injectable()
export class OutboxIndexConsistencyScheduler {
  private readonly logger = new Logger(OutboxIndexConsistencyScheduler.name);

  constructor(
    private readonly service: OutboxIndexConsistencyService,
    private readonly jobLock: JobLockService,
    private readonly jobHistory: JobHistoryService,
  ) {}

  /** Hourly; the default 120-minute window overlaps consecutive runs. */
  @Cron('20 * * * *')
  async handleScheduledCheck(): Promise<void> {
    const acquired = await this.jobLock.tryAcquire(JOB_NAME);
    if (!acquired) {
      await this.jobHistory.markSkipped(JOB_NAME);
      return;
    }

    const run = await this.jobHistory.start(JOB_NAME);
    try {
      const result = await this.service.runCheck();
      await this.jobHistory.complete(run, {
        windowStart: result.windowStart,
        windowEnd: result.windowEnd,
        outboxEventsChecked: result.outboxEventsChecked,
        indexedEventsChecked: result.indexedEventsChecked,
        truncated: result.truncated,
        counts: result.counts,
        discrepancies: result.discrepancies.slice(0, HISTORY_SAMPLE),
      });
      this.logger.log(
        `Outbox/index check complete — outbox=${result.outboxEventsChecked} indexed=${result.indexedEventsChecked} ` +
          `discrepancies=${result.discrepancies.length} truncated=${result.truncated}`,
      );
    } catch (err) {
      await this.jobHistory.fail(run, err);
      this.logger.error(
        `Outbox/index check failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      await this.jobLock.release(JOB_NAME);
    }
  }
}
