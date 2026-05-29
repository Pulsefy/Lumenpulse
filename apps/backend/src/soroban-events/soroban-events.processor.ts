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
  ) {
    super();
  }

  async process(job: Job<IngestSorobanEventDto>): Promise<void> {
    if (job.name !== PROCESS_EVENT_JOB) {
      this.logger.warn(`Unknown job name: ${job.name}`);
      return;
    }

    const { txHash, eventIndex, contractId, eventType, rawPayload } = job.data;

    // Idempotency: skip if already stored (unique index on txHash + eventIndex)
    const existing = await this.eventRepo.findOne({
      where: { txHash, eventIndex },
      select: ['id', 'status'],
    });

    if (existing) {
      this.logger.debug(
        `Soroban event ${txHash}:${eventIndex} already processed (${existing.status}), skipping`,
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
      // placeholder for downstream processing (e.g. trigger notifications, update state)
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
      `Processed soroban event ${txHash}:${eventIndex} (${eventType})`,
    );
  }
}
