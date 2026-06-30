import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  SorobanEventDeadLetter,
  DeadLetterStatus,
} from './entities/soroban-event-dead-letter.entity';
import { SorobanEvent } from './entities/soroban-event.entity';
import { IngestSorobanEventDto } from './dto/ingest-soroban-event.dto';
import {
  ListDeadLetterEventsQueryDto,
  PaginatedDeadLetterResponseDto,
  DeadLetterEventDto,
  DeadLetterStatsDto,
} from './dto/dead-letter.dto';
import { SOROBAN_EVENTS_QUEUE, PROCESS_EVENT_JOB } from './soroban-events.service';

/**
 * Dead Letter Queue Service for Soroban Events
 *
 * Responsibilities:
 * - Capture failed event processing attempts
 * - Preserve failure reasons and attempt history
 * - Provide inspection capabilities for maintainers
 * - Enable safe event replay with idempotency
 * - Track replay attempts to prevent infinite loops
 */
@Injectable()
export class SorobanEventsDeadLetterService {
  private readonly logger = new Logger(
    SorobanEventsDeadLetterService.name,
  );

  constructor(
    @InjectRepository(SorobanEventDeadLetter)
    private readonly dlqRepo: Repository<SorobanEventDeadLetter>,

    @InjectRepository(SorobanEvent)
    private readonly eventRepo: Repository<SorobanEvent>,

    @InjectQueue(SOROBAN_EVENTS_QUEUE)
    private readonly queue: Queue,
  ) {}

  /**
   * Move a failed event to the dead letter queue
   * Preserves error context and creates entry for replay
   * Idempotent: updates existing entry if already in DLQ
   *
   * @param event - SorobanEvent entity
   * @param error - Error that occurred during processing
   * @returns Dead letter queue entry
   */
  async moveToDeadLetter(
    event: SorobanEvent,
    error: Error,
  ): Promise<SorobanEventDeadLetter> {
    const existingDLQ = await this.dlqRepo.findOne({
      where: {
        txHash: event.txHash,
        eventIndex: event.eventIndex,
      },
    });

    const errorEntry = {
      timestamp: new Date().toISOString(),
      message: error.message,
      stack: error.stack,
    };

    if (existingDLQ) {
      // Update existing DLQ entry (idempotent)
      existingDLQ.failureCount++;
      existingDLQ.lastErrorMessage = error.message;
      existingDLQ.lastErrorStack = error.stack ?? null;
      existingDLQ.lastAttemptAt = new Date();
      existingDLQ.errorHistory = [
        ...(existingDLQ.errorHistory || []),
        errorEntry,
      ];
      existingDLQ.updatedAt = new Date();

      const saved = await this.dlqRepo.save(existingDLQ);
      this.logger.debug(
        {
          dlqId: saved.id,
          txHash: event.txHash,
          failureCount: saved.failureCount,
        },
        'Updated dead letter queue entry',
      );
      return saved;
    }

    // Create new DLQ entry
    const dlqEntry = this.dlqRepo.create({
      sorobanEventId: event.id,
      txHash: event.txHash,
      eventIndex: event.eventIndex,
      contractId: event.contractId,
      eventType: event.eventType,
      canonicalType: event.canonicalType,
      category: event.category,
      rawPayload: event.rawPayload,
      ledgerSequence: event.ledgerSequence,
      failureCount: 1,
      lastErrorMessage: error.message,
      lastErrorStack: error.stack ?? null,
      lastAttemptAt: new Date(),
      errorHistory: [errorEntry],
      status: DeadLetterStatus.PENDING,
      updatedAt: new Date(),
    });

    const saved = await this.dlqRepo.save(dlqEntry);
    this.logger.log(
      {
        dlqId: saved.id,
        txHash: event.txHash,
        eventIndex: event.eventIndex,
        error: error.message,
      },
      'Moved event to dead letter queue',
    );

    return saved;
  }

