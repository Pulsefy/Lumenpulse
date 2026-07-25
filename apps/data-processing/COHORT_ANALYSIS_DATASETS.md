# Cohort Analysis Datasets Documentation

This document describes the cohort analysis datasets for grant round contributor tracking, repeat participation patterns, and round-to-round retention analysis.

## Overview

The cohort analysis system provides datasets that enable:
- **Repeat contributor identification** across grant rounds
- **Time-windowed cohort summaries** for temporal analysis
- **Round-to-round retention patterns** for understanding contributor loyalty
- **Contributor classification** (one-time, repeat, super contributors)

## Dataset Schema

### 1. GrantRound (`grant_rounds`)

Stores metadata for quadratic funding grant rounds.

**Columns:**
- `id` (BigInteger, PK): Round ID from chain
- `name` (String): Round name
- `description` (String): Round description
- `start_time` (DateTime): Round start timestamp
- `end_time` (DateTime): Round end timestamp
- `total_pool` (Float): Total funding pool
- `total_contributions` (Float): Total contributions received
- `unique_contributors` (Integer): Number of unique contributors
- `unique_projects` (Integer): Number of unique projects
- `status` (String): Round status (active, completed, cancelled)
- `extra_data` (JSON): Additional metadata
- `created_at` (DateTime): Record creation timestamp
- `updated_at` (DateTime): Record update timestamp

**Indexes:**
- `idx_grant_rounds_start_time`
- `idx_grant_rounds_end_time`
- `idx_grant_rounds_status`

**Usage:**
```python
# Query active rounds
SELECT * FROM grant_rounds WHERE status = 'active';

# Get rounds in a time range
SELECT * FROM grant_rounds 
WHERE start_time >= '2026-01-01' AND end_time <= '2026-12-31';
```

---

### 2. ContributorRoundParticipation (`contributor_round_participation`)

Tracks individual contributor participation in each round.

**Columns:**
- `id` (Integer, PK): Auto-increment ID
- `round_id` (BigInteger, FK): Grant round ID
- `contributor` (String): Contributor wallet address
- `total_contributed` (Float): Total amount contributed by this contributor in the round
- `projects_supported` (Integer): Number of projects supported
- `contribution_count` (Integer): Number of contribution transactions
- `first_contribution_at` (DateTime): First contribution timestamp in round
- `last_contribution_at` (DateTime): Last contribution timestamp in round
- `project_ids` (JSON): Array of project IDs supported
- `created_at` (DateTime): Record creation timestamp
- `updated_at` (DateTime): Record update timestamp

**Indexes:**
- `ux_contributor_round_participation_round_contributor` (unique on round_id, contributor)
- `idx_contributor_round_participation_contributor`
- `idx_contributor_round_participation_round_id`

**Usage:**
```python
# Get all contributors for a round
SELECT contributor, total_contributed, projects_supported 
FROM contributor_round_participation 
WHERE round_id = 123;

# Get contributor's participation history
SELECT * FROM contributor_round_participation 
WHERE contributor = '0x123...' 
ORDER BY round_id;
```

---

### 3. ContributorCohort (`contributor_cohorts`)

Stores cohort definitions and summaries for time-windowed analysis.

**Columns:**
- `id` (Integer, PK): Auto-increment ID
- `cohort_id` (String, unique): Cohort identifier
- `cohort_type` (String): Cohort type (first_round, time_window, repeat, super_contributor)
- `definition_window_start` (DateTime): Cohort definition window start
- `definition_window_end` (DateTime): Cohort definition window end
- `member_count` (Integer): Number of cohort members
- `members` (JSON): Array of contributor addresses
- `total_contributed` (Float): Total contributions by cohort members
- `avg_contributed_per_member` (Float): Average contribution per member
- `created_at` (DateTime): Record creation timestamp
- `updated_at` (DateTime): Record update timestamp

**Indexes:**
- `idx_contributor_cohorts_type`
- `idx_contributor_cohorts_cohort_id`
- `idx_contributor_cohorts_window`

**Usage:**
```python
# Get all first-round cohorts
SELECT * FROM contributor_cohorts 
WHERE cohort_type = 'first_round';

# Get cohorts defined in a time window
SELECT * FROM contributor_cohorts 
WHERE definition_window_start >= '2026-01-01' 
AND definition_window_end <= '2026-03-31';
```

---

### 4. CohortRetentionSummary (`cohort_retention_summaries`)

Stores retention metrics for cohorts across subsequent rounds.

**Columns:**
- `id` (Integer, PK): Auto-increment ID
- `cohort_id` (String, FK): Cohort identifier
- `round_id` (BigInteger, FK): Grant round ID
- `cohort_size` (Integer): Original cohort size
- `retained_contributors` (Integer): Number of cohort members who participated
- `retention_rate` (Float): Retention rate (0.0 - 1.0)
- `retained_total_contributed` (Float): Total contributions by retained contributors
- `avg_retained_contribution` (Float): Average contribution by retained contributors
- `new_contributors` (Integer): Number of new contributors (not in cohort)
- `calculated_at` (DateTime): When retention was calculated
- `created_at` (DateTime): Record creation timestamp

