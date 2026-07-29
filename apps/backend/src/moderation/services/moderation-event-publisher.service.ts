import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import {
  ModerationDecisionEvent,
  ModerationDecisionPayload,
  ModerationEventType,
} from '../types/moderation-events.types';
import { ContentReport } from '../entities/content-report.entity';

/**
 * Service responsible for publishing moderation decision events to the event queue.
 * Enforces privacy by excluding reviewer-only fields from public event payloads.
 */
@Injectable()
export class ModerationEventPublisherService {
  private readonly logger = new Logger(ModerationEventPublisherService.name);

  constructor(
    @InjectQueue('moderation-events')
    private readonly moderationEventsQueue: Queue,
  ) {}

  /**
   * Publish a moderation decision event to the queue.
   * Fire-and-forget with error logging — event emission failure does not block state changes.
   *
   * @param eventType - Type of moderation event
   * @param report - Current report state after the state change
   * @param previousStatus - Status before the change (null for initial creation)
   */
  async publishModerationEvent(
    eventType: ModerationEventType,
    report: ContentReport,
    previousStatus: ContentReport['status'] | null,
  ): Promise<void> {
    try {
      const event = this.buildEvent(eventType, report, previousStatus);

      // Add to queue with automatic retry (BullMQ handles at-least-once delivery)
      await this.moderationEventsQueue.add('moderation-decision', event, {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: 1000, // Keep last 1000 completed jobs for debugging
        removeOnFail: 5000,     // Keep last 5000 failed jobs for analysis
      });

      this.logger.log(
        `Event published: ${eventType} for report ${report.id} (eventId: ${event.eventId})`,
      );
    } catch (error) {
      // Log error without leaking sensitive data — only log event metadata
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;
      
      this.logger.error(
        `Failed to publish event ${eventType} for report ${report.id}: ${errorMessage}`,
        errorStack,
      );
      // Do NOT rethrow — event emission must not block the state change
    }
  }

  /**
   * Build a complete event from a report.
   * Enforces privacy by using toPublicPayload allowlist function.
   */
  private buildEvent(
    eventType: ModerationEventType,
    report: ContentReport,
    previousStatus: ContentReport['status'] | null,
  ): ModerationDecisionEvent {
    return {
      eventType,
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      schemaVersion: '1',
      payload: this.toPublicPayload(report, previousStatus),
    };
  }

  /**
   * Privacy-enforcing allowlist function.
   * Constructs the public payload from an internal ContentReport.
   * This is the single gatekeeper — no other code path may add fields to event payloads.
   *
   * EXPLICITLY EXCLUDED FIELDS (reviewer-only):
   * - reviewerId: identifies the moderator
   * - reviewNotes: internal moderator notes
   * - reporter: User relation
   * - reviewer: User relation
   * - reporterId: identifies the reporter (privacy)
   * - description: reporter's description (privacy)
   * - resolvedAt: internal timestamp
   * - createdAt: internal timestamp
   * - updatedAt: internal timestamp
   */
  private toPublicPayload(
    report: ContentReport,
    previousStatus: ContentReport['status'] | null,
  ): ModerationDecisionPayload {
    return {
      reportId: report.id,
      targetType: report.targetType,
      targetId: report.targetId,
      previousStatus,
      newStatus: report.status,
      reason: report.reason,
    };
  }
}
