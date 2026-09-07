import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditService } from './audit.service';
import { AdminBlockchainAuditLog } from '../admin-audit/entities/admin-blockchain-audit-log.entity';
import { JobLockService } from '../scheduler/job-lock.service';
import { JobHistoryService } from '../scheduler/job-history.service';
import { config } from '../lib/config';

const AUDIT_LOG_JOB = 'audit-log-cleanup';
const ADMIN_AUDIT_LOG_JOB = 'admin-audit-log-cleanup';

/**
 * Scheduled purge of expired audit log rows.
 *
 * Runs daily at 02:00 UTC (overridable via AUDIT_CLEANUP_CRON).
 * Two separate sub-jobs are executed sequentially under the same cron tick,
 * each with independent job history records and distributed lock slots:
 *
 *   1. audit_logs          — retains AUDIT_LOG_RETENTION_DAYS (default 90)
 *   2. admin_blockchain_audit_logs — retains ADMIN_AUDIT_LOG_RETENTION_DAYS (default 365)
 *
 * Rows are hard-deleted where createdAt < cutoff (exclusive boundary).
 * A PostgreSQL advisory lock (JobLockService) prevents duplicate runs when
 * the backend is scaled horizontally.
 */
@Injectable()
export class AuditScheduler {
  private readonly logger = new Logger(AuditScheduler.name);

  constructor(
    private readonly auditService: AuditService,
    @InjectRepository(AdminBlockchainAuditLog)
    private readonly adminAuditRepo: Repository<AdminBlockchainAuditLog>,
    private readonly jobLock: JobLockService,
    private readonly jobHistory: JobHistoryService,
  ) {}

  @Cron(config.audit.cleanupCron, { timeZone: 'UTC', name: AUDIT_LOG_JOB })
  async handleAuditLogCleanup(): Promise<void> {
    await this.runPurge(
      AUDIT_LOG_JOB,
      config.audit.retentionDays,
      (cutoff) => this.auditService.deleteOlderThan(cutoff),
    );
  }

  @Cron(config.audit.cleanupCron, {
    timeZone: 'UTC',
    name: ADMIN_AUDIT_LOG_JOB,
  })
  async handleAdminAuditLogCleanup(): Promise<void> {
    await this.runPurge(
      ADMIN_AUDIT_LOG_JOB,
      config.audit.adminRetentionDays,
      (cutoff) => this.deleteAdminAuditOlderThan(cutoff),
    );
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async runPurge(
    jobName: string,
    retentionDays: number,
    purge: (cutoff: Date) => Promise<number>,
  ): Promise<void> {
    const acquired = await this.jobLock.tryAcquire(jobName);
    if (!acquired) {
      this.logger.debug(`${jobName}: lock held by another instance, skipping`);
      await this.jobHistory.markSkipped(jobName);
      return;
    }

    const run = await this.jobHistory.start(jobName);
    try {
      const cutoff = new Date(
        Date.now() - retentionDays * 24 * 60 * 60 * 1_000,
      );
      const deleted = await purge(cutoff);
      this.logger.log(
        `${jobName}: deleted ${deleted} rows older than ${cutoff.toISOString()}`,
      );
      await this.jobHistory.complete(run, { deleted, cutoff });
    } catch (err) {
      this.logger.error(`${jobName}: purge failed`, err);
      await this.jobHistory.fail(run, err);
    } finally {
      await this.jobLock.release(jobName);
    }
  }

  /**
   * Hard-delete admin_blockchain_audit_logs rows strictly older than cutoff.
   */
  private async deleteAdminAuditOlderThan(cutoff: Date): Promise<number> {
    const result = await this.adminAuditRepo
      .createQueryBuilder()
      .delete()
      .where('createdAt < :cutoff', { cutoff })
      .execute();
    return result.affected ?? 0;
  }
}
