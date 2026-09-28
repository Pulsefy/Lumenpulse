# Moderation Decision Event Stream

This document describes the moderation decision event stream for downstream consumers.

## Overview

The LumenPulse backend publishes structured events to a BullMQ queue whenever a moderation decision state changes. Downstream services and dashboards can subscribe to this queue to react to moderation decisions without polling the API.

## Event Schema

All moderation events conform to the `ModerationDecisionEvent` schema:

```typescript
interface ModerationDecisionEvent {
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

interface ModerationDecisionPayload {
  /** Report identifier */
  reportId: string;

  /** Type of content being moderated */
  targetType: 'project' | 'comment' | 'user' | 'other';

  /** ID of the target content */
  targetId: string;

  /** Previous moderation status (null if initial creation) */
  previousStatus: ReportStatus | null;

  /** New moderation status */
  newStatus: 'pending' | 'under_review' | 'resolved' | 'dismissed';

  /** Public-facing reason for the report */
  reason: 'spam' | 'inappropriate_content' | 'fraud' | 'misleading_info' | 'copyright_violation' | 'other';
}
```

## Event Types

The following event types are emitted on moderation state transitions:

| Event Type | Trigger | Description |
|------------|---------|-------------|
| `moderation.pending` | New report created | A user has submitted a new content report |
| `moderation.under_review` | Status changed to `under_review` | A moderator is actively reviewing the report |
| `moderation.resolved` | Status changed to `resolved` | The report was resolved (action taken) |
| `moderation.dismissed` | Status changed to `dismissed` | The report was dismissed (no action needed) |

## Privacy Guarantees

Moderation events expose only public information. The following fields are **explicitly excluded** from event payloads:

- `reviewerId` — identifies the moderator
- `reviewNotes` — internal moderator notes
- `reporter` — User relation object
- `reviewer` — User relation object  
- `reporterId` — identifies the reporter (privacy)
- `description` — reporter's description (privacy)
- `resolvedAt` — internal timestamp
- `createdAt` — internal timestamp
- `updatedAt` — internal timestamp

This exclusion is enforced by a privacy allowlist function (`toPublicPayload`) that is the single gatekeeper for event payload construction.

## Delivery Path

Events are published to a **BullMQ queue** named `moderation-events` backed by Redis.

### Queue Configuration

The queue uses the existing Redis connection configured via environment variables:

```bash
REDIS_HOST=localhost
REDIS_PORT=6379
```

No additional configuration is required.

### Connecting as a Consumer

Consumers can subscribe to the `moderation-events` queue using BullMQ's `Worker` API:

```typescript
import { Worker } from 'bullmq';

const worker = new Worker(
  'moderation-events',
  async (job) => {
    const event: ModerationDecisionEvent = job.data;
    
    // Process the event
    console.log(`Received ${event.eventType} for report ${event.payload.reportId}`);
    
    // Extract public fields
    const { reportId, targetType, targetId, newStatus, reason } = event.payload;
    
    // Your business logic here
    await updateDashboard(reportId, newStatus);
  },
  {
    connection: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
    },
  },
);

worker.on('completed', (job) => {
  console.log(`Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
  console.error(`Job ${job?.id} failed:`, err);
});
```

### Consumer Example: Dashboard Update Service

```typescript
import { Worker } from 'bullmq';
import { ModerationDecisionEvent } from './types';

class ModerationDashboardService {
  private worker: Worker;

  constructor() {
    this.worker = new Worker(
      'moderation-events',
      this.processEvent.bind(this),
      {
        connection: {
          host: process.env.REDIS_HOST,
          port: parseInt(process.env.REDIS_PORT, 10),
        },
      },
    );
  }

  private async processEvent(job: any): Promise<void> {
    const event: ModerationDecisionEvent = job.data;

    // Deduplicate using eventId
    const alreadyProcessed = await this.checkIfProcessed(event.eventId);
    if (alreadyProcessed) {
      console.log(`Event ${event.eventId} already processed, skipping`);
      return;
    }

    // Extract payload
    const { reportId, targetType, targetId, newStatus, previousStatus } = event.payload;

    // Update dashboard metrics
    switch (event.eventType) {
      case 'moderation.pending':
        await this.incrementPendingCount();
        break;
      case 'moderation.under_review':
        await this.moveToDashboard('under_review', reportId);
        break;
      case 'moderation.resolved':
        await this.markAsResolved(reportId, targetType, targetId);
        break;
      case 'moderation.dismissed':
        await this.markAsDismissed(reportId);
        break;
    }

    // Record that we processed this event
    await this.markAsProcessed(event.eventId);
  }

