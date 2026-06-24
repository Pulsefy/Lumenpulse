import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DriftDetectorService } from './drift-detector.service';
import { JobLockService } from '../scheduler/job-lock.service';
import { JobHistoryService } from '../scheduler/job-history.service';

const JOB_NAME = 'drift-detector';

@Injectable()
export class DriftDetectorScheduler {
  private readonly logger = new Logger(DriftDetectorScheduler.name);

  constructor(
    private readonly driftDetectorService: DriftDetectorService,
    private readonly jobLock: JobLockService,
    private readonly jobHistory: JobHistoryService,
  ) {}

  @Cron('0 */6 * * *')
  async handleScheduledDetection(): Promise<void> {
    this.logger.log('Scheduled drift detection triggered');

    const acquired = await this.jobLock.tryAcquire(JOB_NAME);
    if (!acquired) {
      await this.jobHistory.markSkipped(JOB_NAME);
      return;
    }

    const run = await this.jobHistory.start(JOB_NAME);
    try {
      const report = await this.driftDetectorService.runDetection('scheduled');
      await this.jobHistory.complete(run, {
        reportId: report.id,
        totalDrifts: report.totalDrifts,
        criticalCount: report.criticalCount,
        highCount: report.highCount,
        mediumCount: report.mediumCount,
        lowCount: report.lowCount,
      });
      this.logger.log(
        `Scheduled drift detection complete — reportId=${report.id} drifts=${report.totalDrifts}`,
      );
    } catch (err) {
      await this.jobHistory.fail(run, err);
      this.logger.error(
        `Scheduled drift detection failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      await this.jobLock.release(JOB_NAME);
    }
  }
}
