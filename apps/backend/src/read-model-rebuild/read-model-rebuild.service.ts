import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere, In, IsNull, MoreThan } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { isAxiosError } from 'axios';
import {
  ReadModelRebuildJob,
  RebuildStatus,
  RebuildDataset,
} from './entities/read-model-rebuild-job.entity';
import { RebuildRequestDto } from './dto/rebuild-request.dto';
import {
  RebuildResponseDto,
  RebuildStatusResponseDto,
  RebuildTriggerResponseDto,
} from './dto/rebuild-response.dto';
import { JobLockService } from '../scheduler/job-lock.service';
import { JobHistoryService } from '../scheduler/job-history.service';
import { AdminAuditService } from '../admin-audit/admin-audit.service';

interface RebuildResultResponse {
  totalItems?: number;
  processedItems?: number;
  failedItems?: number;
}

interface RebuildRequestPayload {
  dataset: RebuildDataset;
  force: boolean;
  contract_id?: string;
  idempotency_key?: string;
}

interface ErrorDetails {
  message: string;
  stack?: string;
  code?: string;
}

function getErrorDetails(error: unknown): ErrorDetails {
  if (isAxiosError(error)) {
    return { message: error.message, stack: error.stack, code: error.code };
  }
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack };
  }
  return { message: String(error) };
}

@Injectable()
export class ReadModelRebuildService {
  private readonly logger = new Logger(ReadModelRebuildService.name);
  private readonly REBUILD_VERSION = '1.0.0';

  // Mapping of datasets to their data-processing endpoints
  private readonly datasetEndpoints: Record<RebuildDataset, string> = {
    [RebuildDataset.KPI_SNAPSHOTS]: '/api/rebuild/kpi-snapshots',
    [RebuildDataset.PROJECT_VIEWS]: '/api/rebuild/project-views',
    [RebuildDataset.CONTRACT_EVENTS]: '/api/rebuild/contract-events',
    [RebuildDataset.DAILY_METRICS]: '/api/rebuild/metrics',
    [RebuildDataset.ALL]: '/api/rebuild/all',
  };

  constructor(
    @InjectRepository(ReadModelRebuildJob)
    private readonly jobRepo: Repository<ReadModelRebuildJob>,
    private readonly httpService: HttpService,
    private readonly jobLockService: JobLockService,
    private readonly jobHistoryService: JobHistoryService,
    private readonly adminAuditService: AdminAuditService,
  ) {}

  /**
   * Trigger a rebuild for a specific dataset or contract domain
   */
  async triggerRebuild(
    dto: RebuildRequestDto,
    userId: string,
  ): Promise<RebuildTriggerResponseDto> {
    const { dataset, contractId, reason, idempotencyKey, force } = dto;

    // Check for existing in-progress or pending job for the same dataset/contract
    if (!force) {
      const existingJob = await this.findExistingJob(dataset, contractId);
      if (existingJob) {
        this.logger.warn(
          `Duplicate rebuild request for dataset=${dataset}, contract=${contractId || 'all'} by user=${userId}`,
        );
        return {
          jobId: existingJob.id,
          status: 'duplicate',
          message: `Rebuild already ${existingJob.status} for this dataset/contract. Use force=true to override.`,
          started: false,
          existingJobId: existingJob.id,
        };
      }
    }

    // Create job record
    const job = this.jobRepo.create({
      dataset,
      contractId: contractId || null,
      status: RebuildStatus.PENDING,
      triggerReason: reason || null,
      triggeredBy: userId,
      idempotencyKey: idempotencyKey || null,
      rebuildVersion: this.REBUILD_VERSION,
      totalItems: 0,
      processedItems: 0,
      failedItems: 0,
    });

    await this.jobRepo.save(job);

    // Start rebuild asynchronously
    this.processRebuild(job.id, userId).catch((error: unknown) => {
      const { message, stack } = getErrorDetails(error);
      this.logger.error(`Rebuild job ${job.id} failed: ${message}`, stack);
    });

    // Log audit
    await this.adminAuditService.create({
      actorId: userId,
      endpoint: '/api/read-model/rebuild',
      targetContract: contractId || undefined,
      params: { dataset, contractId, reason, idempotencyKey },
    });

    this.logger.log(
      `Rebuild triggered: job=${job.id}, dataset=${dataset}, contract=${contractId || 'all'}, user=${userId}`,
    );

    return {
      jobId: job.id,
      status: 'started',
      message: `Rebuild job ${job.id} started for dataset ${dataset}`,
      started: true,
    };
  }

