import { Injectable, Logger } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import IORedis from 'ioredis';
import {
  PORTFOLIO_SNAPSHOT_CONNECTION,
  PORTFOLIO_SNAPSHOT_PROGRESS_KEY_PREFIX,
  PORTFOLIO_SNAPSHOT_PROGRESS_TTL_SECONDS,
} from './portfolio-snapshot.constants';
import { PortfolioSnapshotBatchStatus } from './portfolio-snapshot.types';

@Injectable()
export class PortfolioSnapshotProgressStore {
  private readonly logger = new Logger(PortfolioSnapshotProgressStore.name);

  constructor(
    @Inject(PORTFOLIO_SNAPSHOT_CONNECTION)
    private readonly redis: IORedis,
  ) {}

  private key(batchId: string): string {
    return `${PORTFOLIO_SNAPSHOT_PROGRESS_KEY_PREFIX}${batchId}`;
  }

  async markQueued(
    batchId: string,
    triggeredBy: string,
    requestedAt: string,
  ): Promise<void> {
    const key = this.key(batchId);
    await this.redis.hset(key, {
      status: 'queued',
      total: '0',
      completed: '0',
      failed: '0',
      triggeredBy,
      requestedAt,
    });
    await this.redis.expire(key, PORTFOLIO_SNAPSHOT_PROGRESS_TTL_SECONDS);
  }

  async startBatch(
    batchId: string,
    total: number,
    triggeredBy: string,
    startedAt: string,
  ): Promise<void> {
    const key = this.key(batchId);
    await this.redis.hset(key, {
      status: 'running',
      total: String(total),
      completed: '0',
      failed: '0',
      triggeredBy,
      startedAt,
    });
    await this.redis.expire(key, PORTFOLIO_SNAPSHOT_PROGRESS_TTL_SECONDS);
  }

  async markFailed(batchId: string, finishedAt: string): Promise<void> {
    const key = this.key(batchId);
    await this.redis.hset(key, {
      status: 'failed',
      finishedAt,
    });
    await this.redis.expire(key, PORTFOLIO_SNAPSHOT_PROGRESS_TTL_SECONDS);
  }

  async incrementCompleted(
    batchId: string,
  ): Promise<PortfolioSnapshotBatchStatus | null> {
    await this.redis.hincrby(this.key(batchId), 'completed', 1);
    await this.redis.expire(
      this.key(batchId),
      PORTFOLIO_SNAPSHOT_PROGRESS_TTL_SECONDS,
    );
    return this.getProgress(batchId);
  }

  async incrementFailed(
    batchId: string,
  ): Promise<PortfolioSnapshotBatchStatus | null> {
    await this.redis.hincrby(this.key(batchId), 'failed', 1);
    await this.redis.expire(
      this.key(batchId),
      PORTFOLIO_SNAPSHOT_PROGRESS_TTL_SECONDS,
    );
    return this.getProgress(batchId);
  }

  async finalizeIfComplete(batchId: string): Promise<void> {
    const progress = await this.getProgress(batchId);
    if (!progress) {
      return;
    }
    if (progress.total === 0) {
      await this.redis.hset(this.key(batchId), {
        status: 'completed',
        finishedAt: new Date().toISOString(),
      });
      return;
    }

    if (progress.completed + progress.failed < progress.total) {
      return;
    }

    const status = progress.failed > 0 ? 'completed_with_errors' : 'completed';
    await this.redis.hset(this.key(batchId), {
      status,
      finishedAt: new Date().toISOString(),
    });
    await this.redis.expire(
      this.key(batchId),
      PORTFOLIO_SNAPSHOT_PROGRESS_TTL_SECONDS,
    );
  }

  async getProgress(
    batchId: string,
  ): Promise<PortfolioSnapshotBatchStatus | null> {
    const key = this.key(batchId);
    const data = await this.redis.hgetall(key);
    if (!data || Object.keys(data).length === 0) {
      return null;
    }

    const total = Number(data.total ?? 0);
    const completed = Number(data.completed ?? 0);
    const failed = Number(data.failed ?? 0);
    const finishedAt = data.finishedAt ?? null;
    const startedAt = data.startedAt ?? null;
    const requestedAt = data.requestedAt ?? null;
    const status = (data.status ??
      'queued') as PortfolioSnapshotBatchStatus['status'];

    const processed = completed + failed;
    const progressPercent =
      total === 0 ? 0 : Math.min(100, Math.round((processed / total) * 100));

    return {
      batchId,
      status,
      total,
      completed,
      failed,
      progressPercent,
      triggeredBy: (data.triggeredBy ??
        'unknown') as PortfolioSnapshotBatchStatus['triggeredBy'],
      requestedAt,
      startedAt,
      finishedAt,
    };
  }

  async ensureProgressKey(batchId: string): Promise<void> {
    const key = this.key(batchId);
    const exists = await this.redis.exists(key);
    if (!exists) {
      this.logger.warn(
        `Progress key missing for batch ${batchId}. Recreating in failed state.`,
      );
      await this.redis.hset(key, {
        status: 'failed',
        total: '0',
        completed: '0',
        failed: '0',
        finishedAt: new Date().toISOString(),
      });
      await this.redis.expire(key, PORTFOLIO_SNAPSHOT_PROGRESS_TTL_SECONDS);
    }
  }
}
