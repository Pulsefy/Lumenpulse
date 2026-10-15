# Dead Letter Queue - Setup & Deployment Guide

## Overview

This guide covers deploying the Dead Letter Queue system for Soroban events in production and development environments.

## Installation Steps

### Step 1: Update Code

All code changes are already implemented:
- ✅ Entity: `soroban-event-dead-letter.entity.ts`
- ✅ Migration: `1801000000000-CreateSorobanEventDeadLetter.ts`
- ✅ Service: `soroban-events-dead-letter.service.ts`
- ✅ Controller: `soroban-events-dead-letter.controller.ts`
- ✅ Module updates: `soroban-events.module.ts`
- ✅ Processor updates: `soroban-events.processor.ts`
- ✅ DTOs: `dead-letter.dto.ts`

### Step 2: Install Dependencies

No new dependencies required. Uses existing:
- `@nestjs/typeorm` - ORM
- `@nestjs/bullmq` - Queue management
- `typeorm` - Database migrations
- `class-validator` - DTO validation

If running a fresh install:

```bash
cd apps/backend
npm install
```

### Step 3: Database Migration

**Development:**

```bash
cd apps/backend

# Run pending migrations
npm run typeorm migration:run

# Verify table creation
npm run typeorm query "SELECT table_name FROM information_schema.tables WHERE table_name = 'soroban_event_dead_letter';"
```

**Production:**

```bash
# With environment variables set
export NODE_ENV=production
export DB_HOST=prod-db.example.com
export DB_PORT=5432
export DB_USER=production_user
export DB_PASSWORD=***
export DB_NAME=lumenpulse_prod

npm run typeorm migration:run
```

**Verify Migration:**

```sql
-- Check table structure
\d soroban_event_dead_letter

-- Verify indexes
SELECT indexname, indexdef FROM pg_indexes 
WHERE tablename = 'soroban_event_dead_letter' 
ORDER BY indexname;

-- Expected indexes:
-- idx_dlq_contract_type
-- idx_dlq_created_at
-- idx_dlq_soroban_event_id
-- idx_dlq_status
-- idx_dlq_status_created_at
-- idx_dlq_unresolved
-- uq_dlq_tx_index
```

### Step 4: Restart Backend Service

```bash
# Development
npm run dev

# Production (with PM2)
pm2 restart lumenpulse-backend
pm2 save

# Or with Docker
docker restart lumenpulse-backend
```

### Step 5: Verify Deployment

```bash
# Health check - service should be running
curl http://localhost:3000/health

# Verify DLQ table is accessible
curl 'http://localhost:3000/soroban-events/dead-letter/stats' \
  -H 'x-ingest-secret: your-secret'

# Expected response:
# {
#   "total": 0,
#   "pending": 0,
#   "replayed": 0,
#   "resolved": 0,
#   "mostCommonError": null,
#   "oldestUnresolvedAt": null
# }
```

## Configuration

### Environment Variables

No new environment variables required. Existing configuration is used:

```bash
# .env (existing)
SOROBAN_INGEST_SECRET=your-secret-for-authentication
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=password
DB_NAME=lumenpulse

# Optional: Adjust BullMQ settings if needed
REDIS_HOST=localhost
REDIS_PORT=6379
```

### Database Permissions

Ensure the database user has permissions:

```sql
-- For migration user
GRANT CREATE ON DATABASE lumenpulse TO migration_user;
GRANT USAGE ON SCHEMA public TO migration_user;
GRANT CREATE ON SCHEMA public TO migration_user;

-- For application user
GRANT SELECT, INSERT, UPDATE ON soroban_event_dead_letter TO app_user;
GRANT USAGE ON SEQUENCE soroban_event_dead_letter_id_seq TO app_user;
```

## Deployment Checklist

### Pre-Deployment

- [ ] Code reviewed and merged to main branch
- [ ] Migration tested in staging environment
- [ ] Database backup taken
- [ ] Rollback plan documented
- [ ] Team notified of deployment

### Deployment

- [ ] Pull latest code: `git pull origin main`
- [ ] Run migrations: `npm run typeorm migration:run`
- [ ] Verify table created: `SELECT COUNT(*) FROM soroban_event_dead_letter;`
- [ ] Restart backend service
- [ ] Verify health check: `curl http://localhost:3000/health`
- [ ] Test DLQ endpoint: `curl http://localhost:3000/soroban-events/dead-letter/stats ...`

### Post-Deployment

- [ ] Monitor logs for errors
- [ ] Test event ingestion and failure handling
- [ ] Verify failed events captured in DLQ
- [ ] Test replay functionality
- [ ] Document any issues found

## Monitoring & Alerting

### Key Metrics

Set up monitoring for:

