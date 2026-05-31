# Contributor Reputation Snapshot Builder

## Overview

The Contributor Reputation Snapshot Builder builds periodic snapshots of contributor reputation and activity metrics for leaderboards. It works with Stellar testnet data from the contributor registry contract.

## Features

- **Automated Daily Snapshots**: Runs at 00:00 UTC every day via APScheduler
- **Top-N Queries**: Supports leaderboard queries for top N contributors
- **Testnet Compatible**: Works with Stellar testnet data (generates mock data if no real events found)
- **Reputation Scoring**: Weighted algorithm considering contributions, value, activity streak, and project diversity
- **REST API**: HTTP endpoints for querying and manual triggering

## Snapshot Schedule

### Default Schedule

- **Cron Expression**: `0 0 * * *`
- **Timezone**: UTC
- **Frequency**: Daily at midnight (00:00 UTC)
- **Job ID**: `contributor_reputation_snapshot_daily`
- **Job Name**: Contributor Reputation Snapshot - Daily

### Schedule Configuration

The snapshot job is configured in `src/scheduler.py`:

```python
# Contributor Reputation Snapshot: daily at 00:00 UTC
snapshot_job = self.scheduler.add_job(
    func=_contributor_snapshot_job,
    trigger=CronTrigger(hour=0, minute=0, timezone="UTC"),
    id="contributor_reputation_snapshot_daily",
    name="Contributor Reputation Snapshot - Daily",
    replace_existing=True,
)
```

### Why 00:00 UTC?

- Ensures the previous day's data is complete before aggregation
- Runs before other daily jobs (model retraining at 02:00 UTC)
- Minimizes conflict with peak usage hours

## Metrics Captured

Each snapshot captures the following metrics for every contributor:

| Metric                    | Type     | Description                                          |
| ------------------------- | -------- | ---------------------------------------------------- |
| `contributor_address`     | String   | Stellar public key of the contributor                |
| `total_contributions`     | Integer  | Total number of contributions in the snapshot period |
| `total_value_xlm`         | Float    | Total value of contributions in XLM                  |
| `first_contribution_date` | DateTime | Date of first contribution                           |
| `last_contribution_date`  | DateTime | Date of most recent contribution                     |
| `activity_streak_days`    | Integer  | Consecutive days of activity ending at snapshot_date |
| `unique_projects`         | Integer  | Number of unique projects contributed to             |
| `reputation_score`        | Float    | Weighted reputation score (0-100)                    |
| `metadata`                | JSON     | Additional metadata including rank and percentile    |

## Reputation Scoring Algorithm

The reputation score is calculated using a weighted combination of metrics:

```
Reputation Score = (
    0.30 × contribution_score +
    0.40 × value_score +
    0.20 × streak_score +
    0.10 × project_score
) × 100
```

### Weight Breakdown

| Component           | Weight | Scaling    | Description                                                  |
| ------------------- | ------ | ---------- | ------------------------------------------------------------ |
| Total Contributions | 30%    | Log-scaled | Number of contributions (prevents domination by high counts) |
| Total Value         | 40%    | Log-scaled | Total XLM contributed (prevents whale domination)            |
| Activity Streak     | 20%    | Linear     | Consecutive days of activity                                 |
| Unique Projects     | 10%    | Linear     | Number of different projects contributed to                  |

### Why Log-Scaling?

Log-scaling (`log1p`) is used for contributions and value to prevent:

- Single contributors with extremely high values from dominating the leaderboard
- Disincentivizing smaller contributors
- Creating a more balanced and fair ranking system

## API Endpoints

### 1. Get Top N Contributors

**Endpoint**: `GET /contributors/top`

**Description**: Get top N contributors by reputation score for leaderboards.

**Query Parameters**:

- `n` (optional): Number of top contributors to return (1-100, default: 10)

**Authentication**: Requires `X-API-Key` header

**Example Request**:

```bash
curl -H "X-API-Key: your-api-key" \
  "http://localhost:8000/contributors/top?n=10"
```

**Example Response**:

```json
{
  "contributors": [
    {
      "contributor_address": "GABC123...",
      "total_contributions": 50,
      "total_value_xlm": 500.0,
      "first_contribution_date": "2026-03-01T00:00:00",
      "last_contribution_date": "2026-05-29T00:00:00",
      "activity_streak_days": 10,
      "unique_projects": 5,
      "reputation_score": 95.5,
      "snapshot_date": "2026-05-29T00:00:00",
      "metadata": {
        "rank": 1,
        "percentile": 100.0
      }
    }
  ],
  "total_count": 10,
  "snapshot_date": "2026-05-29T00:00:00",
  "generated_at": "2026-05-29T12:00:00"
}
```

### 2. Manually Trigger Snapshot

**Endpoint**: `POST /contributors/snapshot`

**Description**: Manually trigger a contributor reputation snapshot build. Useful for testing or on-demand updates.

**Authentication**: Requires `X-API-Key` header

**Rate Limit**: 5 requests per minute

**Example Request**:

```bash
curl -X POST -H "X-API-Key: your-api-key" \
  "http://localhost:8000/contributors/snapshot"
```

**Example Response**:

```json
{
  "status": "completed",
  "snapshots_saved": 25,
  "top_contributor": "GABC123...",
  "top_score": 95.5,
  "duration_seconds": 2.5,
  "timestamp": "2026-05-29T12:00:00"
}
```

### 3. Get Schedule Documentation

**Endpoint**: `GET /contributors/snapshot/schedule`

**Description**: Get the contributor reputation snapshot schedule documentation.

**Authentication**: Requires `X-API-Key` header

**Example Request**:

```bash
curl -H "X-API-Key: your-api-key" \
  "http://localhost:8000/contributors/snapshot/schedule"
```

**Example Response**:

```json
{
  "schedule": {
    "cron": "0 0 * * *",
    "description": "Daily at 00:00 UTC",
    "timezone": "UTC",
    "job_id": "contributor_reputation_snapshot_daily",
    "job_name": "Contributor Reputation Snapshot - Daily"
  },
  "configuration": {
    "data_source": "Stellar testnet contributor registry contract",
    "metrics_captured": [...],
    "scoring_algorithm": {...}
  },
  "endpoints": {...},
  "note": "Works with Stellar testnet data. Mock data generated if no real events found."
}
```

## Database Schema

### Table: `contributor_reputation_snapshots`

The migration creates the following table (see `alembic/versions/003_add_contributor_reputation_snapshots.py`):

```sql
CREATE TABLE contributor_reputation_snapshots (
    id SERIAL PRIMARY KEY,
    contributor_address VARCHAR(56) NOT NULL,
    snapshot_date TIMESTAMP WITH TIME ZONE NOT NULL,
    total_contributions INTEGER NOT NULL DEFAULT 0,
    total_value_xlm FLOAT NOT NULL DEFAULT 0.0,
    first_contribution_date TIMESTAMP WITH TIME ZONE,
    last_contribution_date TIMESTAMP WITH TIME ZONE,
    activity_streak_days INTEGER NOT NULL DEFAULT 0,
    unique_projects INTEGER NOT NULL DEFAULT 0,
    reputation_score FLOAT NOT NULL DEFAULT 0.0,
    metadata JSON,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (contributor_address, snapshot_date)
);

-- Indexes for efficient querying
CREATE INDEX idx_contributor_snapshots_address ON contributor_reputation_snapshots(contributor_address);
CREATE INDEX idx_contributor_snapshots_date ON contributor_reputation_snapshots(snapshot_date);
CREATE INDEX idx_contributor_snapshots_score ON contributor_reputation_snapshots(reputation_score);
CREATE INDEX idx_contributor_snapshots_leaderboard ON contributor_reputation_snapshots(snapshot_date, reputation_score DESC);
CREATE INDEX idx_contributor_snapshots_activity ON contributor_reputation_snapshots(snapshot_date, activity_streak_days, reputation_score);
```

## Usage Examples

### Python SDK Usage

```python
from src.analytics.contributor_reputation import ContributorReputationSnapshotBuilder

# Build snapshots
builder = ContributorReputationSnapshotBuilder()

# Get top 10 contributors
top_10 = builder.get_top_n(10)
for contributor in top_10:
    print(f"{contributor.contributor_address}: {contributor.reputation_score}")

# Manually run snapshot job
result = builder.run_snapshot_job()
print(f"Saved {result['snapshots_saved']} snapshots")
```

