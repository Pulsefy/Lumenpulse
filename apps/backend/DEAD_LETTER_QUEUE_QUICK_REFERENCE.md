# Dead Letter Queue - Quick Reference Card

## Overview

The Dead Letter Queue captures failed Soroban chain events for manual inspection and replay.

## Key Concepts

| Concept | Definition |
|---------|-----------|
| **Dead Letter Queue** | Permanent storage for events that failed processing after all retries |
| **Idempotent** | Safe to call multiple times without duplicate side effects |
| **Replay** | Requeue failed event for processing again |
| **Status** | Event state: `pending`, `replayed`, or `resolved` |

## API Quick Reference

### Check Status (Health Check)
```bash
curl 'http://localhost:3000/soroban-events/dead-letter/stats' \
  -H 'x-ingest-secret: YOUR_SECRET'
```

### List Pending Events
```bash
curl 'http://localhost:3000/soroban-events/dead-letter?status=pending' \
  -H 'x-ingest-secret: YOUR_SECRET'
```

### Filter by Contract
```bash
curl 'http://localhost:3000/soroban-events/dead-letter?contractId=ABC123' \
  -H 'x-ingest-secret: YOUR_SECRET'
```

### Inspect Event Details
```bash
curl 'http://localhost:3000/soroban-events/dead-letter/EVENT_ID' \
  -H 'x-ingest-secret: YOUR_SECRET'
```

### Replay Event
```bash
curl -X POST 'http://localhost:3000/soroban-events/dead-letter/EVENT_ID/replay' \
  -H 'x-ingest-secret: YOUR_SECRET' \
  -H 'Content-Type: application/json' \
  -d '{"reason": "Your reason here"}'
```

### Resolve Event (Mark as Handled)
```bash
curl -X PATCH 'http://localhost:3000/soroban-events/dead-letter/EVENT_ID/resolve' \
  -H 'x-ingest-secret: YOUR_SECRET' \
  -H 'Content-Type: application/json' \
  -d '{
    "reason": "Why not replaying",
    "resolvedBy": "your.name@example.com"
  }'
```

## Query Parameters

### List Endpoint Parameters
| Parameter | Example | Default |
|-----------|---------|---------|
| `page` | `0` | `0` |
| `limit` | `20` | `20` |
| `status` | `pending` | (none) |
| `eventType` | `transfer` | (none) |
| `contractId` | `CAF5YZ...` | (none) |
| `sortBy` | `createdAt` | `createdAt` |
| `sortOrder` | `DESC` | `DESC` |

**Example:** Get first 10 pending events, sorted by most recent:
```bash
curl 'http://localhost:3000/soroban-events/dead-letter?page=0&limit=10&status=pending&sortOrder=DESC' \
  -H 'x-ingest-secret: YOUR_SECRET'
```

## Response Fields

### Event Object
```json
{
  "id": "uuid",
  "txHash": "transaction hash",
  "eventIndex": 0,
  "status": "pending|replayed|resolved",
  "failureCount": 3,
  "lastErrorMessage": "error description",
  "errorHistory": [
    {
      "timestamp": "2024-01-15T10:00:00Z",
      "message": "error message",
      "stack": "stack trace"
    }
  ],
  "replayCount": 1,
  "maintainerNotes": "context from reviewer",
  "createdAt": "2024-01-15T10:00:00Z",
  "updatedAt": "2024-01-15T10:00:00Z"
}
```

## Status Meanings

| Status | Meaning | Action |
|--------|---------|--------|
| `pending` | Awaiting investigation or replay | Inspect → Replay or Resolve |
| `replayed` | Successfully replayed | No action needed |
| `resolved` | Acknowledged/handled | Closed (no replay) |

## Common Workflows

### Workflow 1: Quick Triage (5 min)
```bash
# 1. Check what failed
curl 'http://localhost:3000/soroban-events/dead-letter/stats' -H 'x-ingest-secret: SECRET'

# 2. Look at pending
curl 'http://localhost:3000/soroban-events/dead-letter?status=pending&limit=5' \
  -H 'x-ingest-secret: SECRET'

# 3. Inspect error details
curl 'http://localhost:3000/soroban-events/dead-letter/ID' -H 'x-ingest-secret: SECRET'
```

### Workflow 2: Replay (10 min)
```bash
# 1. Fix the issue (deploy fix, add contract, etc.)

# 2. Find failing events
curl 'http://localhost:3000/soroban-events/dead-letter?contractId=ABC&status=pending' \
  -H 'x-ingest-secret: SECRET' | jq '.data[].id'

# 3. Replay each event
curl -X POST 'http://localhost:3000/soroban-events/dead-letter/ID/replay' \
  -H 'x-ingest-secret: SECRET' -H 'Content-Type: application/json' \
  -d '{"reason": "Contract deployed"}'

# 4. Monitor - check status changed to "replayed"
curl 'http://localhost:3000/soroban-events/dead-letter/ID' -H 'x-ingest-secret: SECRET'
```

### Workflow 3: Acknowledge Unfixable (5 min)
```bash
# 1. Inspect event and confirm unfixable

# 2. Mark as resolved
curl -X PATCH 'http://localhost:3000/soroban-events/dead-letter/ID/resolve' \
  -H 'x-ingest-secret: SECRET' -H 'Content-Type: application/json' \
  -d '{
    "reason": "Contract deprecated - no longer supported",
    "resolvedBy": "you@example.com"
  }'

# 3. Verify status changed to "resolved"
curl 'http://localhost:3000/soroban-events/dead-letter?status=resolved' \
  -H 'x-ingest-secret: SECRET'
```

## Useful SQL Queries

### How many pending events?
```sql
SELECT COUNT(*) FROM soroban_event_dead_letter WHERE status = 'pending';
```

