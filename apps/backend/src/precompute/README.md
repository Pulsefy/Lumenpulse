# Precompute Module

## Overview

The Precompute module automatically caches hot API responses on a schedule to ensure low first-user latency on testnet. It precomputes frequently accessed data and stores it in Redis cache, with built-in health checks and comprehensive metrics.

## Features

### 1. Scheduled Preloading
- Automatically runs every 5 minutes using `@nestjs/schedule`
- Precomputes hot routes and query outputs
- Configurable TTL for each cached response

### 2. Manual Refresh
- `POST /precompute/refresh` - Trigger refresh for all tasks (requires JWT auth)
- `POST /precompute/refresh/:taskName` - Refresh specific task (requires JWT auth)
- Designed for maintainers to manually refresh cache when needed

### 3. Dependency Health Validation
- Skips preloading when dependencies are unhealthy
- Checks Redis, Stellar Horizon, and external APIs before execution
- Logs skip reasons for transparency

### 4. Cache Refresh Logging
- Detailed logging for each precompute task
- Logs success, failure, skip reasons, and duration
- Structured logs for monitoring and debugging

### 5. Metrics Integration
- Prometheus metrics for:
  - Task execution count (by task name, status, skipped)
  - Task duration histogram
  - Batch execution count and duration
- Exposed via `/metrics` endpoint

## Precomputed Tasks

### 1. Latest News (`latest-news`)
- **Cache Key**: `news:latest`
- **TTL**: 5 minutes
- **Dependencies**: Redis, External APIs
- **Data**: Latest 20 crypto news articles in English

### 2. News Categories (`news-categories`)
- **Cache Key**: `precompute:news:categories`
- **TTL**: 10 minutes
- **Dependencies**: Redis, External APIs
- **Data**: Active news categories

### 3. Stellar Assets (`stellar-assets`)
- **Cache Key**: `precompute:stellar:assets`
- **TTL**: 5 minutes
- **Dependencies**: Redis, Stellar Horizon
- **Data**: Top 20 Stellar assets from Horizon API

## API Endpoints

### List Available Tasks
```
GET /precompute/tasks
```
Returns list of all available precompute task names.

### Get Status
```
GET /precompute/status
```
Returns current precompute status and available tasks.

### Manual Refresh (All Tasks)
```
POST /precompute/refresh
Authorization: Bearer <JWT_TOKEN>
```
Triggers refresh for all precompute tasks. Returns detailed results for each task.

### Manual Refresh (Specific Task)
```
POST /precompute/refresh/:taskName
Authorization: Bearer <JWT_TOKEN>
```
Triggers refresh for a specific task. Returns detailed result.

## Metrics

### Prometheus Metrics

- `lumenpulse_precompute_tasks_total` - Counter for task executions
  - Labels: `task_name`, `status` (success/failure), `skipped` (true/false)

- `lumenpulse_precompute_task_duration_seconds` - Histogram for task duration
  - Labels: `task_name`, `status`
  - Buckets: 0.1, 0.5, 1, 2, 5, 10, 30 seconds

- `lumenpulse_precompute_batches_total` - Counter for batch executions
  - Labels: `status`

- `lumenpulse_precompute_batch_duration_seconds` - Histogram for batch duration
  - Labels: `status`
  - Buckets: 1, 5, 10, 30, 60, 120 seconds

## Configuration

### Environment Variables
- `STELLAR_NETWORK` - Stellar network (testnet/mainnet). Default: testnet

### Schedule Configuration
The cron schedule is configured in `precompute.service.ts`:
```typescript
@Cron(CronExpression.EVERY_5_MINUTES)
```

To change the schedule, modify the cron expression:
- `CronExpression.EVERY_MINUTE` - Every minute
- `CronExpression.EVERY_5_MINUTES` - Every 5 minutes
- `CronExpression.EVERY_10_MINUTES` - Every 10 minutes
- `CronExpression.EVERY_HOUR` - Every hour

## Adding New Precompute Tasks

To add a new precompute task:

1. Add the task to `precomputeTasks` array in `precompute.service.ts`:
```typescript
{
  name: 'your-task-name',
  key: 'precompute:your:cache:key',
  execute: () => yourService.getData(),
  ttl: 300000, // TTL in milliseconds
  dependencies: ['redis', 'externalApis'], // Required healthy dependencies
}
```

2. The task will automatically be:
  - Included in scheduled precompute
  - Available via manual refresh endpoints
  - Tracked with metrics

## Error Handling

- Tasks with unhealthy dependencies are skipped with logged reasons
- Failed tasks are logged with error messages
- Metrics record both successes and failures
- Precompute continues for other tasks even if one fails

## Monitoring

### Logs
Look for logs with `[PrecomputeService]` prefix:
- `Initialized X precompute tasks` - Service initialization
- `Starting scheduled precompute` - Scheduled run started
- `Precompute completed: X/Y successful, Z skipped, Nms` - Batch completion
- `Precomputed 'task-name' in Nms` - Individual task success
- `Failed to precompute 'task-name': error` - Individual task failure
- `Skipping task 'task-name': reason` - Task skipped due to unhealthy deps

### Metrics Dashboard
Monitor the following in Grafana:
- Task success rate
- Task duration percentiles
- Batch execution frequency
- Skipped task count (indicates dependency issues)

## Security

Manual refresh endpoints require JWT authentication. Ensure:
- Only authorized maintainers have JWT tokens
- Tokens have appropriate permissions
- Consider adding role-based access control for production

## Testing

To test the precompute module:

1. Check available tasks:
```bash
curl http://localhost:3000/precompute/tasks
```

2. Check status:
```bash
curl http://localhost:3000/precompute/status
```

3. Manual refresh (requires auth):
```bash
curl -X POST http://localhost:3000/precompute/refresh \
  -H "Authorization: Bearer <JWT_TOKEN>"
```

4. Check metrics:
```bash
curl http://localhost:3000/metrics
```

## Troubleshooting

### Tasks are being skipped
- Check health endpoint: `GET /health`
- Verify dependencies are healthy
- Check logs for skip reasons

### Cache not warming
- Verify ScheduleModule is imported in app.module.ts
- Check logs for "Starting scheduled precompute"
- Ensure cron expression is correct

### Metrics not appearing
- Verify MetricsModule is imported
- Check `/metrics` endpoint
- Ensure Prometheus is scraping the metrics endpoint
