# Sentiment Analysis API

FastAPI server that exposes sentiment analysis for Node.js backend integration.

## Starting the API

### Option 1: Direct command
```bash
cd data-processing
python -m uvicorn src.api.server:app --host 0.0.0.0 --port 8000 --reload
```
---

## Pipeline Topology (`GET /api/pipeline/topology`)

Returns the scheduled data-processing pipeline so the backend can ask the
service **what runs, on what schedule, what each stage depends on, and whether a
stage is stale** — instead of reading `src/scheduler.py`.

- **Method / path:** `GET /api/pipeline/topology`
- **Auth:** same as the other service endpoints (`X-API-Key` header where API
  keys are enforced).
- **Source of truth:** the stage set and schedules mirror the jobs registered by
  `AnalyticsScheduler` (`src/scheduler.py`); a test asserts the ids stay in
  sync, so the topology cannot drift from the scheduler configuration.
- **Run status:** the scheduler process records each stage's last run, duration
  and outcome via an APScheduler listener into the pipeline run registry
  (`src/pipeline_run_registry.py`, path configurable with
  `PIPELINE_RUN_STATE_PATH`); this endpoint reads it.

### Response

```json
{
  "generated_at": "2026-09-29T12:00:00+00:00",
  "stages": [
    {
      "id": "model_retraining_daily",
      "name": "Automated Model Retraining - Daily",
      "schedule": "Daily at 02:00 UTC",
      "depends_on": ["market_analyzer_hourly"],
      "status": "success",
      "last_run": "2026-09-29T02:00:04+00:00",
      "duration_seconds": 41.2,
      "outcome": "success",
      "error": null
    }
  ]
}
```

### Stage `status` values

| Status | Meaning |
| --- | --- |
| `never_run` | No run has been recorded for this stage yet (distinct from a failure). |
| `running` | The stage was submitted and has not reported a result yet. |
| `success` | The most recent run completed successfully. |
| `failed` | The most recent run raised an error (see `error`). |

`last_run`, `duration_seconds`, `outcome` and `error` are `null` until the stage
has run at least once. Because a never-run stage reports `never_run` (not
`failed`), the backend can tell a stage that failed apart from one that has
simply not run yet.