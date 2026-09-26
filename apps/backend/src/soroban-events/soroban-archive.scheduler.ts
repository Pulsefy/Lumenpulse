import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SorobanArchiveService } from './soroban-archive.service';
import { JobLockService } from '../scheduler/job-lock.service';
import { JobHistoryService } from '../scheduler/job-history.service';

export const SOROBAN_ARCHIVE_JOB_NAME = 'soroban-event-archive';

/**
 * Daily job that moves `soroban_events` rows older than the hot window into
 * `soroban_events_archive`. Default 04:00 UTC (after audit retention at
 * 03:00). Set `SOROBAN_ARCHIVE_ENABLED=false` to pause without a deploy.
 */
@Injectable()
export class SorobanArchiveScheduler {
  private readonly logger = new Logger(SorobanArchiveScheduler.name);

  constructor(
    private readonly archive: SorobanArchiveService,
    private readonly jobLock: JobLockService,
    private readonly jobHistory: JobHistoryService,
  ) {}

  @Cron(process.env['SOROBAN_ARCHIVE_CRON'] ?? '0 4 * * *', {
    timeZone: 'UTC',
    name: SOROBAN_ARCHIVE_JOB_NAME,
  })
  async handleArchive(): Promise<void> {
    if (process.env['SOROBAN_ARCHIVE_ENABLED'] === 'false') {
      return;
    }

    const acquired = await this.jobLock.tryAcquire(SOROBAN_ARCHIVE_JOB_NAME);
    if (!acquired) {
      await this.jobHistory.markSkipped(SOROBAN_ARCHIVE_JOB_NAME);
      return;
    }

    const run = await this.jobHistory.start(SOROBAN_ARCHIVE_JOB_NAME);
    try {
      const result = await this.archive.run();
      await this.jobHistory.complete(run, { ...result });
    } catch (err) {
      // A failed archival run must not crash the process; next run retries.
      await this.jobHistory.fail(run, err);
      this.logger.error(
        'Soroban archive job failed',
        (err as Error).stack,
      );
    } finally {
      await this.jobLock.release(SOROBAN_ARCHIVE_JOB_NAME);
    }
  }
}
