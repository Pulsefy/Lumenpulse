import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { IngestSorobanEventDto } from './dto/ingest-soroban-event.dto';

export const SOROBAN_EVENTS_QUEUE = 'soroban-events';
export const PROCESS_EVENT_JOB = 'process-event';

@Injectable()
export class SorobanEventsService {
  private readonly logger = new Logger(SorobanEventsService.name);

  constructor(
    @InjectQueue(SOROBAN_EVENTS_QUEUE) private readonly queue: Queue,
  ) {}

  async ingest(dto: IngestSorobanEventDto): Promise<{ queued: boolean }> {
    const jobId = `${dto.txHash}:${dto.eventIndex}`;

    // BullMQ deduplicates by jobId — duplicate submissions are silently dropped
    await this.queue.add(PROCESS_EVENT_JOB, dto, {
      jobId,
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 200 },
    });

    this.logger.debug(`Queued soroban event ${jobId}`);
    return { queued: true };
  }
}