  private async checkIfProcessed(eventId: string): Promise<boolean> {
    // Check your database or cache
    return false;
  }

  private async markAsProcessed(eventId: string): Promise<void> {
    // Store eventId to prevent duplicate processing
  }

  private async incrementPendingCount(): Promise<void> {
    // Update dashboard metrics
  }

  private async moveToDashboard(status: string, reportId: string): Promise<void> {
    // Update dashboard UI
  }

  private async markAsResolved(reportId: string, targetType: string, targetId: string): Promise<void> {
    // Trigger resolved workflow
  }

  private async markAsDismissed(reportId: string): Promise<void> {
    // Trigger dismissed workflow
  }
}
```

## Reliability

### Delivery Guarantee

The moderation event stream provides **at-least-once delivery**:

- Events are persisted in Redis until acknowledged by consumers
- BullMQ automatically retries failed jobs (3 attempts with exponential backoff)
- Consumers must implement idempotency using the `eventId` field

### Handling Duplicates

Because the system provides at-least-once delivery, consumers must handle duplicate events. Use the `eventId` field (a UUID v4) to deduplicate:

```typescript
async function processEvent(event: ModerationDecisionEvent) {
  // Check if already processed
  const exists = await redis.get(`processed:${event.eventId}`);
  if (exists) {
    console.log(`Event ${event.eventId} already processed`);
    return;
  }

  // Process the event
  await handleModerationEvent(event);

  // Mark as processed
  await redis.set(`processed:${event.eventId}`, '1', 'EX', 86400); // 24h TTL
}
```

### State Change Independence

Event emission is **fire-and-forget**:

- Moderation state changes complete successfully even if event publication fails
- Event failures are logged but do not block the primary state transition
- This ensures moderation workflow reliability

## Schema Versioning

The `schemaVersion` field enables forward compatibility. Consumers should check this field to handle breaking changes:

```typescript
async function processEvent(event: ModerationDecisionEvent) {
  switch (event.schemaVersion) {
    case '1':
      await processV1Event(event);
      break;
    default:
      console.warn(`Unknown schema version: ${event.schemaVersion}`);
  }
}
```

Currently, all events use `schemaVersion: '1'`.

## Configuration

No additional environment variables are required beyond the existing Redis configuration:

```bash
# Required (already configured)
REDIS_HOST=localhost
REDIS_PORT=6379
```

## Monitoring

BullMQ provides built-in job monitoring. To view queue metrics:

```typescript
import { Queue } from 'bullmq';

const queue = new Queue('moderation-events', {
  connection: {
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT, 10),
  },
});

// Get queue metrics
const jobCounts = await queue.getJobCounts();
console.log(jobCounts);
// { waiting: 0, active: 1, completed: 42, failed: 3, delayed: 0 }

// Get failed jobs for debugging
const failed = await queue.getFailed();
console.log(failed);
```

## Testing

The integration test suite demonstrates full event flow:

```bash
cd apps/backend
npm run test -- moderation-events.spec.ts
```

Key test cases:
- Event emission after state change
- Privacy enforcement (no reviewer data in payload)
- State change independence (emission failure doesn't block)
- Consumer can process event correctly

## FAQ

### What happens if Redis is unavailable?

Event publication will fail, but the moderation state change will complete successfully. The failure is logged but does not block the operation.

### How do I replay events?

BullMQ retains completed jobs in Redis (last 1000 by default). You can query and re-enqueue them if needed.

### Can I filter events by target type?

Yes. Consumers can filter based on `event.payload.targetType`:

```typescript
if (event.payload.targetType === 'project') {
  // Handle project moderation events only
}
```

### How do I get notified when a specific report is moderated?

Subscribe to the queue and filter by `event.payload.reportId` or `event.payload.targetId`.

## Related Documentation

- [Moderation API](../apps/backend/README.md#moderation-api)
- [BullMQ Documentation](https://docs.bullmq.io/)
- [Event-Driven Architecture](./ARCHITECTURE.md)
