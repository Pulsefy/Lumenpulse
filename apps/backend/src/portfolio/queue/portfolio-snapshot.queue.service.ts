import { Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  PORTFOLIO_SNAPSHOT_BATCH_JOB,
  PORTFOLIO_SNAPSHOT_QUEUE,
} from './portfolio-snapshot.constants';
import {
  PortfolioSnapshotBatchJobData,
  SnapshotTriggerSource,
} from './portfolio-snapshot.types';
import { CorrelationService } from '../../common/correlation/correlation.service';

@Injectable()
export class PortfolioSnapshotQueueService {
  constructor(
    @Inject(PORTFOLIO_SNAPSHOT_QUEUE)
    private readonly queue: Queue<PortfolioSnapshotBatchJobData>,
    private readonly correlationService: CorrelationService,
  ) {}

  async enqueueBatch(triggeredBy: SnapshotTriggerSource = 'manual') {
    const correlationId = this.correlationService.getCorrelationId();

    return this.queue.add(PORTFOLIO_SNAPSHOT_BATCH_JOB, {
      triggeredBy,
      correlationId,
    });
  }
}
