import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, LessThan, Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OutboxEvent, OutboxEventStatus } from './outbox-event.entity';

/** Maximum dispatch attempts before an event is permanently marked failed */
const MAX_ATTEMPTS = 5;

/** How many pending events to process per poll cycle */
const BATCH_SIZE = 50;

export type OutboxEventHandler = (
  eventType: string,
  payload: Record<string, unknown>,
) => Promise<void>;

@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);
  private readonly handlers: OutboxEventHandler[] = [];

  constructor(
    @InjectRepository(OutboxEvent)
    private readonly outboxRepo: Repository<OutboxEvent>,
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
    });

    return repo.save(event);
  }

  /**
   * Poll for pending events and dispatch them to all registered handlers.
   * Runs every 5 seconds. Events exceeding MAX_ATTEMPTS are marked failed.
   */
  @Cron(CronExpression.EVERY_5_SECONDS)
  async pollAndDispatch(): Promise<void> {
    const events = await this.outboxRepo.find({
      where: {
        status: OutboxEventStatus.PENDING,
        attempts: LessThan(MAX_ATTEMPTS),
      },
      order: { createdAt: 'ASC' },
      take: BATCH_SIZE,
    });

    if (events.length === 0) return;

    for (const event of events) {
      await this.dispatch(event);
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
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Outbox dispatch failed for event ${event.id} (${event.eventType}), attempt ${event.attempts}: ${message}`,
      );

      event.lastError = message;

      if (event.attempts >= MAX_ATTEMPTS) {
        event.status = OutboxEventStatus.FAILED;
        this.logger.error(
          `Outbox event ${event.id} (${event.eventType}) permanently failed after ${event.attempts} attempts.`,
        );
      }
    }

    await this.outboxRepo.save(event);
  }
}
