# Dead Letter Queue for Soroban Events

## Overview

The Dead Letter Queue (DLQ) system captures and manages failed chain event processing attempts, allowing maintainers to safely inspect, debug, and replay events without losing context.

### Key Features

- **Persistent Storage**: Failed events land in a dedicated dead-letter table for permanent record
- **Complete Audit Trail**: All error history, timestamps, and failure reasons preserved
- **Idempotent Replay**: Events can be safely replayed multiple times without side effects
- **Manual Intervention**: Maintainers can inspect failures, add notes, and mark as resolved
- **Safeguards**: Prevents infinite replay loops with attempt limits and status tracking

## Architecture

### Data Flow

```
Ingestion → Queue → Processor
                       ↓
                    Success → Event Status: PROCESSED
                       ↓
                    Failure → Retry (exponential backoff)
                       ↓
                    Exhausted Retries → Move to Dead Letter Queue
                       ↓
                    Dead Letter Entry
                       ↓
           [Inspect] → [Replay] → [Resolve] or [Mark Complete]
```

### Components

1. **SorobanEventDeadLetter Entity**: Database model for storing failed events
2. **SorobanEventsDeadLetterService**: Business logic for DLQ operations
3. **SorobanEventsDeadLetterController**: REST API for maintainers
4. **SorobanEventsProcessor**: Enhanced processor with DLQ integration

## Database Schema

### soroban_event_dead_letter Table

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID | Unique identifier |
| `soroban_event_id` | UUID | Link to original event record |
| `tx_hash` | VARCHAR | Transaction hash (idempotency key) |
| `event_index` | INTEGER | Event position in transaction |
| `contract_id` | VARCHAR | Smart contract address |
| `event_type` | VARCHAR | Event type/topic |
| `raw_payload` | JSONB | Full event payload |
| `failure_count` | INTEGER | Number of processing attempts |
| `last_error_message` | TEXT | Most recent error |
| `last_error_stack` | TEXT | Stack trace for debugging |
| `error_history` | JSONB | Array of all errors encountered |
| `status` | ENUM | `pending`, `replayed`, `resolved` |
| `maintainer_notes` | TEXT | Contextual notes from reviewer |
| `replay_count` | INTEGER | Number of replay attempts |
| `last_replayed_at` | TIMESTAMPTZ | Timestamp of last successful replay |
| `resolved_at` | TIMESTAMPTZ | When marked as resolved |
| `resolved_by` | VARCHAR | User/service that resolved |
| `created_at` | TIMESTAMPTZ | Entry creation timestamp |
| `updated_at` | TIMESTAMPTZ | Last update timestamp |

### Indexes

- `status` - Filter by pending/replayed/resolved
- `created_at` - Sort by age
- `tx_hash, event_index` - Unique constraint (idempotency)
- `soroban_event_id` - Link to original event
- `status, created_at` - Efficient filtering with sort
- `contract_id, event_type` - Filter by contract/type

## API Endpoints

All endpoints require authentication via `x-ingest-secret` header.

### List Dead Letter Events

```http
GET /soroban-events/dead-letter
```

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | number | 0 | Page number (zero-indexed) |
| `limit` | number | 20 | Results per page |
| `status` | enum | - | Filter: `pending`, `replayed`, `resolved` |
| `eventType` | string | - | Filter by event type |
| `contractId` | string | - | Filter by contract address |
| `sortBy` | string | `createdAt` | Sort field: `createdAt`, `failureCount`, `lastAttemptAt` |
| `sortOrder` | string | `DESC` | `ASC` or `DESC` |

**Example Request:**

```bash
curl -X GET \
  'http://localhost:3000/soroban-events/dead-letter?page=0&limit=20&status=pending&sortBy=createdAt&sortOrder=DESC' \
  -H 'x-ingest-secret: your-secret'
```

**Example Response:**

```json
{
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "sorobanEventId": "550e8400-e29b-41d4-a716-446655440001",
      "txHash": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
      "eventIndex": 0,
      "contractId": "CAF5YZ3XZWHMNQYZPJ4YVGJJTKP3N6DSZXQFUTW7QPEHQ3KBFQMJDP",
      "eventType": "transfer",
      "canonicalType": "token_transfer",
      "category": "financial",
      "failureCount": 3,
      "lastErrorMessage": "Contract reference not found on ledger",
      "status": "pending",
      "replayCount": 0,
      "createdAt": "2024-01-15T10:30:00Z",
      "updatedAt": "2024-01-15T10:35:00Z"
    }
  ],
  "page": 0,
  "limit": 20,
  "total": 42,
  "totalPages": 3
}
```

