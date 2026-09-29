import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { IdempotencyService } from './idempotency.service';
import { JobLockService } from '../scheduler/job-lock.service';
import { config } from '../lib/config';

const JOB_NAME = 'idempotency-cleanup';

/**
 * Removes expired idempotency records on a documented schedule.
 *
 * Default: daily at 03:00 UTC (`0 3 * * *`), overridable via the
 * `IDEMPOTENCY_CLEANUP_CRON` environment variable. Completed records are kept
 * for the retention window (`IDEMPOTENCY_RETENTION_MS`, default 24h) so a late
 * client retry still replays the original response; in_progress claims are
 * dropped once their lease (`IDEMPOTENCY_LEASE_MS`) has lapsed.
 *
 * A PostgreSQL advisory lock (via `JobLockService`) ensures only one instance
 * runs the sweep when the backend is scaled horizontally.
 */
@Injectable()
export class IdempotencyScheduler {
  private readonly logger = new Logger(IdempotencyScheduler.name);

  constructor(
    private readonly service: IdempotencyService,
    private readonly jobLock: JobLockService,
  ) {}

  @Cron(config.idempotency.cleanupCron, { timeZone: 'UTC', name: JOB_NAME })
  async handleCleanup(): Promise<void> {
    const acquired = await this.jobLock.tryAcquire(JOB_NAME);
    if (!acquired) return;

    try {
      const deleted = await this.service.cleanupExpired();
      if (deleted > 0) {
        this.logger.log(`Cleaned up ${deleted} expired idempotency records`);
      }
    } finally {
      await this.jobLock.release(JOB_NAME);
    }
  }
}