  /**
   * List dead letter queue events with filtering and pagination
   *
   * @param query - Query parameters for filtering and sorting
   * @returns Paginated results
   */
  async listFailedEvents(
    query: ListDeadLetterEventsQueryDto,
  ): Promise<PaginatedDeadLetterResponseDto> {
    const {
      page = 0,
      limit = 20,
      status,
      eventType,
      contractId,
      sortBy = 'createdAt',
      sortOrder = 'DESC',
    } = query;

    const qb = this.dlqRepo.createQueryBuilder('dlq');

    if (status) {
      qb.andWhere('dlq.status = :status', { status });
    }

    if (eventType) {
      qb.andWhere('dlq.eventType = :eventType', { eventType });
    }

    if (contractId) {
      qb.andWhere('dlq.contractId = :contractId', { contractId });
    }

    // Validate sortBy to prevent SQL injection
    const validSortFields = ['createdAt', 'failureCount', 'lastAttemptAt'];
    const sortField = validSortFields.includes(sortBy)
      ? sortBy
      : 'createdAt';

    qb.orderBy(`dlq.${sortField}`, sortOrder as 'ASC' | 'DESC');

    const [data, total] = await qb
      .skip(page * limit)
      .take(limit)
      .getManyAndCount();

    return {
      data: data.map((dlq) => this.entityToDto(dlq)),
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get detailed information about a failed event
   *
   * @param dlqId - Dead letter queue entry ID
   * @returns Full dead letter event details
   */
  async inspectFailure(dlqId: string): Promise<DeadLetterEventDto> {
    const dlq = await this.dlqRepo.findOneBy({ id: dlqId });

    if (!dlq) {
      throw new BadRequestException(
        `Dead letter queue entry not found: ${dlqId}`,
      );
    }

    return this.entityToDto(dlq);
  }

  /**
   * Replay a failed event from the dead letter queue
   * Ensures idempotency by not re-processing if already successfully replayed
   *
   * Replay Strategy:
   * 1. Check if event can be replayed (hasn't exceeded max attempts)
   * 2. Queue event for processing again
   * 3. Increment replay counter to track attempts
   * 4. Return job ID for monitoring
   *
   * @param dlqId - Dead letter queue entry ID
   * @param reason - Optional reason for replay
   * @returns Replay operation details
   */
  async replayEvent(
    dlqId: string,
    reason?: string,
  ): Promise<{
    message: string;
    jobId: string;
    eventId: string;
    replayCount: number;
  }> {
    const dlq = await this.dlqRepo.findOneBy({ id: dlqId });

    if (!dlq) {
      throw new BadRequestException(
        `Dead letter queue entry not found: ${dlqId}`,
      );
    }

    // Prevent excessive replay attempts (max 5)
    const MAX_REPLAY_ATTEMPTS = 5;
    if (dlq.replayCount >= MAX_REPLAY_ATTEMPTS) {
      throw new BadRequestException(
        `Event has exceeded maximum replay attempts (${MAX_REPLAY_ATTEMPTS})`,
      );
    }

    // If the event was already successfully replayed, don't queue it again
    // This ensures idempotency - replaying the same DLQ entry multiple times
    // won't cause duplicate processing
    if (dlq.status === DeadLetterStatus.REPLAYED) {
      this.logger.debug(
        {
          dlqId,
          txHash: dlq.txHash,
          replayCount: dlq.replayCount,
        },
        'Event already successfully replayed, skipping re-queue',
      );
      return {
        message: 'Event already successfully replayed',
        jobId: `${dlq.txHash}:${dlq.eventIndex}`,
        eventId: dlq.id,
        replayCount: dlq.replayCount,
      };
    }

    // Reconstruct original event DTO for replay
    const eventDto: IngestSorobanEventDto = {
      txHash: dlq.txHash,
      eventIndex: dlq.eventIndex,
      contractId: dlq.contractId ?? undefined,
      eventType: dlq.eventType ?? undefined,
      rawPayload: dlq.rawPayload,
      ledgerSequence: dlq.ledgerSequence ?? undefined,
    };

    // Queue for processing with high priority and tracked replay
    const jobId = `${dlq.txHash}:${dlq.eventIndex}`;
    await this.queue.add(PROCESS_EVENT_JOB, eventDto, {
      jobId,
      attempts: 1, // Single attempt for replay - don't retry from replay
      priority: 10, // Higher priority for replayed events
      removeOnComplete: true,
      removeOnFail: false,
    });

    // Update DLQ entry to track replay
    dlq.replayCount++;
    dlq.maintainerNotes = reason
      ? `${dlq.maintainerNotes || ''}\nReplay: ${reason}`
      : dlq.maintainerNotes;
    dlq.updatedAt = new Date();
    await this.dlqRepo.save(dlq);

    this.logger.log(
      {
        dlqId,
        txHash: dlq.txHash,
        replayCount: dlq.replayCount,
        reason,
      },
      'Queued dead letter event for replay',
    );

    return {
      message: 'Event queued for replay',
      jobId,
      eventId: dlq.id,
      replayCount: dlq.replayCount,
    };
  }

  /**
   * Mark a dead letter event as resolved
   * Allows maintainers to acknowledge unfixable issues
   * Prevents further replay attempts
   *
   * @param dlqId - Dead letter queue entry ID
   * @param reason - Reason for resolution
   * @param resolvedBy - User/service resolving
   * @returns Resolution details
   */
  async resolveFailure(
    dlqId: string,
    reason: string,
    resolvedBy?: string,
  ): Promise<{
    message: string;
    eventId: string;
    status: DeadLetterStatus;
    resolvedAt: Date;
  }> {
    const dlq = await this.dlqRepo.findOneBy({ id: dlqId });

    if (!dlq) {
      throw new BadRequestException(
        `Dead letter queue entry not found: ${dlqId}`,
      );
    }

    dlq.status = DeadLetterStatus.RESOLVED;
    dlq.resolvedAt = new Date();
    dlq.resolvedBy = resolvedBy ?? null;
    dlq.maintainerNotes = reason;
    dlq.updatedAt = new Date();

    const saved = await this.dlqRepo.save(dlq);

    this.logger.log(
      {
        dlqId,
        txHash: dlq.txHash,
        reason,
        resolvedBy,
      },
      'Dead letter event marked as resolved',
    );

    return {
      message: 'Event marked as resolved',
      eventId: saved.id,
      status: saved.status,
      resolvedAt: saved.resolvedAt!,
    };
  }

  /**
   * Mark a successfully replayed event
   * Called by the processor when a replay succeeds
   * Updates DLQ status to prevent re-processing
   *
   * @param txHash - Transaction hash
   * @param eventIndex - Event index
   */
  async markReplayed(txHash: string, eventIndex: number): Promise<void> {
    const dlq = await this.dlqRepo.findOne({
      where: { txHash, eventIndex },
    });

    if (!dlq) {
      this.logger.debug(
        { txHash, eventIndex },
        'No DLQ entry found to mark as replayed',
      );
      return;
    }

    dlq.status = DeadLetterStatus.REPLAYED;
    dlq.lastReplayedAt = new Date();
    dlq.updatedAt = new Date();

    await this.dlqRepo.save(dlq);

    this.logger.log(
      { dlqId: dlq.id, txHash, eventIndex },
      'Dead letter event marked as successfully replayed',
    );
  }

  /**
   * Get statistics about the dead letter queue
   *
   * @returns DLQ statistics
   */
  async getStats(): Promise<DeadLetterStatsDto> {
    const [total, pending, replayed, resolved] = await Promise.all([
      this.dlqRepo.count(),
      this.dlqRepo.countBy({ status: DeadLetterStatus.PENDING }),
      this.dlqRepo.countBy({ status: DeadLetterStatus.REPLAYED }),
      this.dlqRepo.countBy({ status: DeadLetterStatus.RESOLVED }),
    ]);

    const mostCommonErrorRow = (await this.dlqRepo
      .createQueryBuilder('dlq')
      .select('dlq.lastErrorMessage', 'errorMessage')
      .addSelect('COUNT(*)', 'count')
      .groupBy('dlq.lastErrorMessage')
      .orderBy('count', 'DESC')
      .limit(1)
      .getRawOne()) as { errorMessage: string | null } | null;

    const oldestUnresolved = (await this.dlqRepo
      .createQueryBuilder('dlq')
      .where('dlq.status != :resolved', { resolved: DeadLetterStatus.RESOLVED })
      .orderBy('dlq.createdAt', 'ASC')
      .select('dlq.createdAt', 'createdAt')
      .getRawOne()) as { createdAt: Date | null } | null;

    return {
      total,
      pending,
      replayed,
      resolved,
      mostCommonError: mostCommonErrorRow?.errorMessage ?? null,
      oldestUnresolvedAt: oldestUnresolved?.createdAt ?? null,
    };
  }

  /**
   * Convert entity to DTO
   */
  private entityToDto(dlq: SorobanEventDeadLetter): DeadLetterEventDto {
    return {
      id: dlq.id,
      sorobanEventId: dlq.sorobanEventId,
      txHash: dlq.txHash,
      eventIndex: dlq.eventIndex,
      contractId: dlq.contractId,
      eventType: dlq.eventType,
      canonicalType: dlq.canonicalType,
      category: dlq.category,
      rawPayload: dlq.rawPayload,
      ledgerSequence: dlq.ledgerSequence,
      failureCount: dlq.failureCount,
      lastErrorMessage: dlq.lastErrorMessage,
      errorHistory: dlq.errorHistory || [],
      status: dlq.status,
      maintainerNotes: dlq.maintainerNotes,
      replayCount: dlq.replayCount,
      lastReplayedAt: dlq.lastReplayedAt,
      resolvedAt: dlq.resolvedAt,
      resolvedBy: dlq.resolvedBy,
      createdAt: dlq.createdAt,
      updatedAt: dlq.updatedAt,
    };
  }
}
