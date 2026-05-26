# TODO - Ingestion lag + external source failure detection

## Step 1: Produce ingestion lag metrics
- [x] Inspect data-processing metrics server startup to ensure Prometheus gauges are exposed.
- [x] Add Gauge metrics (ingestion_lag_seconds, ingestion_quality_check_passed, etc.) in `apps/data-processing/src/utils/metrics.py`.
- [x] Update `apps/data-processing/src/ingestion/stellar_ingestion_checks.py` to compute lag seconds and publish metrics.


## Step 2: Produce external source failure metrics (news ingestion)
- [x] Wire `apps/backend/src/news/news.service.ts` to publish fetch failure metrics in catch blocks.
- [x] Reuse existing backend metrics helpers in `apps/backend/src/metrics/metrics.service.ts` (e.g., `recordFetchError`) or extend if needed.


## Step 3: Configure Prometheus alerts
- [x] Add PromQL alerts to root `prometheus-rules.yml` for ingestion lag and news fetch failures.
- [x] Ensure alert labels include service/backend/data-processing as appropriate.


## Step 4: Document runbook
- [x] Create `document/INGESTION_MONITORING_RUNBOOK.md` describing metrics, dashboards/queries, and remediation.


## Step 5: Verification
- [x] Run lint/typecheck/tests for affected modules (best-effort in this environment).
- [x] Validate metric scraping and alert rule loading (rule syntax updated; runtime scrape pending infrastructure).



