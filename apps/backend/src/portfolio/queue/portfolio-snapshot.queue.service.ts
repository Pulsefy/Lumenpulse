import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { MetricsService } from '../../metrics/metrics.service';
import {
  PORTFOLIO_SNAPSHOT_BATCH_JOB,
  PORTFOLIO_SNAPSHOT_QUEUE,
  PORTFOLIO_SNAPSHOT_QUEUE_NAME,
} from './portfolio-snapshot.constants';
import {
  PortfolioSnapshotBatchJobData,
  PortfolioSnapshotBatchStatus,
  SnapshotTriggerSource,
} from './portfolio-snapshot.types';
import { PortfolioSnapshotProgressStore } from './portfolio-snapshot.progress-store';

@Injectable()
export class PortfolioSnapshotQueueService {
  private readonly logger = new Logger(PortfolioSnapshotQueueService.name);

  constructor(
    @Inject(PORTFOLIO_SNAPSHOT_QUEUE)
    private readonly queue: Queue<PortfolioSnapshotBatchJobData>,
    private readonly progressStore: PortfolioSnapshotProgressStore,
    private readonly configService: ConfigService,
    private readonly metricsService: MetricsService,
  ) {}

  async enqueueSnapshotBatch(
    triggeredBy: SnapshotTriggerSource,
  ): Promise<PortfolioSnapshotBatchStatus> {
    const requestedAt = new Date().toISOString();
    const jobId = randomUUID();

    const jobData: PortfolioSnapshotBatchJobData = {
      triggeredBy,
      requestedAt,
    };

    await this.queue.add(PORTFOLIO_SNAPSHOT_BATCH_JOB, jobData, {
      jobId,
      removeOnComplete: false,
      removeOnFail: false,
    });

    await this.progressStore.markQueued(jobId, triggeredBy, requestedAt);
    await this.refreshQueueMetrics();

    const progress = await this.progressStore.getProgress(jobId);
    if (!progress) {
      return {
        batchId: jobId,
        status: 'queued',
        total: 0,
        completed: 0,
        failed: 0,
        progressPercent: 0,
        triggeredBy,
        requestedAt,
      };
    }
    return progress;
  }

  async getBatchStatus(batchId: string): Promise<PortfolioSnapshotBatchStatus> {
    const progress = await this.progressStore.getProgress(batchId);
    if (progress) {
      return progress;
    }

    const job = await this.queue.getJob(batchId);
    if (!job) {
      return {
        batchId,
        status: 'failed',
        total: 0,
        completed: 0,
        failed: 0,
        progressPercent: 0,
      };
    }

    const state = await job.getState();
    const status: PortfolioSnapshotBatchStatus['status'] =
      state === 'completed'
        ? 'completed'
        : state === 'failed'
          ? 'failed'
          : state === 'active'
            ? 'running'
            : 'queued';

    const batchJobData =
      job.name === PORTFOLIO_SNAPSHOT_BATCH_JOB ? job.data : null;

    return {
      batchId,
      status,
      total: 0,
      completed: 0,
      failed: 0,
      progressPercent: 0,
      requestedAt:
        typeof batchJobData?.requestedAt === 'string'
          ? batchJobData.requestedAt
          : null,
      startedAt: job.processedOn
        ? new Date(job.processedOn).toISOString()
        : null,
      finishedAt: job.finishedOn
        ? new Date(job.finishedOn).toISOString()
        : null,
      triggeredBy: batchJobData?.triggeredBy ?? 'unknown',
    };
  }

  private async refreshQueueMetrics(): Promise<void> {
    const enableMetrics = this.configService.get<string>(
      'PORTFOLIO_SNAPSHOT_QUEUE_METRICS',
      'false',
    );
    if (enableMetrics !== 'true') {
      return;
    }

    const counts = await this.queue.getJobCounts(
      'waiting',
      'active',
      'delayed',
    );
    const size = counts.waiting + counts.active + counts.delayed;
    this.metricsService.setJobQueueSize(PORTFOLIO_SNAPSHOT_QUEUE_NAME, size);
    this.logger.debug(
      `Queue ${PORTFOLIO_SNAPSHOT_QUEUE_NAME} size updated: ${size}`,
    );
  }
}