**Indexes:**
- `ux_cohort_retention_cohort_round` (unique on cohort_id, round_id)
- `idx_cohort_retention_cohort_id`
- `idx_cohort_retention_round_id`
- `idx_cohort_retention_calculated_at`

**Usage:**
```python
# Get retention timeline for a cohort
SELECT round_id, cohort_size, retained_contributors, retention_rate 
FROM cohort_retention_summaries 
WHERE cohort_id = 'first_round_123' 
ORDER BY round_id;

# Get retention rates for a specific round across all cohorts
SELECT cohort_id, retention_rate 
FROM cohort_retention_summaries 
WHERE round_id = 456;
```

---

### 5. RepeatContributorSummary (`repeat_contributor_summaries`)

Stores aggregated metrics for repeat contributors across rounds.

**Columns:**
- `id` (Integer, PK): Auto-increment ID
- `contributor` (String, unique): Contributor wallet address
- `rounds_participated` (Integer): Number of rounds participated
- `first_round_id` (BigInteger): First round participated
- `last_round_id` (BigInteger): Last round participated
- `total_contributed_all_rounds` (Float): Total contributions across all rounds
- `avg_contributed_per_round` (Float): Average contribution per round
- `total_projects_supported` (Integer): Total projects supported (counting duplicates)
- `unique_projects_supported` (Integer): Unique projects supported
- `contributor_type` (String): Classification (one_time, repeat, super_contributor)
- `round_ids` (JSON): Array of round IDs participated
- `first_contribution_at` (DateTime): First contribution timestamp
- `last_contribution_at` (DateTime): Last contribution timestamp
- `calculated_at` (DateTime): When metrics were calculated
- `created_at` (DateTime): Record creation timestamp
- `updated_at` (DateTime): Record update timestamp

**Indexes:**
- `idx_repeat_contributor_contributor` (unique)
- `idx_repeat_contributor_type`
- `idx_repeat_contributor_rounds`
- `idx_repeat_contributor_calculated_at`

**Usage:**
```python
# Get all super contributors
SELECT * FROM repeat_contributor_summaries 
WHERE contributor_type = 'super_contributor';

# Get contributors who participated in 5+ rounds
SELECT * FROM repeat_contributor_summaries 
WHERE rounds_participated >= 5 
ORDER BY total_contributed_all_rounds DESC;

# Get contributor classification breakdown
SELECT contributor_type, COUNT(*) as count, 
AVG(total_contributed_all_rounds) as avg_total
FROM repeat_contributor_summaries 
GROUP BY contributor_type;
```

---

## API Usage

### Initialization

```python
from src.analytics.cohort_analyzer import CohortAnalyzer, create_cohort_analyzer
from src.db.postgres_service import PostgresService

# Initialize with default database service
analyzer = create_cohort_analyzer()

# Or with custom database service
db_service = PostgresService(database_url="postgresql://...")
analyzer = CohortAnalyzer(db_service=db_service)
```

### Track Round Participation

```python
# Track contributions for a round
contributions = [
    {
        "contributor": "0x123...",
        "amount": 100.0,
        "project_id": 1,
        "timestamp": datetime(2026, 1, 15, 10, 30)
    },
    # ... more contributions
]

saved_count = analyzer.track_round_participation(
    round_id=123,
    contributions=contributions
)
print(f"Saved {saved_count} participation records")
```

### Create First-Round Cohort

```python
# Create cohort of contributors who first participated in round 123
cohort_metrics = analyzer.create_first_round_cohort(round_id=123)

print(f"Cohort {cohort_metrics.chort_id} has {cohort_metrics.member_count} members")
print(f"Total contributed: ${cohort_metrics.total_contributed}")
```

### Calculate Retention

```python
# Calculate retention for a cohort in a subsequent round
retention_metrics = analyzer.calculate_retention(
    cohort_id="first_round_123",
    round_id=124
)

print(f"Retention rate: {retention_metrics.retention_rate:.1%}")
print(f"Retained contributors: {retention_metrics.retained_contributors}/{retention_metrics.cohort_size}")
```

### Analyze Repeat Contributors

```python
# Analyze all repeat contributors (2+ rounds)
repeat_contributors = analyzer.analyze_repeat_contributors(min_rounds=2)

for contributor in repeat_contributors:
    print(f"{contributor.contributor}: {contributor.rounds_participated} rounds, "
          f"${contributor.total_contributed_all_rounds:.2f} total, "
          f"type={contributor.contributor_type.value}")
```

### Create Time-Window Cohort

```python
# Create cohort for Q1 2026
from datetime import datetime

cohort_metrics = analyzer.create_time_window_cohort(
    window_start=datetime(2026, 1, 1),
    window_end=datetime(2026, 3, 31)
)

print(f"Q1 2026 cohort has {cohort_metrics.member_count} members")
```

