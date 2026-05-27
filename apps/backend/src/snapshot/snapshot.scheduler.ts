import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SnapshotGenerator } from './snapshot.generator';
import { JobLockService } from '../scheduler/job-lock.service';
import { JobHistoryService } from '../scheduler/job-history.service';

const JOB_NAME = 'daily-snapshot';

/**
 * Hooks `SnapshotGenerator` into NestJS's built-in task scheduler
 * (@nestjs/schedule, which wraps node-cron).
 *
 * The cron runs at 01:00 UTC every day so yesterday's data is guaranteed
 * to be complete before aggregation begins.
 *
 * Registration:
 *   Import `ScheduleModule.forRoot()` in your AppModule and add
 *   `SnapshotScheduler` to the providers array of SnapshotsModule.
 */
@Injectable()
export class SnapshotScheduler {
  private readonly logger = new Logger(SnapshotScheduler.name);

  constructor(
    private readonly generator: SnapshotGenerator,
    private readonly jobLock: JobLockService,
    private readonly jobHistory: JobHistoryService,
  ) {}

  /**
   * Nightly snapshot job — fires at 01:00 UTC.
   *
   * To use a different schedule, replace the cron string:
   *   '0 1 * * *'   = 01:00 every day  (default)
   *   '0 2 * * *'   = 02:00 every day
   *   CronExpression.EVERY_DAY_AT_1AM  (same as above, named constant)
   */
  @Cron('0 1 * * *', { timeZone: 'UTC', name: JOB_NAME })
  async handleDailySnapshot(): Promise<void> {
    this.logger.log('Nightly snapshot job triggered');

    const acquired = await this.jobLock.tryAcquire(JOB_NAME);
    if (!acquired) {
      await this.jobHistory.markSkipped(JOB_NAME);
      return;
    }

    const run = await this.jobHistory.start(JOB_NAME);
    try {
      const result = await this.generator.generateForYesterday();
      await this.jobHistory.complete(run, {
        date: result.date.toISOString(),
        assetRowsWritten: result.assetRowsWritten,
        globalRowWritten: result.globalRowWritten,
        durationMs: result.durationMs,
      });
      this.logger.log(`Nightly snapshot job finished: ${JSON.stringify(result)}`);
    } catch (err) {
      // Log but don't rethrow — a failed snapshot job must not crash the process.
      await this.jobHistory.fail(run, err);
      this.logger.error('Nightly snapshot job failed', (err as Error).stack);
    } finally {
      await this.jobLock.release(JOB_NAME);
    }
  }
}
