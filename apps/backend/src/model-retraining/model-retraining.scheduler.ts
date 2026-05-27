import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ModelRetrainingService } from './model-retraining.service';
import { JobLockService } from '../scheduler/job-lock.service';
import { JobHistoryService } from '../scheduler/job-history.service';

const JOB_NAME = 'model-retraining-daily';

/**
 * NestJS-side scheduled trigger for model retraining.
 *
 * Fires daily at 02:30 UTC — 30 minutes after the Python scheduler's own
 * 02:00 UTC job, acting as a redundant fallback in case the Python process
 * missed its window (e.g. restart, cold start).
 *
 * The Python service itself deduplicates concurrent runs via a threading lock,
 * so double-triggering is safe. The advisory lock here prevents multiple
 * NestJS instances from all firing the fallback simultaneously.
 */
@Injectable()
export class ModelRetrainingScheduler {
  private readonly logger = new Logger(ModelRetrainingScheduler.name);

  constructor(
    private readonly retrainingService: ModelRetrainingService,
    private readonly jobLock: JobLockService,
    private readonly jobHistory: JobHistoryService,
  ) {}

  @Cron('30 2 * * *', { timeZone: 'UTC', name: JOB_NAME })
  async handleDailyRetraining(): Promise<void> {
    this.logger.log('Daily model retraining job triggered (NestJS scheduler)');

    const acquired = await this.jobLock.tryAcquire(JOB_NAME);
    if (!acquired) {
      await this.jobHistory.markSkipped(JOB_NAME);
      return;
    }

    const run = await this.jobHistory.start(JOB_NAME);
    try {
      const result = await this.retrainingService.triggerRetraining();
      await this.jobHistory.complete(run, {
        status: result.status,
        durationSeconds: result.duration_seconds,
      });
      this.logger.log(
        `Daily retraining finished: status=${result.status} ` +
          `duration=${result.duration_seconds?.toFixed(1)}s`,
      );
    } catch (err) {
      // Never crash the process — log and move on
      await this.jobHistory.fail(run, err);
      this.logger.error(
        'Daily model retraining job failed',
        err instanceof Error ? err.stack : String(err),
      );
    } finally {
      await this.jobLock.release(JOB_NAME);
    }
  }
}
