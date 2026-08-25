# Dead Letter Queue - Testing & Verification Guide

## Quick Start: Testing the DLQ System

### Prerequisites

- Backend running locally (`npm run dev` in backend directory)
- PostgreSQL database with migrations applied
- BullMQ configured and running

### Step 1: Apply Database Migration

```bash
cd apps/backend

# Run migrations
npm run typeorm migration:run

# Verify table was created
npm run typeorm query "SELECT * FROM soroban_event_dead_letter LIMIT 1;"
```

**Expected Output:** Table exists (may be empty initially)

### Step 2: Test Event Ingestion & Failure

Create a test event that will fail processing:

```bash
curl -X POST http://localhost:3000/soroban-events/ingest \
  -H 'x-ingest-secret: your-secret' \
  -H 'Content-Type: application/json' \
  -d '{
    "txHash": "test-event-001",
    "eventIndex": 0,
    "contractId": "NONEXISTENT_CONTRACT_THAT_WILL_FAIL",
    "eventType": "transfer",
    "rawPayload": {
      "test": "payload"
    }
  }'
```

**Expected Response:**
```json
{
  "queued": true
}
```

**What happens next:**
1. Event queued for processing
2. Processor attempts to process (will fail due to invalid contract)
3. BullMQ retries 3 times with exponential backoff
4. After final failure, processor moves to DLQ

### Step 3: Verify Event in DLQ

```bash
# List DLQ events
curl 'http://localhost:3000/soroban-events/dead-letter?status=pending' \
  -H 'x-ingest-secret: your-secret'
```

**Expected Response:**
```json
{
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "txHash": "test-event-001",
      "eventIndex": 0,
      "status": "pending",
      "failureCount": 3,
      "lastErrorMessage": "...",
      "errorHistory": [...]
    }
  ],
  "page": 0,
  "limit": 20,
  "total": 1,
  "totalPages": 1
}
```

**Success Criteria:**
- ✅ Event appears in DLQ
- ✅ `failureCount` is 3 (exhausted retries)
- ✅ `errorHistory` contains error details
- ✅ `status` is "pending"

### Step 4: Inspect Failure Details

```bash
# Replace with actual ID from previous response
curl 'http://localhost:3000/soroban-events/dead-letter/550e8400-e29b-41d4-a716-446655440000' \
  -H 'x-ingest-secret: your-secret'
```

**Expected Response:** Full error details including:
- ✅ Full `errorHistory` array with all attempts
- ✅ `lastErrorMessage` and `lastErrorStack`
- ✅ Original `rawPayload`
- ✅ All event metadata

### Step 5: Test Idempotent Replay

Create a valid event that can be replayed:

```bash
# Create an event with valid contract (or mock it)
curl -X POST http://localhost:3000/soroban-events/ingest \
  -H 'x-ingest-secret: your-secret' \
  -H 'Content-Type: application/json' \
  -d '{
    "txHash": "test-replay-001",
    "eventIndex": 0,
    "contractId": "CAF5YZ3XZWHMNQYZPJ4YVGJJTKP3N6DSZXQFUTW7QPEHQ3KBFQMJDP",
    "eventType": "transfer",
    "rawPayload": {"amount": "1000"}
  }'

# Wait for failure and DLQ capture (15-30 seconds)
sleep 30

# Get DLQ event ID
DLQ_ID=$(curl -s 'http://localhost:3000/soroban-events/dead-letter?status=pending' \
  -H 'x-ingest-secret: your-secret' | jq -r '.data[0].id')

# Replay the event
curl -X POST "http://localhost:3000/soroban-events/dead-letter/${DLQ_ID}/replay" \
  -H 'x-ingest-secret: your-secret' \
  -H 'Content-Type: application/json' \
  -d '{"reason": "Testing replay"}'
```

**Expected Response:**
```json
{
  "message": "Event queued for replay",
  "jobId": "test-replay-001:0",
  "eventId": "550e8400-e29b-41d4-a716-446655440000",
  "replayCount": 1
}
```

**Test Idempotency:** Call the same replay endpoint again:

```bash
curl -X POST "http://localhost:3000/soroban-events/dead-letter/${DLQ_ID}/replay" \
  -H 'x-ingest-secret: your-secret' \
  -H 'Content-Type: application/json' \
  -d '{"reason": "Testing idempotency"}'
```

**Success Criteria:**
- ✅ Same `jobId` returned
- ✅ No duplicate processing
- ✅ `replayCount` still 1 (not incremented)
- ✅ Endpoint returns 202 Accepted both times

### Step 6: Test Resolution

```bash
# Resolve a DLQ event
curl -X PATCH "http://localhost:3000/soroban-events/dead-letter/${DLQ_ID}/resolve" \
  -H 'x-ingest-secret: your-secret' \
  -H 'Content-Type: application/json' \
  -d '{
    "reason": "Acknowledged as expected failure - deprecated contract",
    "resolvedBy": "test@example.com"
  }'
```