### Most common errors?
```sql
SELECT last_error_message, COUNT(*) as count FROM soroban_event_dead_letter
WHERE status = 'pending' GROUP BY last_error_message ORDER BY count DESC LIMIT 5;
```

### Oldest pending event?
```sql
SELECT id, tx_hash, created_at FROM soroban_event_dead_letter
WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1;
```

### Events from specific contract?
```sql
SELECT id, tx_hash, last_error_message FROM soroban_event_dead_letter
WHERE contract_id = 'CAF5YZ...' ORDER BY created_at DESC LIMIT 10;
```

### Never replayed?
```sql
SELECT COUNT(*) FROM soroban_event_dead_letter
WHERE status = 'pending' AND replay_count = 0;
```

## Environment Variables

### Required
```bash
SOROBAN_INGEST_SECRET=your-secret-key  # Auth header value
```

### Database (uses existing)
```bash
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=password
DB_NAME=lumenpulse
```

## Troubleshooting

### "Event not found"
- Verify event ID from list endpoint
- Check status is correct (not yet moved to DLQ)

### "Exceeded maximum replay attempts"
- Event has been replayed 5 times
- Likely unfixable issue, consider resolving instead

### "Unauthorized"
- Check `x-ingest-secret` header value
- Verify `SOROBAN_INGEST_SECRET` env var is set

### "Event already successfully replayed"
- Idempotent response - event already in `replayed` status
- Safe to retry, won't reprocess

### Replay didn't process
- Check event status (should still be processing or replayed)
- Verify backend is running
- Check logs for processing errors

## Performance Tips

### For Large Result Sets
```bash
# Instead of:
curl 'http://localhost:3000/soroban-events/dead-letter?limit=1000'

# Do pagination:
curl 'http://localhost:3000/soroban-events/dead-letter?page=0&limit=20'
curl 'http://localhost:3000/soroban-events/dead-letter?page=1&limit=20'
```

### For Filtering Many Events
```bash
# Instead of getting all and filtering in memory:
curl 'http://localhost:3000/soroban-events/dead-letter?contractId=ABC'
```

### Batch Replay Script
```bash
#!/bin/bash
IDS=$(curl -s 'http://localhost:3000/soroban-events/dead-letter?status=pending' \
  -H 'x-ingest-secret: SECRET' | jq -r '.data[].id')

for ID in $IDS; do
  curl -X POST "http://localhost:3000/soroban-events/dead-letter/$ID/replay" \
    -H 'x-ingest-secret: SECRET' \
    -H 'Content-Type: application/json' \
    -d '{"reason": "Batch replay after fix"}'
done
```

## Key Points to Remember

1. **Idempotent** - Replay/resolve same event multiple times is safe
2. **Historical** - Error history preserved in `errorHistory` array
3. **Audit Trail** - Who resolved it and why tracked
4. **Searchable** - Filter by contract, type, status
5. **Observable** - Statistics and metrics available

## When to Use Each Status

| Status | Use When | Next Action |
|--------|----------|------------|
| `pending` | Event just failed or waiting | Investigate & decide |
| `replayed` | Event successfully reprocessed | Monitor / Observe |
| `resolved` | Issue is acknowledged/fixed | Close ticket |

## Rate Limits

No rate limits on DLQ endpoints (use responsibly):
- Max 100 replays/second per service
- Max 1000 queries/second per service

## Audit Trail

Every action is logged:
- Event moved to DLQ → recorded with error
- Replay initiated → recorded with reason
- Resolution marked → recorded with who and reason
- All timestamps preserved

## Help & Documentation

- Full Guide: `DEAD_LETTER_QUEUE_GUIDE.md`
- Testing: `DEAD_LETTER_QUEUE_TESTING.md`
- Setup: `DEAD_LETTER_QUEUE_SETUP.md`
- Implementation: `IMPLEMENTATION_SUMMARY_DEAD_LETTER_QUEUE.md`

## Example: End-to-End Debugging

```bash
# 1. Check health
curl 'http://localhost:3000/soroban-events/dead-letter/stats' \
  -H 'x-ingest-secret: SECRET' | jq '.'

# Output:
# {
#   "total": 42,
#   "pending": 5,
#   "replayed": 30,
#   "resolved": 7,
#   "mostCommonError": "Contract reference not found",
#   "oldestUnresolvedAt": "2024-01-15T10:00:00Z"
# }

# 2. Find the oldest pending
curl 'http://localhost:3000/soroban-events/dead-letter?status=pending&sortBy=createdAt' \
  -H 'x-ingest-secret: SECRET' | jq '.data[0]'

# 3. Inspect details
curl 'http://localhost:3000/soroban-events/dead-letter/550e8400-e29b-41d4-a716-446655440000' \
  -H 'x-ingest-secret: SECRET' | jq '.errorHistory'

# 4. Decide: Replay or Resolve?
# If fixable: Replay
curl -X POST 'http://localhost:3000/soroban-events/dead-letter/550e8400-e29b-41d4-a716-446655440000/replay' \
  -H 'x-ingest-secret: SECRET' -H 'Content-Type: application/json' \
  -d '{"reason": "Contract now deployed"}'

# If not fixable: Resolve
curl -X PATCH 'http://localhost:3000/soroban-events/dead-letter/550e8400-e29b-41d4-a716-446655440000/resolve' \
  -H 'x-ingest-secret: SECRET' -H 'Content-Type: application/json' \
  -d '{"reason": "Deprecated protocol, no fix available", "resolvedBy": "you@example.com"}'
```

---

**Last Updated:** 2026-06-27  
**For more details:** See comprehensive guides in `DEAD_LETTER_QUEUE_GUIDE.md`
