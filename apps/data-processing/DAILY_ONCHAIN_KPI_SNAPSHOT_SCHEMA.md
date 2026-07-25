# Daily On-Chain KPI Snapshot Storage Schema & Scheduler Specification (#877)

## Overview

The **Daily On-Chain KPI Snapshot Scheduler** periodically computes and persists daily snapshots of core on-chain key performance indicators (KPIs) in `apps/data-processing`. Persisting pre-aggregated daily snapshots drastically reduces computational overhead for historical trend analysis, dashboards, and reporting while ensuring data consistency.

---

## Storage Schema

Table Name: `daily_onchain_kpi_snapshots`

| Column Name | Data Type | Constraints / Attributes | Description |
| :--- | :--- | :--- | :--- |
| `id` | `INTEGER` | `PRIMARY KEY`, `AUTOINCREMENT` | Unique surrogate primary key. |
| `snapshot_date` | `VARCHAR(10)` | `NOT NULL`, `INDEX` | Date of the snapshot in ISO format (`YYYY-MM-DD`). |
| `period` | `VARCHAR(20)` | `NOT NULL`, `DEFAULT 'daily'`, `INDEX` | Snapshot period granularity (`daily`, `weekly`, `monthly`). |
| `tvl` | `FLOAT` | `NOT NULL`, `DEFAULT 0.0` | Total Value Locked across all projects/contracts (in Stellar lumens/assets). |
| `volume` | `FLOAT` | `NOT NULL`, `DEFAULT 0.0` | Total contribution and transaction volume. |
| `active_rounds` | `INTEGER` | `NOT NULL`, `DEFAULT 0` | Count of active quadratic funding rounds/projects. |
| `contribution_count` | `INTEGER` | `NOT NULL`, `DEFAULT 0` | Total number of ingested deposit/contribution events. |
| `unique_contributors` | `INTEGER` | `NOT NULL`, `DEFAULT 0` | Count of distinct contributor addresses. |
| `extra_data` | `JSON` | `NULLABLE` | Optional metadata, breakdowns per project/token, or generation metadata. |
| `created_at` | `TIMESTAMP WITH TIME ZONE` | `NOT NULL`, `DEFAULT CURRENT_TIMESTAMP` | Row creation timestamp. |
| `updated_at` | `TIMESTAMP WITH TIME ZONE` | `NOT NULL`, `DEFAULT CURRENT_TIMESTAMP` | Row last update timestamp. |

### Indexes & Constraints

- **Unique Constraint (`ux_daily_onchain_kpi_snapshots_date_period`)**: `(snapshot_date, period)` — Ensures strict idempotency by preventing duplicate snapshots for the same period.
- **Index (`idx_daily_onchain_kpi_snapshots_snapshot_date`)**: Optimizes range queries ordered by date.
- **Index (`idx_daily_onchain_kpi_snapshots_period`)**: Optimizes filtering by period type.

---

## Duplicate Skipping Policy

When snapshot generation runs (either via the automated daily job or manual API call):
1. The service checks for an existing record matching `(snapshot_date, period)`.
2. If a record exists, creation is **skipped**, an informational log entry is emitted, and the existing snapshot is returned.
3. If no record exists, metrics are computed and persisted.

---

## Schedule & Automation

The job is scheduled in `AnalyticsScheduler` (`src/scheduler.py`) using APScheduler:
- **Trigger**: Cron trigger every day at **00:05 UTC** (`CronTrigger(hour=0, minute=5, timezone="UTC")`).
- **Job ID**: `daily_onchain_kpi_snapshot`.
- **Job Name**: `Daily On-Chain KPI Snapshot Scheduler`.

---

## API Integration

- `GET /analytics/kpis/daily-snapshots`: Query historical daily snapshots (`?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD&limit=100`).
- `POST /analytics/kpis/daily-snapshots/run`: Trigger manual snapshot calculation (`?target_date=YYYY-MM-DD&period=daily`).
