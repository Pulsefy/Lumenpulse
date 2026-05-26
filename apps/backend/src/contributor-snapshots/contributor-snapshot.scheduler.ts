import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ContributorSnapshotGenerator } from './contributor-snapshot.generator';

/**
 * Hooks ContributorSnapshotGenerator into NestJS's built-in task scheduler.
 *
 * Runs at 01:05 UTC every day — 5 minutes after the sentiment snapshot job
 * (01:00 UTC) so the two jobs don't compete for DB connections.
 *
 * Yesterday's testnet data is always complete by this time.
 */
@Injectable()
export class ContributorSnapshotScheduler {
  private readonly logger = new Logger(ContributorSnapshotScheduler.name);

  constructor(private readonly generator: ContributorSnapshotGenerator) {}

  /** Nightly contributor snapshot job — fires at 01:05 UTC. */
  @Cron('5 1 * * *', { timeZone: 'UTC', name: 'contributor-snapshot' })
  async handleDailySnapshot(): Promise<void> {
    this.logger.log('Nightly contributor snapshot job triggered');

    try {
      const result = await this.generator.generateForYesterday();
      this.logger.log(
        `Nightly contributor snapshot job finished: ${JSON.stringify(result)}`,
      );
    } catch (err) {
      // Log but don't rethrow — a failed snapshot job must not crash the process.
      this.logger.error(
        'Nightly contributor snapshot job failed',
        (err as Error).stack,
      );
    }
  }
}
