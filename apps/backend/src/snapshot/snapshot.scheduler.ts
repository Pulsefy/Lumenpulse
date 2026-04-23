import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SnapshotGenerator } from './snapshot.generator';

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

  constructor(private readonly generator: SnapshotGenerator) {}

  /**
   * Nightly snapshot job — fires at 01:00 UTC.
   *
   * To use a different schedule, replace the cron string:
   *   '0 1 * * *'   = 01:00 every day  (default)
   *   '0 2 * * *'   = 02:00 every day
   *   CronExpression.EVERY_DAY_AT_1AM  (same as above, named constant)
   */
  @Cron('0 1 * * *', { timeZone: 'UTC', name: 'daily-snapshot' })
  async handleDailySnapshot(): Promise<void> {
    this.logger.log('Nightly snapshot job triggered');

    try {
      const result = await this.generator.generateForYesterday();
      this.logger.log(
        `Nightly snapshot job finished: ${JSON.stringify(result)}`,
      );
    } catch (err) {
      // Log but don't rethrow — a failed snapshot job must not crash the process.
      this.logger.error('Nightly snapshot job failed', (err as Error).stack);
    }
  }
}
