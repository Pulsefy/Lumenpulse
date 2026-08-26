import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, LessThan, Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OutboxEvent, OutboxEventStatus } from './outbox-event.entity';
import { JobLockService } from '../scheduler/job-lock.service';
import { MetricsService } from '../metrics/metrics.service';
import { config } from '../lib/config';

/** How many pending events to process per poll cycle */
const BATCH_SIZE = 50;

const OUTBOX_LOCK = 'outbox-poll';

export type OutboxEventHandler = (
  eventType: string,
  payload: Record<string, unknown>,
) => Promise<void>;

export interface PaginatedOutboxEvents {
  data: OutboxEvent[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);
  private readonly handlers: OutboxEventHandler[] = [];

  constructor(
    @InjectRepository(OutboxEvent)
    private readonly outboxRepo: Repository<OutboxEvent>,
    private readonly jobLock: JobLockService,
    private readonly metricsService: MetricsService,
  ) {}

  /**
   * Register a handler that will be called for every dispatched outbox event.
   * Typically called from other modules during bootstrap.
   */
  registerHandler(handler: OutboxEventHandler): void {
    this.handlers.push(handler);
  }

  /**
   * Persist a domain event inside an existing transaction so the write is
   * atomic with the business operation that produced it.
   *
   * Usage (inside a TypeORM transaction):
   *   await manager.transaction(async (em) => {
   *     await doBusinessLogic(em);
   *     await outboxService.publish('user.registered', { userId }, em);
   *   });
   */
  async publish(
    eventType: string,
    payload: Record<string, unknown>,
    manager?: EntityManager,
  ): Promise<OutboxEvent> {
    const repo = manager ? manager.getRepository(OutboxEvent) : this.outboxRepo;

    const event = repo.create({
      eventType,
      payload,
      status: OutboxEventStatus.PENDING,
      attempts: 0,
      lastError: null,
      processedAt: null,
      deadLetterAt: null,
    });

    return repo.save(event);
  }

  /**
   * Poll for pending events and dispatch them to all registered handlers.
   * Runs every 5 seconds. Events exceeding the configured attempt limit are
   * moved to the dead-letter queue so they stop blocking the relay.
   * Advisory lock prevents two instances from processing the same batch.
   */
  @Cron(CronExpression.EVERY_5_SECONDS)
  async pollAndDispatch(): Promise<void> {
    const acquired = await this.jobLock.tryAcquire(OUTBOX_LOCK);
    if (!acquired) return; // another instance is already polling

    try {
      const events = await this.outboxRepo.find({
        where: {
          status: OutboxEventStatus.PENDING,
          attempts: LessThan(config.outbox.maxAttempts),
        },
        order: { createdAt: 'ASC' },
        take: BATCH_SIZE,
      });

      if (events.length === 0) {
        this.metricsService.setOutboxRelayLagSeconds(0);
        await this.refreshDeadLetterVolume();
        return;
      }

      // Relay lag = age of the oldest event still waiting to be dispatched.
      const oldest = events[0];
      const oldestCreatedAt = oldest.createdAt?.getTime();
      const lagSeconds = oldestCreatedAt
        ? (Date.now() - oldestCreatedAt) / 1000
        : 0;
      this.metricsService.setOutboxRelayLagSeconds(lagSeconds);

      for (const event of events) {
        await this.dispatch(event);
      }

      await this.refreshDeadLetterVolume();
    } finally {
      await this.jobLock.release(OUTBOX_LOCK);
    }
  }

  private async dispatch(event: OutboxEvent): Promise<void> {
    event.attempts += 1;

    try {
      await Promise.all(
        this.handlers.map((h) => h(event.eventType, event.payload)),
      );

      event.status = OutboxEventStatus.PROCESSED;
      event.processedAt = new Date();
      event.lastError = null;
      this.metricsService.recordOutboxAttempt('processed');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Outbox dispatch failed for event ${event.id} (${event.eventType}), attempt ${event.attempts}: ${message}`,
      );

      event.lastError = message;

      if (event.attempts >= config.outbox.maxAttempts) {
        event.status = OutboxEventStatus.DEAD_LETTER;
        event.deadLetterAt = new Date();
        this.metricsService.recordOutboxAttempt('dead_letter');
        this.logger.error(
          `Outbox event ${event.id} (${event.eventType}) moved to dead-letter after ${event.attempts} attempts.`,
        );
      } else {
        this.metricsService.recordOutboxAttempt('failed');
      }
    }

    await this.outboxRepo.save(event);
  }

  /**
   * List dead-lettered outbox events (poison messages) with pagination.
   */
  async listDeadLetters(page = 0, limit = 20): Promise<PaginatedOutboxEvents> {
    const [data, total] = await this.outboxRepo.findAndCount({
      where: { status: OutboxEventStatus.DEAD_LETTER },
      order: { createdAt: 'DESC' },
      skip: page * limit,
      take: limit,
    });

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Inspect a single dead-lettered outbox event.
   */
  async inspectDeadLetter(id: string): Promise<OutboxEvent> {
    const event = await this.outboxRepo.findOneBy({ id });
    if (!event || event.status !== OutboxEventStatus.DEAD_LETTER) {
      throw new NotFoundException(`Dead-letter outbox event not found: ${id}`);
    }
    return event;
  }

  /**
   * Replay a dead-lettered outbox event. Resets the attempt counter and
   * dispatches it immediately; a failure that exhausts the attempt limit
   * moves the event back to the dead-letter queue.
   */
  async replayDeadLetter(id: string): Promise<OutboxEvent> {
    const event = await this.outboxRepo.findOneBy({ id });
    if (!event) {
      throw new NotFoundException(`Outbox event not found: ${id}`);
    }
    if (event.status !== OutboxEventStatus.DEAD_LETTER) {
      throw new BadRequestException(
        `Outbox event ${id} is not in the dead-letter queue`,
      );
    }

    event.status = OutboxEventStatus.PENDING;
    event.attempts = 0;
    event.lastError = null;
    event.deadLetterAt = null;
    event.processedAt = null;

    await this.outboxRepo.save(event);
    this.logger.log(
      `Replaying dead-lettered outbox event ${event.id} (${event.eventType})`,
    );

    await this.dispatch(event);
    return event;
  }

  /** Keep the dead-letter volume gauge up to date. */
  private async refreshDeadLetterVolume(): Promise<void> {
    const volume = await this.outboxRepo.countBy({
      status: OutboxEventStatus.DEAD_LETTER,
    });
    this.metricsService.setOutboxDeadLetterVolume(volume);
  }
}
