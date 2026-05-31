import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bullmq';
import {
  SorobanEvent,
  SorobanEventStatus,
} from './entities/soroban-event.entity';
import { IngestSorobanEventDto } from './dto/ingest-soroban-event.dto';
import {
  SorobanEventsService,
  SOROBAN_EVENTS_QUEUE,
  PROCESS_EVENT_JOB,
} from './soroban-events.service';

@Processor(SOROBAN_EVENTS_QUEUE)
@Injectable()
export class SorobanEventsProcessor extends WorkerHost {
  private readonly logger = new Logger(SorobanEventsProcessor.name);

  constructor(
    @InjectRepository(SorobanEvent)
    private readonly eventRepo: Repository<SorobanEvent>,

    private readonly sorobanEventsService: SorobanEventsService,
  ) {
    super();
  }

  async process(job: Job<IngestSorobanEventDto>): Promise<void> {
    if (job.name !== PROCESS_EVENT_JOB) {
      this.logger.warn(`Unknown job name: ${job.name}`);
      return;
    }

    const { txHash, eventIndex, contractId, eventType, rawPayload } = job.data;

    const existing = await this.eventRepo.findOne({
      where: { txHash, eventIndex },
      select: ['id', 'status'],
    });

    if (existing) {
      this.logger.debug(
        { txHash, eventIndex, status: existing.status },
        'Soroban event already processed, skipping',
      );
      return;
    }

    const event = this.eventRepo.create({
      txHash,
      eventIndex,
      contractId: contractId ?? null,
      eventType: eventType ?? null,
      rawPayload,
      status: SorobanEventStatus.PENDING,
      processedAt: null,
      errorMessage: null,
    });

    await this.eventRepo.save(event);

    try {
      if (contractId === process.env.PROJECT_REGISTRY_CONTRACT_ID) {
        // Cast rawPayload to any so we can access its nested properties safely
        const payloadData = rawPayload as Record<string, any>;

        const projectData = {
          projectId: String(payloadData?.projectId || ''),
          owner: String(payloadData?.owner || ''),
          name: String(payloadData?.name || ''),
          metadataCid: payloadData?.metadataCid
            ? String(payloadData.metadataCid)
            : undefined,
          // If ledgerSeq isn't in job.data, it should be in rawPayload.
          // Fallback to 0 if it's missing to satisfy the interface.
          ledgerSeq: Number(payloadData?.ledgerSeq || 0),
          txHash: String(txHash),
        };

        await this.sorobanEventsService.syncProjectRegistryEvent(projectData);
        this.logger.log(`Project Registry sync successful for tx ${txHash}`);
      }

      event.status = SorobanEventStatus.PROCESSED;
      event.processedAt = new Date();
    } catch (err) {
      event.status = SorobanEventStatus.FAILED;
      event.errorMessage = err instanceof Error ? err.message : String(err);
      await this.eventRepo.save(event);
      throw err; // let BullMQ retry
    }

    await this.eventRepo.save(event);
    this.logger.log(
      { txHash, eventIndex, eventType },
      'Processed soroban event',
    );
  }
}