### Scheduler Integration

The snapshot builder is automatically integrated into the APScheduler:

```python
from src.scheduler import AnalyticsScheduler

scheduler = AnalyticsScheduler()

# Manually trigger snapshot
result = scheduler.trigger_contributor_snapshot()

# Get top contributors
top_contributors = scheduler.get_top_contributors(n=10)
```

## Testing

### Run Unit Tests

```bash
cd apps/data-processing
pytest tests/test_contributor_reputation.py -v
```

### Run Integration Tests

```bash
pytest tests/integration/test_contributor_api.py -v
```

### Test with Mock Data

The system automatically generates mock data for testnet if no real contributor events are found:

```python
# The builder will generate 20-50 mock contributors
builder = ContributorReputationSnapshotBuilder()
snapshots = builder.build_snapshot()
```

## Data Flow

```
1. Scheduler triggers job at 00:00 UTC
   ↓
2. ContributorReputationSnapshotBuilder.build_snapshot()
   ↓
3. Query AnalyticsRecord table for contributor_event records
   ↓
4. If no events found → Generate mock data (testnet mode)
   ↓
5. Aggregate metrics per contributor
   ↓
6. Calculate reputation scores (weighted algorithm)
   ↓
7. Calculate rankings and percentiles
   ↓
8. Save to contributor_reputation_snapshots table
   ↓
9. Return job result metadata
```

## Environment Variables

No additional environment variables are required. The snapshot builder uses the existing `DATABASE_URL` configuration.

## Error Handling

The snapshot builder includes comprehensive error handling:

- **Database errors**: Logged and re-raised for scheduler to catch
- **Empty data**: Returns `completed_no_data` status
- **Mock data fallback**: Automatically generates test data if no real events found
- **Session management**: Properly closes database sessions on completion

## Production Deployment Notes

### Before Going to Production

1. **Replace Mock Data**: Update `_fetch_contributor_data()` to query actual ContractEvent table
2. **Adjust Schedule**: Consider adjusting cron expression based on traffic patterns
3. **Monitor Performance**: The composite indexes optimize top-N queries, but monitor query performance
4. **Data Retention**: Implement cleanup job for old snapshots (e.g., keep last 90 days)

### Scaling Considerations

- The snapshot builder processes all contributors in a single transaction
- For large contributor bases (>10,000), consider batch processing
- The reputation scoring algorithm is O(n log n) due to sorting
- Database indexes optimize the most common queries (top-N by score)

## Troubleshooting

### No Contributors in Leaderboard

**Problem**: Top-N query returns empty results

**Solutions**:

1. Check if snapshot job has run: `SELECT COUNT(*) FROM contributor_reputation_snapshots;`
2. Manually trigger snapshot: `POST /contributors/snapshot`
3. Check logs for errors in snapshot job execution
4. Verify database connection and migrations are applied

### Slow Top-N Queries

**Problem**: Leaderboard queries are slow

**Solutions**:

1. Verify indexes exist: `\di idx_contributor_snapshots_*`
2. Check query plan: `EXPLAIN ANALYZE SELECT ... ORDER BY reputation_score DESC LIMIT 10;`
3. Consider adding a materialized view for very large datasets

### Incorrect Reputation Scores

**Problem**: Scores seem unfair or incorrect

**Solutions**:

1. Review scoring algorithm weights in `_calculate_reputation_scores()`
2. Check if log-scaling is appropriate for your data distribution
3. Verify contribution data is being aggregated correctly
4. Test with known data to validate scoring

## Future Enhancements

- [ ] Add time-window filtering (e.g., last 7 days, last 30 days)
- [ ] Implement reputation score trends (score change over time)
- [ ] Add badge/achievement system based on milestones
- [ ] Support custom scoring algorithms via configuration
- [ ] Add real-time event streaming for live leaderboard updates
- [ ] Implement data retention and cleanup policies

## Related Documentation

- [Scheduler Documentation](../src/scheduler.py)
- [Database Migration](../alembic/versions/003_add_contributor_reputation_snapshots.py)
- [API Server](../src/api/server.py)
- [Contributor Registry Contract](../../scripts/contracts.config.ts)
