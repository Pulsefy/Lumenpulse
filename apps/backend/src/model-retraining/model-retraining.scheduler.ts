import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ModelRetrainingService } from './model-retraining.service';

/**
 * NestJS-side scheduled trigger for model retraining.
 *
 * Fires daily at 02:30 UTC — 30 minutes after the Python scheduler's own
 * 02:00 UTC job, acting as a redundant fallback in case the Python process
 * missed its window (e.g. restart, cold start).
 *
 * The Python service itself deduplicates concurrent runs via a threading lock,
 * so double-triggering is safe.
 */
@Injectable()
export class ModelRetrainingScheduler {
  private readonly logger = new Logger(ModelRetrainingScheduler.name);

  constructor(private readonly retrainingService: ModelRetrainingService) {}

  @Cron('30 2 * * *', { timeZone: 'UTC', name: 'model-retraining-daily' })
  async handleDailyRetraining(): Promise<void> {
    this.logger.log('Daily model retraining job triggered (NestJS scheduler)');
    try {
      const result = await this.retrainingService.triggerRetraining();
      this.logger.log(
        `Daily retraining finished: status=${result.status} ` +
          `duration=${result.duration_seconds?.toFixed(1)}s`,
      );
    } catch (err) {
      // Never crash the process — log and move on
      this.logger.error(
        'Daily model retraining job failed',
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}