  /**
   * Find existing job for dataset/contract combination
   */
  private async findExistingJob(
    dataset: RebuildDataset,
    contractId?: string,
  ): Promise<ReadModelRebuildJob | null> {
    const where: FindOptionsWhere<ReadModelRebuildJob> = {
      dataset,
      status: In([RebuildStatus.PENDING, RebuildStatus.IN_PROGRESS]),
    };

    if (contractId) {
      where.contractId = contractId;
    } else {
      where.contractId = IsNull();
    }

    return this.jobRepo.findOne({
      where,
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Process a rebuild job asynchronously
   */
  async processRebuild(jobId: string, userId: string): Promise<void> {
    const job = await this.jobRepo.findOne({ where: { id: jobId } });
    if (!job) {
      throw new NotFoundException(`Job ${jobId} not found`);
    }

    // Use distributed lock to prevent concurrent processing
    const lockKey = `rebuild:${jobId}`;
    const acquired = await this.jobLockService.tryAcquire(lockKey);

    if (!acquired) {
      this.logger.warn(`Could not acquire lock for job ${jobId}, skipping`);
      return;
    }

    try {
      await this.executeRebuild(job, userId);
    } finally {
      await this.jobLockService.release(lockKey);
    }
  }

  /**
   * Execute the actual rebuild
   */
  private async executeRebuild(
    job: ReadModelRebuildJob,
    userId: string,
  ): Promise<void> {
    const startTime = Date.now();
    const historyRun = await this.jobHistoryService.start(
      `rebuild:${job.dataset}`,
      userId,
    );

    // Update job status to in_progress
    job.status = RebuildStatus.IN_PROGRESS;
    job.startedAt = new Date();
    job.progressDetails = {
      phase: 'initializing',
      startTime: startTime,
    };
    await this.jobRepo.save(job);

    try {
      const endpoint = this.datasetEndpoints[job.dataset];

      // Build request payload
      const payload: RebuildRequestPayload = {
        dataset: job.dataset,
        force: true, // Always force for rebuilds
      };

      if (job.contractId) {
        payload.contract_id = job.contractId;
      }

      if (job.idempotencyKey) {
        payload.idempotency_key = job.idempotencyKey;
      }

      // Call data-processing service
      const dataProcessingUrl =
        process.env.DATA_PROCESSING_URL || 'http://localhost:8001';
      const url = `${dataProcessingUrl}${endpoint}`;

      // Update progress
      job.progressDetails = {
        phase: 'calling_data_processing',
        url,
        payload,
      };
      await this.jobRepo.save(job);

      this.logger.log(`Calling data-processing: ${url}`);

      const response = await firstValueFrom(
        this.httpService.post<RebuildResultResponse>(url, payload, {
          headers: {
            'X-API-Key': process.env.DATA_PROCESSING_API_KEY || '',
            'X-Correlation-ID': `rebuild-${job.id}`,
          },
          timeout: 300000, // 5 minutes
        }),
      );

      // Update job with results
      const result = response.data;

      job.status = RebuildStatus.COMPLETED;
      job.completedAt = new Date();
      job.totalItems = result.totalItems || 0;
      job.processedItems = result.processedItems || 0;
      job.failedItems = result.failedItems || 0;
      job.progressDetails = {
        phase: 'completed',
        result: result,
        duration_ms: Date.now() - startTime,
      };

      // Log to job history
      await this.jobHistoryService.complete(historyRun, {
        jobId: job.id,
        contractId: job.contractId,
        totalItems: job.totalItems,
        processedItems: job.processedItems,
        failedItems: job.failedItems,
      });

      this.logger.log(
        `Rebuild job ${job.id} completed: ${job.processedItems}/${job.totalItems} items processed`,
      );
    } catch (error) {
      // Handle failure
      const { message, stack, code } = getErrorDetails(error);

      job.status = RebuildStatus.FAILED;
      job.completedAt = new Date();
      job.errorMessage = message;
      job.errorStack = stack || null;
      job.progressDetails = {
        phase: 'failed',
        error: message,
        errorCode: code,
        duration_ms: Date.now() - startTime,
      };

      // Log to job history
      await this.jobHistoryService.fail(historyRun, error);

      this.logger.error(`Rebuild job ${job.id} failed: ${message}`, stack);
    }

    // Save final state
    await this.jobRepo.save(job);

    // Log audit
    await this.adminAuditService.create({
      actorId: userId,
      endpoint: `/api/read-model/rebuild/${job.id}/complete`,
      targetContract: job.contractId || undefined,
      params: {
        status: job.status,
        totalItems: job.totalItems,
        processedItems: job.processedItems,
        failedItems: job.failedItems,
      },
    });
  }

  /**
   * Get status of a rebuild job
   */
  async getJobStatus(jobId: string): Promise<RebuildStatusResponseDto> {
    const job = await this.jobRepo.findOne({ where: { id: jobId } });
    if (!job) {
      throw new NotFoundException(`Job ${jobId} not found`);
    }

    return Object.assign(
      new RebuildStatusResponseDto(),
      this.mapToResponse(job),
      {
        isTerminal: [
          RebuildStatus.COMPLETED,
          RebuildStatus.FAILED,
          RebuildStatus.CANCELLED,
        ].includes(job.status),
        statusMessage: this.getStatusMessage(job),
      },
    );
  }

  /**
   * List recent rebuild jobs
   */
  async listJobs(
    dataset?: RebuildDataset,
    status?: RebuildStatus,
    limit: number = 50,
  ): Promise<RebuildResponseDto[]> {
    const where: FindOptionsWhere<ReadModelRebuildJob> = {};

    if (dataset) where.dataset = dataset;
    if (status) where.status = status;

    const jobs = await this.jobRepo.find({
      where,
      order: { createdAt: 'DESC' },
      take: Math.min(limit, 100),
    });

    return jobs.map((job) => this.mapToResponse(job));
  }

  /**
   * Cancel a pending rebuild job
   */
  async cancelJob(
    jobId: string,
    userId: string,
  ): Promise<{ success: boolean; message: string }> {
    const job = await this.jobRepo.findOne({ where: { id: jobId } });
    if (!job) {
      throw new NotFoundException(`Job ${jobId} not found`);
    }

    if (
      job.status === RebuildStatus.COMPLETED ||
      job.status === RebuildStatus.FAILED
    ) {
      throw new BadRequestException(
        `Cannot cancel job with status ${job.status}`,
      );
    }

    if (job.status === RebuildStatus.IN_PROGRESS) {
      // Try to cancel running job
      // In a real implementation, this would signal the worker to stop
      job.status = RebuildStatus.CANCELLED;
      job.completedAt = new Date();
      job.progressDetails = {
        phase: 'cancelled',
        cancelledBy: userId,
        cancelledAt: new Date().toISOString(),
      };
      await this.jobRepo.save(job);

      await this.adminAuditService.create({
        actorId: userId,
        endpoint: '/api/read-model/rebuild/cancel',
        params: { jobId, reason: 'User cancelled' },
      });

      return { success: true, message: `Job ${jobId} cancelled` };
    }

    // Pending job - just mark as cancelled
    job.status = RebuildStatus.CANCELLED;
    job.completedAt = new Date();
    job.progressDetails = {
      phase: 'cancelled',
      cancelledBy: userId,
      cancelledAt: new Date().toISOString(),
    };
    await this.jobRepo.save(job);

    return { success: true, message: `Job ${jobId} cancelled` };
  }

  /**
   * Clean up old job records
   */
  async cleanupJobs(olderThanDays: number = 30): Promise<{ deleted: number }> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const result = await this.jobRepo.delete({
      status: In([
        RebuildStatus.COMPLETED,
        RebuildStatus.FAILED,
        RebuildStatus.CANCELLED,
      ]),
      createdAt: MoreThan(cutoffDate),
    });

    this.logger.log(`Cleaned up ${result.affected} old rebuild jobs`);
    return { deleted: result.affected || 0 };
  }

  /**
   * Map job entity to response DTO
   */
  private mapToResponse(job: ReadModelRebuildJob): RebuildResponseDto {
    return Object.assign(new RebuildResponseDto(), {
      id: job.id,
      dataset: job.dataset,
      contractId: job.contractId,
      status: job.status,
      triggerReason: job.triggerReason,
      triggeredBy: job.triggeredBy,
      totalItems: job.totalItems,
      processedItems: job.processedItems,
      failedItems: job.failedItems,
      progressDetails: job.progressDetails,
      errorMessage: job.errorMessage,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    });
  }

  /**
   * Get human-readable status message
   */
  private getStatusMessage(job: ReadModelRebuildJob): string {
    switch (job.status) {
      case RebuildStatus.PENDING:
        return 'Job is waiting to be processed';
      case RebuildStatus.IN_PROGRESS:
        return `Processing ${job.processedItems}/${job.totalItems} items...`;
      case RebuildStatus.COMPLETED:
        return `Successfully processed ${job.processedItems} items`;
      case RebuildStatus.FAILED:
        return `Failed: ${job.errorMessage}`;
      case RebuildStatus.CANCELLED:
        return 'Job was cancelled';
      default:
        return 'Unknown status';
    }
  }
}