```sql
-- Pending DLQ count (should be investigated)
SELECT COUNT(*) as pending FROM soroban_event_dead_letter 
WHERE status = 'pending';

-- Old pending events (> 24 hours)
SELECT COUNT(*) as old_pending FROM soroban_event_dead_letter
WHERE status = 'pending' AND created_at < NOW() - INTERVAL '24 hours';

-- Failure rate (events failing)
SELECT COUNT(*) FROM soroban_event_dead_letter 
WHERE created_at > NOW() - INTERVAL '1 hour';

-- Most common errors
SELECT last_error_message, COUNT(*) 
FROM soroban_event_dead_letter
WHERE status = 'pending'
GROUP BY last_error_message
ORDER BY COUNT DESC LIMIT 5;
```

### Alert Examples

**Alert: High DLQ Growth**
```
ALERT: If pending DLQ count > 50
ACTION: Review logs, check for systemic issues
```

**Alert: Old Unresolved Events**
```
ALERT: If any pending event > 48 hours old
ACTION: Triage event, replay or resolve
```

**Alert: Repeated Error Pattern**
```
ALERT: If same error message appears > 10 times in 1 hour
ACTION: Investigate root cause, deploy fix
```

### Grafana Dashboard Example

Create dashboard panels:

```promql
# Panel 1: DLQ Event Count Over Time
rate(soroban_events_dlq_total[5m])

# Panel 2: Pending Events
soroban_events_dlq_pending{status="pending"}

# Panel 3: Replay Success Rate
rate(soroban_events_dlq_replayed_total[5m]) / rate(soroban_events_dlq_replayed_attempts_total[5m])

# Panel 4: Most Common Errors
topk(5, count by (error) (soroban_events_dlq_errors_total))
```

## Docker Deployment

### Dockerfile Updates

No changes needed to Dockerfile. Migration runs automatically:

```dockerfile
FROM node:18-alpine AS builder
...

FROM node:18-alpine AS production
...

# Run migrations
RUN npm run typeorm migration:run

# Start application
CMD ["npm", "run", "start:prod"]
```

### Docker Compose

No changes to docker-compose.yml structure:

```yaml
services:
  backend:
    image: lumenpulse-backend:latest
    environment:
      DB_HOST: postgres
      # ... other vars
    depends_on:
      - postgres
      - redis
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
```

## Kubernetes Deployment

### Migration Job

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: lumenpulse-backend-migrations
spec:
  template:
    spec:
      containers:
      - name: migrations
        image: lumenpulse-backend:latest
        command:
          - npm
          - run
          - typeorm
          - migration:run
        env:
        - name: DB_HOST
          valueFrom:
            secretKeyRef:
              name: backend-secrets
              key: db-host
        # ... other env vars
      restartPolicy: Never
  backoffLimit: 3
```

### Deployment Pod

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: lumenpulse-backend
spec:
  replicas: 3
  template:
    spec:
      containers:
      - name: backend
        image: lumenpulse-backend:latest
        ports:
        - containerPort: 3000
        env:
        - name: DB_HOST
          valueFrom:
            secretKeyRef:
              name: backend-secrets
              key: db-host
        # ... other env vars
        readinessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
```

## GitHub Actions CI/CD

### Workflow: Migrations Check

```yaml
name: Database Migrations

on:
  pull_request:
  push:
    branches: [main]

jobs:
  migrations:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:14
        env:
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'
      
      - name: Install dependencies
        run: |
          cd apps/backend
          npm install
      
      - name: Run migrations
        env:
          DB_HOST: localhost
          DB_PORT: 5432
          DB_USER: postgres
          DB_PASSWORD: postgres
          DB_NAME: lumenpulse_test
        run: |
          cd apps/backend
          npm run typeorm migration:run
      
      - name: Verify schema
        env:
          DB_HOST: localhost
          DB_PORT: 5432
          DB_USER: postgres
          DB_PASSWORD: postgres
          DB_NAME: lumenpulse_test
        run: |
          psql -h localhost -U postgres -d lumenpulse_test \
            -c "SELECT table_name FROM information_schema.tables WHERE table_name = 'soroban_event_dead_letter';"
```

## Troubleshooting

### Issue: Migration Fails

**Error:** `table "soroban_event_dead_letter" already exists`

```bash
# Solution: Migration already ran, safe to ignore
# Or revert and retry:
npm run typeorm migration:revert
npm run typeorm migration:run
```

**Error:** `column "x" of relation "soroban_event_dead_letter" does not exist`

```bash
# Solution: Partial migration, check logs for failures
npm run typeorm migration:show  # See status
npm run typeorm migration:revert
npm run typeorm migration:run
```

### Issue: Service Can't Access DLQ Table

**Error:** `relation "soroban_event_dead_letter" does not exist`

```bash
# Solution: Migrations didn't run
npm run typeorm migration:run

# Verify user permissions
psql -h localhost -U postgres -d lumenpulse -c "\d soroban_event_dead_letter"
```

### Issue: DLQ Events Not Appearing

**Problem:** Events fail but don't appear in DLQ

