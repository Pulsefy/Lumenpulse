import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ContractHealthSnapshotService } from './contract-health-snapshot.service';

const JOB_NAME = 'contract-health-snapshot';

/**
 * Drives ContractHealthSnapshotService on a periodic cron cadence.
 *
 * Default cadence: every 30 minutes past the hour (0:00, 0:30, 1:00 …).
 * Override via HEALTH_SNAPSHOT_CRON environment variable when a custom
 * schedule is needed (e.g. every 5 minutes during release windows).
 *
 * The scheduler deliberately does *not* acquire a DB-level job lock — the
 * snapshot operation is idempotent and quick, so duplicate runs within a
 * window are harmless.  If you integrate with JobLockService/JobHistoryService
 * (as the daily SnapshotScheduler does), import SchedulerModule and add them.
 */
@Injectable()
export class ContractHealthSnapshotScheduler {
  private readonly logger = new Logger(ContractHealthSnapshotScheduler.name);

  constructor(
    private readonly snapshotService: ContractHealthSnapshotService,
  ) {}

  /**
   * Fires at :00 and :30 of every hour (UTC).
   * cron notation: minute hour day-of-month month day-of-week
   *   '0,30 * * * *'  →  at minute 0 and 30 past every hour
   */
  @Cron('0,30 * * * *', { timeZone: 'UTC', name: JOB_NAME })
  async handleScheduledCapture(): Promise<void> {
    this.logger.log('Scheduled contract-health snapshot triggered');
    try {
      const snapshot = await this.snapshotService.captureSnapshot('scheduler');
      this.logger.log(
        `Snapshot ${snapshot.id} persisted — ` +
          `status=${snapshot.overallStatus}, ` +
          `reachable=${snapshot.summary.reachable}/${snapshot.summary.total}`,
      );
    } catch (err) {
      // Log but do not rethrow — a failed capture must not crash the process.
      this.logger.error(
        `Scheduled capture failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }
}
