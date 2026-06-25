import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IngestSorobanEventDto } from './dto/ingest-soroban-event.dto';
import { ProjectRegistryEntity } from '../database/entities/project-registry.entity';

export const SOROBAN_EVENTS_QUEUE = 'soroban-events';
export const PROCESS_EVENT_JOB = 'process-event';

// 1. We define a strict interface for your event data to satisfy ESLint
export interface ProjectEventPayload {
  projectId: string;
  owner: string;
  name: string;
  metadataCid?: string;
  ledgerSeq: number;
  txHash: string;
}

@Injectable()
export class SorobanEventsService {
  private readonly logger = new Logger(SorobanEventsService.name);

  constructor(
    @InjectQueue(SOROBAN_EVENTS_QUEUE) private readonly queue: Queue,

    @InjectRepository(ProjectRegistryEntity)
    private readonly projectRepo: Repository<ProjectRegistryEntity>,
  ) {}

  async ingest(
    dto: IngestSorobanEventDto,
    requestId?: string,
  ): Promise<{ queued: boolean }> {
    const jobId = `${dto.txHash}:${dto.eventIndex}`;

    await this.queue.add(PROCESS_EVENT_JOB, dto, {
      jobId,
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 200 },
    });

    this.logger.log(
      { requestId, jobId, txHash: dto.txHash, eventIndex: dto.eventIndex },
      'Queued soroban event',
    );
    return { queued: true };
  }

  // 2. We replace 'any' with our new 'ProjectEventPayload' interface
  async syncProjectRegistryEvent(
    eventData: ProjectEventPayload,
  ): Promise<void> {
    // ESLint is now happy because it knows exactly what types these variables are
    const { projectId, owner, name, metadataCid, ledgerSeq, txHash } =
      eventData;

    const existing = await this.projectRepo.findOne({ where: { projectId } });

    if (existing && existing.lastLedgerSeq > ledgerSeq) {
      this.logger.debug(`Skipping stale event for Project ${projectId}`);
      return;
    }

    await this.projectRepo.upsert(
      {
        projectId,
        owner,
        name,
        metadataCid: metadataCid ?? existing?.metadataCid,
        lastLedgerSeq: ledgerSeq, // Traceability pointer
        lastTxHash: txHash, // Traceability pointer
      },
      ['projectId'], // Conflict target prevents duplicate rows
    );
  }
}