**Expected Response:**
```json
{
  "message": "Event marked as resolved",
  "eventId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "resolved",
  "resolvedAt": "2024-01-15T12:00:00Z"
}
```

**Verify Resolution:**
```bash
# Event should no longer appear in pending list
curl 'http://localhost:3000/soroban-events/dead-letter?status=pending' \
  -H 'x-ingest-secret: your-secret'

# But should appear in resolved list
curl 'http://localhost:3000/soroban-events/dead-letter?status=resolved' \
  -H 'x-ingest-secret: your-secret'
```

**Success Criteria:**
- ✅ Event moves from `pending` to `resolved` status
- ✅ `resolvedAt` timestamp is populated
- ✅ `resolvedBy` is recorded
- ✅ Filtered queries work correctly

### Step 7: Test Statistics

```bash
curl 'http://localhost:3000/soroban-events/dead-letter/stats' \
  -H 'x-ingest-secret: your-secret'
```

**Expected Response:**
```json
{
  "total": 2,
  "pending": 1,
  "replayed": 0,
  "resolved": 1,
  "mostCommonError": "Contract reference not found",
  "oldestUnresolvedAt": "2024-01-15T10:30:00Z"
}
```

**Success Criteria:**
- ✅ Counts match database state
- ✅ Most common error extracted correctly
- ✅ Oldest unresolved timestamp is accurate

## Comprehensive Test Suite

### Test File: `soroban-events-dead-letter.service.spec.ts`