### Get Dead Letter Statistics

```http
GET /soroban-events/dead-letter/stats
```

**Example Response:**

```json
{
  "total": 42,
  "pending": 15,
  "replayed": 25,
  "resolved": 2,
  "mostCommonError": "Contract reference not found",
  "oldestUnresolvedAt": "2024-01-10T08:00:00Z"
}
```

### Inspect a Failed Event

```http
GET /soroban-events/dead-letter/:id
```

**Example Request:**

```bash
curl -X GET \
  'http://localhost:3000/soroban-events/dead-letter/550e8400-e29b-41d4-a716-446655440000' \
  -H 'x-ingest-secret: your-secret'
```

**Example Response:**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "sorobanEventId": "550e8400-e29b-41d4-a716-446655440001",
  "txHash": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
  "eventIndex": 0,
  "contractId": "CAF5YZ3XZWHMNQYZPJ4YVGJJTKP3N6DSZXQFUTW7QPEHQ3KBFQMJDP",
  "eventType": "transfer",
  "canonicalType": "token_transfer",
  "category": "financial",
  "rawPayload": {
    "from": "GBNCHUKZMTCSLOMNC7P4TS4VJJBTCYL3SDTDJNL5YVLQHJ2QGQUXQFKY",
    "to": "GCNPL4GN2EQKJ2OA5Y2K3YGSVQ2Z2GLRZ2EV4Q4VZ3GDNB5O6CQHWT",
    "amount": "1000000000"
  },
  "ledgerSequence": 47831234,
  "failureCount": 3,
  "lastErrorMessage": "Contract reference not found on ledger",
  "lastErrorStack": "Error: Contract not found\n    at processEvent (src/processor.ts:42:15)\n    at async Job.process",
  "errorHistory": [
    {
      "timestamp": "2024-01-15T10:30:00Z",
      "message": "Contract reference not found on ledger",
      "stack": "Error: Contract not found\n    at processEvent (src/processor.ts:42:15)"
    },
    {
      "timestamp": "2024-01-15T10:30:30Z",
      "message": "Contract reference not found on ledger",
      "stack": "Error: Contract not found\n    at processEvent (src/processor.ts:42:15)"
    },
    {
      "timestamp": "2024-01-15T10:31:00Z",
      "message": "Contract reference not found on ledger",
      "stack": "Error: Contract not found\n    at processEvent (src/processor.ts:42:15)"
    }
  ],
  "status": "pending",
  "maintainerNotes": null,
  "replayCount": 0,
  "lastReplayedAt": null,
  "resolvedAt": null,
  "resolvedBy": null,
  "createdAt": "2024-01-15T10:30:00Z",
  "updatedAt": "2024-01-15T10:31:00Z"
}
```

### Replay a Failed Event

```http
POST /soroban-events/dead-letter/:id/replay
```

**Request Body:**

```json
{
  "reason": "Contract deployed, ready for retry"
}
```

**Response (HTTP 202):**

```json
{
  "message": "Event queued for replay",
  "jobId": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6:0",
  "eventId": "550e8400-e29b-41d4-a716-446655440000",
  "replayCount": 1
}
```

**Idempotency Behavior:**

- Multiple calls to replay the same event won't cause duplicate re-processing
- If event was already successfully replayed, returns success without re-queuing
- Clients can safely retry replay requests

### Mark Event as Resolved

```http
PATCH /soroban-events/dead-letter/:id/resolve
```

**Request Body:**

```json
{
  "reason": "Acknowledged as unfixable - deprecated contract",
  "resolvedBy": "maintainer@example.com"
}
```

**Response:**

```json
{
  "message": "Event marked as resolved",
  "eventId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "resolved",
  "resolvedAt": "2024-01-15T12:00:00Z"
}
```

## Usage Workflows

### Workflow 1: Investigating Failed Events

**Scenario:** Event failed to process due to missing contract reference.

**Steps:**

1. Check DLQ statistics:
   ```bash
   curl 'http://localhost:3000/soroban-events/dead-letter/stats' \
     -H 'x-ingest-secret: your-secret'
   ```

2. List pending events:
   ```bash
   curl 'http://localhost:3000/soroban-events/dead-letter?status=pending&sortBy=failureCount&sortOrder=DESC' \
     -H 'x-ingest-secret: your-secret'
   ```

3. Inspect specific failure:
   ```bash
   curl 'http://localhost:3000/soroban-events/dead-letter/550e8400-e29b-41d4-a716-446655440000' \
     -H 'x-ingest-secret: your-secret'
   ```

4. Review error history and raw payload to understand root cause

### Workflow 2: Replaying Events After Fix

**Scenario:** Contract was deployed, now ready to replay events.

**Steps:**

1. Query DLQ for contract-specific failures:
   ```bash
   curl 'http://localhost:3000/soroban-events/dead-letter?contractId=CAF5YZ3XZWHMNQYZPJ4YVGJJTKP3N6DSZXQFUTW7QPEHQ3KBFQMJDP&status=pending' \
     -H 'x-ingest-secret: your-secret'
   ```

2. Replay event:
   ```bash
   curl -X POST 'http://localhost:3000/soroban-events/dead-letter/550e8400-e29b-41d4-a716-446655440000/replay' \
     -H 'x-ingest-secret: your-secret' \
     -H 'Content-Type: application/json' \
     -d '{"reason": "Contract deployed on mainnet"}'
   ```

3. Monitor job status via BullMQ dashboard or check event status

4. Verify successful processing:
   ```bash
   curl 'http://localhost:3000/soroban-events/dead-letter/550e8400-e29b-41d4-a716-446655440000' \
     -H 'x-ingest-secret: your-secret'
   # status should change to "replayed"
   ```

### Workflow 3: Resolving Unfixable Issues

**Scenario:** Deprecated contract that cannot be fixed.

**Steps:**

1. Inspect the event to confirm unfixability

2. Mark as resolved with explanation:
   ```bash
   curl -X PATCH 'http://localhost:3000/soroban-events/dead-letter/550e8400-e29b-41d4-a716-446655440000/resolve' \
     -H 'x-ingest-secret: your-secret' \
     -H 'Content-Type: application/json' \
     -d '{
       "reason": "Contract deprecated - no longer supported by protocol",
       "resolvedBy": "maintainer@example.com"
     }'
   ```

3. Event is marked as resolved and won't appear in pending lists

## Idempotency Guarantees

The DLQ system ensures safe, idempotent operations:

### Replay Idempotency

```
Scenario: Maintainer clicks replay button twice