### Get Retention Timeline

```python
# Get full retention timeline for a cohort
timeline = analyzer.get_cohort_retention_timeline(cohort_id="first_round_123")

for data in timeline:
    print(f"Round {data['round_id']}: {data['retention_rate']:.1%} retention")
```

---

## Dataset Definitions for Contributors

### Cohort Types

- **first_round**: Contributors who made their first contribution in a specific round
- **time_window**: Contributors who participated within a defined time window
- **repeat**: Contributors who participated in multiple rounds (2-5 rounds)
- **super_contributor**: High-value contributors (6+ rounds or >$10,000 total)

### Contributor Types

- **one_time**: Participated in only one round
- **repeat**: Participated in 2-5 rounds
- **super_contributor**: Participated in 6+ rounds or contributed >$10,000 total

### Retention Rate Calculation

```
retention_rate = retained_contributors / cohort_size
```

Where:
- `retained_contributors`: Number of cohort members who participated in the target round
- `cohort_size`: Original cohort size at definition time

### Classification Thresholds

Current thresholds (configurable in code):
- **Super contributor**: 6+ rounds OR >$10,000 total contributions
- **Repeat contributor**: 2-5 rounds
- **One-time contributor**: 1 round

---

## Output Format for Backend/Dashboard Consumption

### Cohort Metrics Response

```json
{
  "cohort_id": "first_round_123",
  "member_count": 150,
  "members": ["0x123...", "0x456..."],
  "total_contributed": 50000.0,
  "avg_contributed_per_member": 333.33
}
```

### Retention Metrics Response

```json
{
  "cohort_id": "first_round_123",
  "round_id": 124,
  "cohort_size": 150,
  "retained_contributors": 90,
  "retention_rate": 0.6,
  "retained_total_contributed": 30000.0,
  "avg_retained_contribution": 333.33,
  "new_contributors": 50
}
```

### Repeat Contributor Metrics Response

```json
{
  "contributor": "0x123...",
  "rounds_participated": 5,
  "first_round_id": 120,
  "last_round_id": 124,
  "total_contributed_all_rounds": 2500.0,
  "avg_contributed_per_round": 500.0,
  "total_projects_supported": 15,
  "unique_projects_supported": 12,
  "contributor_type": "repeat",
  "round_ids": [120, 121, 122, 123, 124],
  "first_contribution_at": "2026-01-15T10:30:00Z",
  "last_contribution_at": "2026-06-20T14:45:00Z"
}
```

### Retention Timeline Response

```json
[
  {
    "round_id": 124,
    "cohort_size": 150,
    "retained_contributors": 90,
    "retention_rate": 0.6,
    "retained_total_contributed": 30000.0,
    "avg_retained_contribution": 333.33,
    "new_contributors": 50,
    "calculated_at": "2026-07-23T12:00:00Z"
  },
  {
    "round_id": 125,
    "cohort_size": 150,
    "retained_contributors": 75,
    "retention_rate": 0.5,
    "retained_total_contributed": 25000.0,
    "avg_retained_contribution": 333.33,
    "new_contributors": 60,
    "calculated_at": "2026-07-23T12:00:00Z"
  }
]
```

---

## Database Migration

To create the cohort analysis tables, run the migration:

```bash
cd apps/data-processing
alembic upgrade head
```

Or to upgrade to a specific revision:

```bash
alembic upgrade 006_add_cohort_analysis_tables
```

---

## Integration with Existing Data

The cohort analysis system integrates with existing tables:

- **ProjectContributor**: Used to extract contribution data for round participation tracking
- **ProjectView**: Used to get project information for cohort analysis
- **ContractEvent**: Can be used as source data for contribution tracking

---

## Performance Considerations

1. **Indexes**: All tables have appropriate indexes for common query patterns
2. **Batch operations**: Use batch operations when tracking large numbers of contributions
3. **Caching**: Consider caching cohort metrics for frequently accessed cohorts
4. **Partitioning**: For large deployments, consider partitioning by round_id or time ranges

---

## Maintenance

### Recalculating Metrics

To force recalculation of repeat contributor metrics:

```python
analyzer.analyze_repeat_contributors(min_rounds=2, recalculate=True)
```

### Cleaning Old Data

To remove old cohort data (use with caution):

```sql
DELETE FROM cohort_retention_summaries WHERE calculated_at < '2025-01-01';
DELETE FROM contributor_cohorts WHERE created_at < '2025-01-01';
```

---

## Troubleshooting

### Common Issues

1. **Cohort not found**: Ensure the cohort was created before calculating retention
2. **No rounds in time window**: Verify that grant rounds exist in the specified time range
3. **Empty participation data**: Check that contribution data is being tracked properly

### Logging

The cohort analyzer uses Python logging. Enable debug logging for detailed operation traces:

```python
import logging
logging.getLogger('src.analytics.cohort_analyzer').setLevel(logging.DEBUG)
```