```typescript
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SorobanEventsDeadLetterService } from './soroban-events-dead-letter.service';
import {
  SorobanEventDeadLetter,
  DeadLetterStatus,
} from './entities/soroban-event-dead-letter.entity';
import { SorobanEvent, SorobanEventStatus } from './entities/soroban-event.entity';

describe('SorobanEventsDeadLetterService', () => {
  let service: SorobanEventsDeadLetterService;
  let dlqRepo: Repository<SorobanEventDeadLetter>;
  let eventRepo: Repository<SorobanEvent>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        SorobanEventsDeadLetterService,
        {
          provide: getRepositoryToken(SorobanEventDeadLetter),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            findOne: jest.fn(),
            findOneBy: jest.fn(),
            createQueryBuilder: jest.fn(),
            count: jest.fn(),
            countBy: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(SorobanEvent),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            findOne: jest.fn(),
          },
        },
        {
          provide: 'BullQueue_soroban-events',
          useValue: {
            add: jest.fn().mockResolvedValue({}),
          },
        },
      ],
    }).compile();

    service = module.get<SorobanEventsDeadLetterService>(
      SorobanEventsDeadLetterService,
    );
    dlqRepo = module.get<Repository<SorobanEventDeadLetter>>(
      getRepositoryToken(SorobanEventDeadLetter),
    );
    eventRepo = module.get<Repository<SorobanEvent>>(
      getRepositoryToken(SorobanEvent),
    );
  });

  describe('moveToDeadLetter', () => {
    it('should create new DLQ entry for new failure', async () => {
      const event = {
        id: 'event-123',
        txHash: 'tx-001',
        eventIndex: 0,
        contractId: 'contract-1',
        eventType: 'transfer',
        rawPayload: { amount: '1000' },
      } as any;

      const error = new Error('Test error');
      const newEntry = { ...event, id: 'dlq-123', failureCount: 1 };

      jest.spyOn(dlqRepo, 'findOne').mockResolvedValue(null);
      jest.spyOn(dlqRepo, 'create').mockReturnValue(newEntry);
      jest.spyOn(dlqRepo, 'save').mockResolvedValue(newEntry);

      const result = await service.moveToDeadLetter(event, error);

      expect(result.failureCount).toBe(1);
      expect(result.lastErrorMessage).toBe('Test error');
      expect(dlqRepo.save).toHaveBeenCalled();
    });

    it('should update existing DLQ entry on repeated failure', async () => {
      const event = {
        id: 'event-123',
        txHash: 'tx-001',
        eventIndex: 0,
      } as any;

      const existingEntry = {
        id: 'dlq-123',
        failureCount: 2,
        errorHistory: [{ timestamp: '2024-01-15T10:00:00Z', message: 'Error 1' }],
      } as any;

      const error = new Error('Error 2');

      jest.spyOn(dlqRepo, 'findOne').mockResolvedValue(existingEntry);
      jest.spyOn(dlqRepo, 'save').mockResolvedValue({
        ...existingEntry,
        failureCount: 3,
        errorHistory: [
          ...existingEntry.errorHistory,
          { timestamp: expect.any(String), message: 'Error 2' },
        ],
      });

      const result = await service.moveToDeadLetter(event, error);

      expect(result.failureCount).toBe(3);
      expect(result.errorHistory.length).toBe(2);
    });
  });

  describe('replayEvent', () => {
    it('should queue event for replay', async () => {
      const dlq = {
        id: 'dlq-123',
        txHash: 'tx-001',
        eventIndex: 0,
        replayCount: 0,
        status: DeadLetterStatus.PENDING,
      } as any;

      jest.spyOn(dlqRepo, 'findOneBy').mockResolvedValue(dlq);
      jest.spyOn(dlqRepo, 'save').mockResolvedValue({
        ...dlq,
        replayCount: 1,
      });

      const result = await service.replayEvent('dlq-123', 'Testing replay');

      expect(result.jobId).toBe('tx-001:0');
      expect(result.replayCount).toBe(1);
    });

    it('should prevent exceeding max replay attempts', async () => {
      const dlq = {
        id: 'dlq-123',
        replayCount: 5, // Max attempts
      } as any;

      jest.spyOn(dlqRepo, 'findOneBy').mockResolvedValue(dlq);

      await expect(service.replayEvent('dlq-123'))
        .rejects
        .toThrow('exceeded maximum replay attempts');
    });

    it('should be idempotent when event already replayed', async () => {
      const dlq = {
        id: 'dlq-123',
        txHash: 'tx-001',
        eventIndex: 0,
        status: DeadLetterStatus.REPLAYED,
        replayCount: 1,
      } as any;

      jest.spyOn(dlqRepo, 'findOneBy').mockResolvedValue(dlq);

      const result = await service.replayEvent('dlq-123');

      expect(result.message).toBe('Event already successfully replayed');
      expect(result.replayCount).toBe(1); // Not incremented
    });
  });

  describe('resolveFailure', () => {
    it('should mark event as resolved', async () => {
      const dlq = {
        id: 'dlq-123',
        txHash: 'tx-001',
      } as any;

      jest.spyOn(dlqRepo, 'findOneBy').mockResolvedValue(dlq);
      jest.spyOn(dlqRepo, 'save').mockResolvedValue({
        ...dlq,
        status: DeadLetterStatus.RESOLVED,
        resolvedAt: new Date(),
        resolvedBy: 'maintainer@example.com',
      });

      const result = await service.resolveFailure(
        'dlq-123',
        'Test resolution',
        'maintainer@example.com',
      );

      expect(result.status).toBe(DeadLetterStatus.RESOLVED);
      expect(result.resolvedAt).toBeDefined();
    });
  });

  describe('listFailedEvents', () => {
    it('should return paginated results', async () => {
      const mockEvents = [
        { id: 'dlq-1', txHash: 'tx-001', status: DeadLetterStatus.PENDING },
        { id: 'dlq-2', txHash: 'tx-002', status: DeadLetterStatus.PENDING },
      ] as any;

      const queryBuilder = {
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([mockEvents, 2]),
      };

      jest.spyOn(dlqRepo, 'createQueryBuilder').mockReturnValue(queryBuilder);

      const result = await service.listFailedEvents({
        page: 0,
        limit: 20,
        status: DeadLetterStatus.PENDING,
      });

      expect(result.data).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.page).toBe(0);
      expect(result.limit).toBe(20);
    });
  });

  describe('getStats', () => {
    it('should return accurate statistics', async () => {
      jest.spyOn(dlqRepo, 'count').mockResolvedValue(42);
      jest.spyOn(dlqRepo, 'countBy')
        .mockResolvedValueOnce(15) // pending
        .mockResolvedValueOnce(25) // replayed
        .mockResolvedValueOnce(2); // resolved

      const queryBuilder = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({
          errorMessage: 'Contract not found',
        }),
      };

      const whereQueryBuilder = {
        where: jest.fn().mockReturnValue({
          orderBy: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue({
            createdAt: new Date(),
          }),
        }),
      };

      jest.spyOn(dlqRepo, 'createQueryBuilder')
        .mockReturnValueOnce(queryBuilder)
        .mockReturnValueOnce(whereQueryBuilder);

      const stats = await service.getStats();

      expect(stats.total).toBe(42);
      expect(stats.pending).toBe(15);
      expect(stats.replayed).toBe(25);
      expect(stats.resolved).toBe(2);
      expect(stats.mostCommonError).toBe('Contract not found');
    });
  });
});
```

### Test File: `soroban-events.processor.spec.ts` (DLQ Integration)