```bash
# Check processor logs
docker logs lumenpulse-backend | grep "dead letter"

# Verify queue is working
npm run ts-node -- -e "console.log('Queue OK')"

# Check if dlqService is injected
grep "dlqService" apps/backend/src/soroban-events/soroban-events.processor.ts
```

### Issue: Query Performance Degradation

**Problem:** DLQ queries are slow

```bash
# Reindex table
REINDEX TABLE soroban_event_dead_letter;

# Update statistics
ANALYZE soroban_event_dead_letter;

# Check index usage
SELECT schemaname, tablename, indexname, idx_scan 
FROM pg_stat_user_indexes 
WHERE tablename = 'soroban_event_dead_letter';
```

## Rollback Procedure

If critical issues occur:

### Step 1: Identify Issue

```bash
# Check backend logs
docker logs lumenpulse-backend | tail -100

# Query DLQ to see state
SELECT COUNT(*) FROM soroban_event_dead_letter;
```

### Step 2: Revert Code

```bash
# Go back to previous commit
git revert HEAD

# Or checkout previous tag
git checkout v1.2.3

npm install
npm run build
```

### Step 3: Revert Database

```bash
# Revert migration
npm run typeorm migration:revert

# Verify table removed
psql -c "SELECT table_name FROM information_schema.tables WHERE table_name = 'soroban_event_dead_letter';" # Should be empty
```

### Step 4: Restart Service

```bash
# Restart backend
docker restart lumenpulse-backend
# or
pm2 restart lumenpulse-backend
```

### Step 5: Verify

```bash
# Service should work without DLQ
curl http://localhost:3000/health

# Old event ingestion should still work
curl -X POST http://localhost:3000/soroban-events/ingest ...
```

## Data Migration From Old System

If migrating from a previous error handling approach:

### Export Old Data

```sql
-- Get old failed events
SELECT 
  tx_hash,
  event_index,
  contract_id,
  event_type,
  raw_payload,
  error_message,
  created_at
FROM old_failed_events_table
LIMIT 100;
```

### Import to DLQ

```sql
-- Insert historical failures
INSERT INTO soroban_event_dead_letter (
  tx_hash,
  event_index,
  contract_id,
  event_type,
  raw_payload,
  failure_count,
  last_error_message,
  status,
  created_at,
  updated_at
)
SELECT
  tx_hash,
  event_index,
  contract_id,
  event_type,
  raw_payload,
  1,
  error_message,
  'pending',
  created_at,
  created_at
FROM old_failed_events_table;
```

## Performance Baseline

After deployment, establish baseline metrics:

```bash
#!/bin/bash
# Baseline query times

echo "=== DLQ Performance Baseline ==="

echo "1. List 20 pending events:"
time curl -s 'http://localhost:3000/soroban-events/dead-letter?status=pending&limit=20' \
  -H 'x-ingest-secret: secret' > /dev/null

echo "2. Get statistics:"
time curl -s 'http://localhost:3000/soroban-events/dead-letter/stats' \
  -H 'x-ingest-secret: secret' > /dev/null

echo "3. Filter by contract type:"
time curl -s 'http://localhost:3000/soroban-events/dead-letter?contractId=ABC&eventType=transfer' \
  -H 'x-ingest-secret: secret' > /dev/null

echo "4. Inspect single event (add ID):"
time curl -s 'http://localhost:3000/soroban-events/dead-letter/[ID]' \
  -H 'x-ingest-secret: secret' > /dev/null

echo "=== Expected: All queries < 500ms ==="
```

## Success Criteria

Deployment is successful when:

- ✅ Migration completes without errors
- ✅ DLQ table created with all indexes
- ✅ Failed events automatically captured in DLQ
- ✅ API endpoints respond correctly
- ✅ Replay functionality works
- ✅ Events don't appear in DLQ twice (idempotency)
- ✅ Query performance acceptable (< 500ms)
- ✅ No increase in error logs
- ✅ Health checks pass

## Post-Deployment

### Documentation

- [ ] Update project README with DLQ information
- [ ] Add DLQ endpoints to API documentation
- [ ] Create runbooks for common scenarios
- [ ] Document SLA for DLQ response

### Training

- [ ] Train team on DLQ usage
- [ ] Document common error patterns
- [ ] Create debugging guide
- [ ] Set up on-call escalation process

### Monitoring Setup

- [ ] Configure alerts for DLQ growth
- [ ] Set up dashboards
- [ ] Enable audit logging
- [ ] Create metrics reports

### Maintenance Schedule

- [ ] Weekly: Review pending events
- [ ] Monthly: Clean up resolved entries
- [ ] Quarterly: Audit error patterns
- [ ] Annually: Review and optimize

## References

- Architecture: `DEAD_LETTER_QUEUE_GUIDE.md`
- Testing: `DEAD_LETTER_QUEUE_TESTING.md`
- API Docs: Generated from Swagger in `/api` route
