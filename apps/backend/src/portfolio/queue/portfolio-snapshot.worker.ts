import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Job, Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { Repository } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { MetricsService } from '../../metrics/metrics.service';
import { PortfolioService } from '../portfolio.service';
import {
  PORTFOLIO_SNAPSHOT_BATCH_JOB,
  PORTFOLIO_SNAPSHOT_CONNECTION,
  PORTFOLIO_SNAPSHOT_QUEUE,
  PORTFOLIO_SNAPSHOT_QUEUE_NAME,
  PORTFOLIO_SNAPSHOT_USER_JOB,
} from './portfolio-snapshot.constants';
import {
  PortfolioSnapshotBatchJobData,
  PortfolioSnapshotUserJobData,
} from './portfolio-snapshot.types';
import { PortfolioSnapshotProgressStore } from './portfolio-snapshot.progress-store';

@Injectable()
export class PortfolioSnapshotWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PortfolioSnapshotWorker.name);
  private worker?: Worker<
    PortfolioSnapshotBatchJobData | PortfolioSnapshotUserJobData
  >;

  private readonly concurrency: number;
  private readonly batchSize: number;
  private readonly attempts: number;
  private readonly retryDelayMs: number;

  constructor(
    @Inject(PORTFOLIO_SNAPSHOT_QUEUE)
    private readonly queue: Queue<
      PortfolioSnapshotBatchJobData | PortfolioSnapshotUserJobData
    >,
    @Inject(PORTFOLIO_SNAPSHOT_CONNECTION)
    private readonly connection: IORedis,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly portfolioService: PortfolioService,
    private readonly progressStore: PortfolioSnapshotProgressStore,
    private readonly configService: ConfigService,
    private readonly metricsService: MetricsService,
  ) {
    this.concurrency = this.configService.get<number>(
      'PORTFOLIO_SNAPSHOT_CONCURRENCY',
      25,
    );
    this.batchSize = this.configService.get<number>(
      'PORTFOLIO_SNAPSHOT_BATCH_SIZE',
      500,
    );
    this.attempts = this.configService.get<number>(
      'PORTFOLIO_SNAPSHOT_ATTEMPTS',
      3,
    );
    this.retryDelayMs = this.configService.get<number>(
      'PORTFOLIO_SNAPSHOT_RETRY_DELAY_MS',
      5000,
    );
  }

  onModuleInit(): void {
    this.worker = new Worker<
      PortfolioSnapshotBatchJobData | PortfolioSnapshotUserJobData
    >(PORTFOLIO_SNAPSHOT_QUEUE_NAME, async (job) => this.process(job), {
      connection: this.connection,
      concurrency: this.concurrency,
    });

    this.worker.on('completed', (job) => {
      void this.handleJobCompleted(job);
    });

    this.worker.on('failed', (job, err) => {
      void this.handleJobFailed(job, err);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }

  private isUserJob(
    job: Job<PortfolioSnapshotBatchJobData | PortfolioSnapshotUserJobData>,
  ): job is Job<PortfolioSnapshotUserJobData> {
    return job.name === PORTFOLIO_SNAPSHOT_USER_JOB;
  }

  private async handleJobCompleted(
    job: Job<PortfolioSnapshotBatchJobData | PortfolioSnapshotUserJobData>,
  ): Promise<void> {
    if (!this.isUserJob(job)) {
      return;
    }

    const { batchId } = job.data;
    await this.progressStore.ensureProgressKey(batchId);
    await this.progressStore.incrementCompleted(batchId);
    await this.progressStore.finalizeIfComplete(batchId);
    this.metricsService.recordJobProcessed(
      PORTFOLIO_SNAPSHOT_QUEUE_NAME,
      'success',
    );
  }

  private async handleJobFailed(
    job:
      | Job<PortfolioSnapshotBatchJobData | PortfolioSnapshotUserJobData>
      | undefined,
    err: Error,
  ): Promise<void> {
    if (!job) {
      return;
    }

    if (!this.isUserJob(job)) {
      this.logger.error(
        `Batch job ${job.id ?? 'unknown'} failed: ${err.message}`,
      );
      return;
    }

    const attempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < attempts) {
      this.logger.warn(
        `Snapshot retry queued for user ${job.data.userId} (attempt ${job.attemptsMade}/${attempts}).`,
      );
      return;
    }

    await this.progressStore.ensureProgressKey(job.data.batchId);
    await this.progressStore.incrementFailed(job.data.batchId);
    await this.progressStore.finalizeIfComplete(job.data.batchId);
    this.metricsService.recordJobProcessed(
      PORTFOLIO_SNAPSHOT_QUEUE_NAME,
      'failure',
    );

    this.logger.error(
      `Snapshot job failed for user ${job.data.userId}: ${err.message}`,
    );
  }

  private async process(
    job: Job<PortfolioSnapshotBatchJobData | PortfolioSnapshotUserJobData>,
  ): Promise<unknown> {
    if (job.name === PORTFOLIO_SNAPSHOT_BATCH_JOB) {
      return this.processBatch(job as Job<PortfolioSnapshotBatchJobData>);
    }

    if (job.name === PORTFOLIO_SNAPSHOT_USER_JOB) {
      return this.processUser(job as Job<PortfolioSnapshotUserJobData>);
    }

    this.logger.warn(`Unknown job type ${job.name} ignored.`);
    return null;
  }

  private async processBatch(
    job: Job<PortfolioSnapshotBatchJobData>,
  ): Promise<{ total: number }> {
    const batchId = String(job.id);
    const startedAt = new Date().toISOString();

    try {
      const total = await this.userRepository.count();
      await this.progressStore.startBatch(
        batchId,
        total,
        job.data.triggeredBy,
        startedAt,
      );

      if (total === 0) {
        await this.progressStore.finalizeIfComplete(batchId);
        return { total };
      }

      let offset = 0;
      while (offset < total) {
        const users = await this.userRepository.find({
          select: ['id'],
          order: { id: 'ASC' },
          take: this.batchSize,
          skip: offset,
        });

        if (users.length === 0) {
          break;
        }

        await this.queue.addBulk(
          users.map((user) => ({
            name: PORTFOLIO_SNAPSHOT_USER_JOB,
            data: {
              userId: user.id,
              batchId,
            },
            opts: {
              attempts: this.attempts,
              backoff: {
                type: 'exponential',
                delay: this.retryDelayMs,
              },
              removeOnComplete: true,
              removeOnFail: false,
            },
          })),
        );

        offset += users.length;
      }

      return { total };
    } catch (error) {
      this.logger.error(
        `Failed to enqueue portfolio snapshot batch ${batchId}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
      await this.progressStore.markFailed(batchId, new Date().toISOString());
      throw error;
    }
  }

  private async processUser(
    job: Job<PortfolioSnapshotUserJobData>,
  ): Promise<{ userId: string }> {
    await this.portfolioService.createSnapshot(job.data.userId);
    return { userId: job.data.userId };
  }
}