```typescript
describe('SorobanEventsProcessor - DLQ Integration', () => {
  it('should move event to DLQ on final failure', async () => {
    const job = {
      name: PROCESS_EVENT_JOB,
      data: {
        txHash: 'test-hash',
        eventIndex: 0,
        contractId: 'invalid',
        rawPayload: {},
      },
      attemptsMade: 3,
    } as any;

    const event = {
      txHash: 'test-hash',
      eventIndex: 0,
    } as any;

    const error = new Error('Final failure');

    jest.spyOn(eventRepo, 'findOne').mockResolvedValue(event);
    jest.spyOn(eventRepo, 'save').mockResolvedValue(event);
    jest.spyOn(dlqService, 'moveToDeadLetter').mockResolvedValue({} as any);

    // Simulate job failure event
    await processor.onJobFailed(job, error);

    expect(dlqService.moveToDeadLetter).toHaveBeenCalledWith(event, error);
  });

  it('should mark replayed event as successful', async () => {
    const job = {
      name: PROCESS_EVENT_JOB,
      data: {
        txHash: 'test-hash',
        eventIndex: 0,
        contractId: validContract,
        rawPayload: {},
      },
    } as any;

    jest.spyOn(eventRepo, 'findOne').mockResolvedValue({
      txHash: 'test-hash',
    } as any);
    jest.spyOn(eventRepo, 'save').mockResolvedValue({} as any);
    jest.spyOn(dlqService, 'markReplayed').mockResolvedValue();
    jest.spyOn(sorobanService, 'syncProjectRegistryEvent')
      .mockResolvedValue();

    await processor.process(job);

    expect(dlqService.markReplayed).toHaveBeenCalledWith('test-hash', 0);
  });
});
```

## Performance Testing

### Load Test: Process High Volume of Failures

```bash
#!/bin/bash
# test-high-volume-failures.sh

set -e

API_URL="http://localhost:3000"
SECRET="your-secret"
NUM_EVENTS=100

echo "Creating ${NUM_EVENTS} failing events..."

for i in $(seq 1 $NUM_EVENTS); do
  curl -s -X POST "$API_URL/soroban-events/ingest" \
    -H "x-ingest-secret: $SECRET" \
    -H "Content-Type: application/json" \
    -d "{
      \"txHash\": \"high-volume-test-$i\",
      \"eventIndex\": $((i % 5)),
      \"contractId\": \"INVALID_CONTRACT_$((i % 10))\",
      \"eventType\": \"transfer\",
      \"rawPayload\": {\"test\": $i}
    }" > /dev/null
  
  if [ $((i % 10)) -eq 0 ]; then
    echo "  Created $i events..."
  fi
done

echo "Waiting for processing..."
sleep 60

echo "Checking DLQ statistics..."
curl -s "$API_URL/soroban-events/dead-letter/stats" \
  -H "x-ingest-secret: $SECRET" | jq .

echo "Listing first 10 failures..."
curl -s "$API_URL/soroban-events/dead-letter?limit=10" \
  -H "x-ingest-secret: $SECRET" | jq '.data | length'
```

**Expected Performance:**
- ✅ DLQ captures all failed events
- ✅ Query time < 500ms for stats
- ✅ List endpoint handles pagination efficiently

## Monitoring Checklist

After deployment, verify:

- [ ] Migration runs successfully: `npm run typeorm migration:run`
- [ ] Table created: `SELECT COUNT(*) FROM soroban_event_dead_letter;`
- [ ] Indexes present: `SELECT * FROM pg_indexes WHERE tablename = 'soroban_event_dead_letter';`
- [ ] Service injected in module
- [ ] Controller routes registered
- [ ] Failed events captured in DLQ
- [ ] Replay endpoint works
- [ ] Resolution endpoint works
- [ ] Statistics endpoint accurate
- [ ] Error history preserved
- [ ] Idempotency maintained

## Rollback Plan

If issues occur:

```bash
# Rollback migration
npm run typeorm migration:revert

# Verify table removed
npm run typeorm query "SELECT * FROM soroban_event_dead_letter;" # Should fail
```

## Maintenance Tasks

### Weekly

```sql
-- Monitor DLQ growth
SELECT DATE(created_at), COUNT(*) as events
FROM soroban_event_dead_letter
GROUP BY DATE(created_at)
ORDER BY DATE(created_at) DESC
LIMIT 7;

-- Check pending count
SELECT COUNT(*) as pending
FROM soroban_event_dead_letter
WHERE status = 'pending';
```

### Monthly

```sql
-- Archive resolved events (optional)
DELETE FROM soroban_event_dead_letter
WHERE status = 'resolved'
  AND resolved_at < NOW() - INTERVAL '90 days';

-- Update statistics
ANALYZE soroban_event_dead_letter;
```

## References

- Dead Letter Queue Guide: `DEAD_LETTER_QUEUE_GUIDE.md`
- Architecture Documentation: `document/ARCHITECTURE.md`
- NestJS Testing: https://docs.nestjs.com/fundamentals/testing