First click:
  1. Check if event in replayed state → No
  2. Queue event for processing
  3. Increment replay counter (now 1)
  4. Return success

Second click:
  1. Check if event in replayed state → Yes
  2. Return success WITHOUT re-queuing
  3. Replay counter stays at 1

Result: Event processed once, no duplicates
```

### DLQ Entry Idempotency

```
Scenario: Same event fails processing twice

First failure:
  1. Check if DLQ entry exists → No
  2. Create new entry
  3. Set failure_count = 1
  4. Add error to error_history

Second failure:
  1. Check if DLQ entry exists → Yes
  2. Update existing entry
  3. Increment failure_count (now 2)
  4. Append new error to error_history

Result: Single DLQ record with complete failure history
```

## Safeguards Against Issues

### Replay Attempt Limit

- Maximum 5 replay attempts per event
- Prevents infinite retry loops
- Maintains attempt count in `replay_count` column

### Single Attempt Replays

- Replayed events get only 1 attempt (no exponential backoff)
- Prevents cascading retries from stale job config
- If replay fails, event returns to pending and can be retried

### Status Tracking

- Prevents processing same event multiple times
- `REPLAYED` status indicates successful replay
- `RESOLVED` status indicates acknowledged/handled
- `PENDING` status requires investigation or replay

## Monitoring and Alerting

### Key Metrics to Monitor

```sql
-- Oldest pending event
SELECT created_at, tx_hash, last_error_message
FROM soroban_event_dead_letter
WHERE status = 'pending'
ORDER BY created_at ASC
LIMIT 1;

-- Most common errors
SELECT last_error_message, COUNT(*) as count
FROM soroban_event_dead_letter
WHERE status = 'pending'
GROUP BY last_error_message
ORDER BY count DESC;

-- Events not replayed after 24 hours
SELECT id, tx_hash, created_at
FROM soroban_event_dead_letter
WHERE status = 'pending'
  AND created_at < NOW() - INTERVAL '24 hours'
  AND replay_count = 0;
