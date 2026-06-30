import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
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
import { SorobanEventsDeadLetterService } from './soroban-events-dead-letter.service';
import { mapSorobanEvent } from './soroban-event-mapper';

@Processor(SOROBAN_EVENTS_QUEUE)
@Injectable()
export class SorobanEventsProcessor extends WorkerHost {
  private readonly logger = new Logger(SorobanEventsProcessor.name);

  constructor(
    @InjectRepository(SorobanEvent)
    private readonly eventRepo: Repository<SorobanEvent>,

    private readonly sorobanEventsService: SorobanEventsService,
    private readonly dlqService: SorobanEventsDeadLetterService,
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

    const mapping = mapSorobanEvent(eventType ?? null);

    const event = this.eventRepo.create({
      txHash,
      eventIndex,
      contractId: contractId ?? null,
      eventType: eventType ?? null,
      canonicalType: mapping?.canonicalType ?? null,
      category: mapping?.category ?? null,
      rawPayload,
      ledgerSequence:
        (job.data as { ledgerSequence?: number }).ledgerSequence ?? null,
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

      // If this event was replayed from dead letter queue, mark it as successful
      await this.dlqService.markReplayed(txHash, eventIndex);
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

  /**
   * Handle job failures
   * When a job fails after exhausting all retries, move to dead letter queue
   * This ensures failed events are captured for manual inspection and replay
   */
  @OnWorkerEvent('failed')
  async onJobFailed(job: Job<IngestSorobanEventDto>, err: Error): Promise<void> {
    if (job.name !== PROCESS_EVENT_JOB) {
      return;
    }

    const { txHash, eventIndex } = job.data;

    this.logger.warn(
      {
        txHash,
        eventIndex,
        attempts: job.attemptsMade,
        error: err.message,
      },
      'Soroban event processing failed, moving to dead letter queue',
    );

    try {
      // Get or create the event record
      let event = await this.eventRepo.findOne({
        where: { txHash, eventIndex },
      });

      if (!event) {
        // Event record might not exist if failure occurred very early
        this.logger.debug(
          { txHash, eventIndex },
          'Event record not found, creating minimal record for DLQ',
        );

        const mapping = mapSorobanEvent(job.data.eventType ?? null);
        event = this.eventRepo.create({
          txHash,
          eventIndex,
          contractId: job.data.contractId ?? null,
          eventType: job.data.eventType ?? null,
          canonicalType: mapping?.canonicalType ?? null,
          category: mapping?.category ?? null,
          rawPayload: job.data.rawPayload,
          ledgerSequence: job.data.ledgerSequence ?? null,
          status: SorobanEventStatus.FAILED,
          errorMessage: err.message,
        });

        await this.eventRepo.save(event);
      }

      // Move to dead letter queue for inspection and manual replay
      await this.dlqService.moveToDeadLetter(event, err);
    } catch (dlqErr) {
      this.logger.error(
        {
          txHash,
          eventIndex,
          dlqError:
            dlqErr instanceof Error
              ? dlqErr.message
              : String(dlqErr),
        },
        'Failed to move event to dead letter queue',
      );
    }
  }
}
