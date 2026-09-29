import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AuditRetentionService } from './audit-retention.service';
import { JobLockService } from '../../scheduler/job-lock.service';
import { JobHistoryService } from '../../scheduler/job-history.service';

const JOB_NAME = 'audit-retention';

/**
 * Nightly job that archives or purges audit records past their retention
 * window. Runs at 03:00 UTC by default (`AUDIT_RETENTION_CRON` overrides);
 * set `AUDIT_RETENTION_ENABLED=false` to pause it without a deploy.
 */
@Injectable()
export class AuditRetentionScheduler {
  private readonly logger = new Logger(AuditRetentionScheduler.name);

  constructor(
    private readonly retention: AuditRetentionService,
    private readonly jobLock: JobLockService,
    private readonly jobHistory: JobHistoryService,
  ) {}

  @Cron(process.env['AUDIT_RETENTION_CRON'] ?? '0 3 * * *', {
    timeZone: 'UTC',
    name: JOB_NAME,
  })
  async handleRetention(): Promise<void> {
    if (process.env['AUDIT_RETENTION_ENABLED'] === 'false') {
      return;
    }

    const acquired = await this.jobLock.tryAcquire(JOB_NAME);
    if (!acquired) {
      await this.jobHistory.markSkipped(JOB_NAME);
      return;
    }

    const run = await this.jobHistory.start(JOB_NAME);
    try {
      const results = await this.retention.run();
      await this.jobHistory.complete(run, { results });
    } catch (err) {
      // A failed retention run must not crash the process; the next run retries.
      await this.jobHistory.fail(run, err);
      this.logger.error('Audit retention job failed', (err as Error).stack);
    } finally {
      await this.jobLock.release(JOB_NAME);
    }
  }
}
