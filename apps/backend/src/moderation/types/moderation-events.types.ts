import { ReportReason, ReportStatus, ReportType } from '../entities/content-report.entity';

/**
 * Moderation event types representing state transitions
 */
export type ModerationEventType =
  | 'moderation.pending'
  | 'moderation.under_review'
  | 'moderation.resolved'
  | 'moderation.dismissed';

/**
 * Public payload for moderation decision events.
 * Privacy-enforced: excludes reviewerId, reviewerNotes, reporterId, description, and User relations.
 */
export interface ModerationDecisionPayload {
  /** Report identifier */
  reportId: string;

  /** Type of content being moderated */
  targetType: ReportType;

  /** ID of the target content */
  targetId: string;

  /** Previous moderation status (null if initial creation) */
  previousStatus: ReportStatus | null;

  /** New moderation status */
  newStatus: ReportStatus;

  /** Public-facing reason for the report */
  reason: ReportReason;
}

/**
 * Complete moderation decision event structure.
 * Designed for consumption by downstream services and dashboards.
 */
export interface ModerationDecisionEvent {
  /** Event type identifier */
  eventType: ModerationEventType;

  /** Unique event identifier (UUID v4) for idempotency and deduplication */
  eventId: string;

  /** ISO 8601 UTC timestamp when the event occurred */
  occurredAt: string;

  /** Schema version for forward compatibility */
  schemaVersion: '1';

  /** Public event payload */
  payload: ModerationDecisionPayload;
}