```

### Recommended Alerts

- Alert when `pending` count exceeds threshold
- Alert when oldest `pending` event is older than 48 hours
- Alert when same error appears more than N times

## Performance Considerations

### Indexes

All key query patterns have indexes:
- Filtering by status
- Sorting by date or failure count
- Joining to original event
- Finding contract-specific failures

### Query Performance

- Typical queries on large tables: < 100ms
- Pagination ensures memory efficiency
- JSONB `error_history` allows full-text search if needed

### Storage

- Minimal overhead: ~2KB per DLQ entry (without large payloads)
- 10,000 failed events = ~20MB additional storage
- Regular cleanup of resolved entries recommended

## Best Practices

### For Maintainers

1. **Review Regularly**: Check DLQ stats daily during development
2. **Add Context**: Use `maintainerNotes` to document investigation
3. **Batch Replays**: Group related events and replay together
4. **Resolve Explicitly**: Mark events as resolved when not replaying
5. **Monitor Patterns**: Look for systematic issues (same error N times)

### For Developers

1. **Meaningful Errors**: Include context in error messages
2. **Stack Traces**: Ensure stack traces are captured
3. **Payload Size**: Keep payloads reasonable for storage
4. **Error Recovery**: Design handlers that can retry safely

### For Operations

1. **Database Maintenance**: Periodically purge old resolved entries
2. **Alerting**: Set up alerts for high DLQ growth
3. **Monitoring**: Track replay success rates
4. **Documentation**: Maintain runbook for common DLQ issues

## Testing

### Unit Tests

```typescript
describe('SorobanEventsDeadLetterService', () => {
  it('should move failed event to DLQ', async () => {
    const event = /* ... */;
    const error = new Error('Test error');
    
    const result = await dlqService.moveToDeadLetter(event, error);
    
    expect(result.txHash).toBe(event.txHash);
    expect(result.failureCount).toBe(1);
    expect(result.lastErrorMessage).toBe('Test error');
  });

  it('should prevent excessive replay attempts', async () => {
    const dlq = /* max replays reached */;
    
    expect(() => dlqService.replayEvent(dlq.id))
      .rejects.toThrow('exceeded maximum replay attempts');
  });

  it('should be idempotent on replay', async () => {
    const dlq = /* replayed status */;
    
    const result1 = await dlqService.replayEvent(dlq.id);
    const result2 = await dlqService.replayEvent(dlq.id);
    
    expect(result1).toEqual(result2); // Same response
    expect(dlq.replayCount).toBe(1); // Not incremented twice
  });
});
```

### Integration Tests

```typescript
it('should capture failed event in DLQ and allow replay', async () => {
  // 1. Queue event that will fail
  await eventsService.ingest({
    txHash: 'test-hash',
    eventIndex: 0,
    contractId: 'invalid-contract',
    rawPayload: {},
  });

  // 2. Wait for processing to exhaust retries
  await waitForJobCompletion();

  // 3. Verify in DLQ
  const dlqEvents = await dlqService.listFailedEvents({ status: 'pending' });
  expect(dlqEvents.data).toHaveLength(1);
  expect(dlqEvents.data[0].txHash).toBe('test-hash');

  // 4. Fix the issue and replay
  await dlqService.replayEvent(dlqEvents.data[0].id, 'Contract fixed');

  // 5. Verify success on replay
  await waitForJobCompletion();
  const updated = await dlqService.inspectFailure(dlqEvents.data[0].id);
  expect(updated.status).toBe('replayed');
});
```

## Migration Guide

### From Previous System

If you had a previous error handling system:

1. **Export old failed events** (if needed):
   ```sql
   INSERT INTO soroban_event_dead_letter (
     tx_hash, event_index, contract_id, event_type, raw_payload,
     failure_count, last_error_message, status, created_at, updated_at
   )
   SELECT tx_hash, event_index, contract_id, event_type, raw_payload,
          1, error_message, 'pending', created_at, created_at
   FROM old_failed_events;
   ```

2. **Run migration** to create tables:
   ```bash
   npm run typeorm migration:run
   ```

3. **Verify deployment**:
   ```bash
   curl 'http://localhost:3000/soroban-events/dead-letter/stats' \
     -H 'x-ingest-secret: your-secret'
   ```

## Troubleshooting

### Common Issues

**Q: Event not appearing in DLQ?**
- Verify processor is running: Check BullMQ queue status
- Confirm event is failing: Check `soroban_events` table for FAILED status
- Check logs for DLQ service errors

**Q: Replay not working?**
- Verify underlying issue is fixed before replaying
- Check replay count hasn't exceeded max (5)
- Confirm event can be reprocessed (no unique constraint violations)

**Q: Performance degradation?**
- Check index health: `ANALYZE soroban_event_dead_letter;`
- Purge old resolved entries regularly
- Monitor query times on large tables

## References

- [BullMQ Documentation](https://docs.bullmq.io/)
- [TypeORM Documentation](https://typeorm.io/)
- [NestJS Guard Patterns](https://docs.nestjs.com/guards)
- [Soroban Documentation](https://soroban.stellar.org/)
