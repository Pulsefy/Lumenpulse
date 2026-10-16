# Sentiment Analysis API

FastAPI server that exposes sentiment analysis for Node.js backend integration.

## Out-of-distribution input handling

`POST /analyze` checks lexical support before invoking VADER. The default
threshold is `ANALYZE_OOD_MAX_UNKNOWN_TOKEN_RATIO=0.75`: if more than 75% of
the input's word tokens are absent from VADER's sentiment lexicon, its
modifier/negation vocabulary, common-English words, and known crypto
project/ticker names, the text is not scored. Inputs without word tokens are
also rejected. Configure the threshold from `0` to `1`; a lower value is
stricter. Invalid values prevent the service from starting rather than silently
disabling the check.

An out-of-distribution response has `status: "out_of_distribution"`,
`scored: false`, `sentiment: null`, and `sentiment_label: "unscored"`.
`confidence` is the fraction of recognized tokens, not a calibrated
probability. Scored responses include `status: "scored"`, `scored: true`, and
the same lexical-support confidence alongside the normal sentiment fields.

The batch endpoint applies the same check to each text. Rejected entries are
returned with `status: "out_of_distribution"` and are excluded from sentiment
summaries.

### Threshold calibration and false-positive rate

Before changing the threshold, evaluate it against a representative, labeled
held-out sample of in-distribution texts using
`src.ml.ood_detector.false_positive_rate(detector, texts)`. The measured false
positive rate is the fraction of those known in-distribution examples rejected
at the configured threshold; it depends on the sample, so validate on data
representative of your clients before deployment. The lexical-support
confidence is an OOD heuristic, not a statistical confidence estimate.

```python
from vaderSentiment.vaderSentiment import BOOSTER_DICT, NEGATE, SentimentIntensityAnalyzer
from src.ml.ood_detector import (
    LexicalOODDetector,
    configured_unknown_token_ratio,
    false_positive_rate,
)

vader = SentimentIntensityAnalyzer()
vocabulary = set(vader.lexicon) | set(BOOSTER_DICT) | set(NEGATE)
detector = LexicalOODDetector(vocabulary, configured_unknown_token_ratio())
measured_fpr = false_positive_rate(detector, held_out_in_distribution_texts)
```

### Monitoring

Prometheus exports `lumenpulse_inference_requests_total` and
`lumenpulse_inference_ood_total`, both labeled by `endpoint` (`/analyze` or
`/analyze-batch`). The OOD fraction can be monitored per endpoint with:

```promql
sum by (endpoint) (rate(lumenpulse_inference_ood_total[5m]))
/
sum by (endpoint) (rate(lumenpulse_inference_requests_total[5m]))
```

## Starting the API

### Option 1: Direct command
```bash
cd data-processing
python -m uvicorn src.api.server:app --host 0.0.0.0 --port 8000 --reload
```
---

## Prediction audit exports

Prediction audit exports join the prediction log to the model card and
registry metadata for its exact model version. The database must be migrated
through revision `013` before deploying these endpoints.

- `GET /model/prediction-audits/{prediction_id}` retrieves one record by its
  numeric database ID or its request ID.
- `GET /model/prediction-audits?subject_id=...` retrieves records for a
  subject; `start_time` and `end_time` may be supplied together for an
  inclusive time range. Use `limit` (capped at 1000) and `offset` to page
  through the results.
- `GET /model/prediction-audit-exports` lists durable records of prior exports.

Prediction producers should pass `subject_id` and structured `feature_values`
to `_log_prediction()`. Subject IDs are scrubbed and hashed before persistence;
feature values are scrubbed before persistence and export. Export responses
never include `raw_input`. Each completed export is written to
`prediction_audit_exports` in the same database transaction as the log query.

### Worked example: a flagged contribution

Suppose a contribution risk prediction is logged with request ID `req-7f21`,
subject ID `contribution-8472`, model version `v2.3`, and features
`{"amount": 1250, "account_age_days": 4}`. The output records
`{"flagged": true, "reason": "new_account_large_amount"}`. Retrieve that
subject's audit trail:

```http
GET /model/prediction-audits?subject_id=contribution-8472
X-API-Key: <service-key>
```

The entry includes the prediction ID, model version, scrubbed feature values,
input hash, matching `v2.3` model card, and its training snapshot reference.
For example, the card can identify the feature schema and held-out metrics,
while `training_snapshot.snapshot_id` locates the training dataset snapshot
used to register that model. The export response's `export_id` is recorded
alongside the hashed subject filter and result count, and can be confirmed via
`GET /model/prediction-audit-exports`.

The relevant portion of the assembled entry looks like this:

```json
{
  "prediction_id": "1842",
  "request_id": "req-7f21",
  "model_type": "contribution_risk",
  "model_version": "v2.3",
  "input_hash": "<sha256-of-scrubbed-input>",
  "feature_values": {"amount": 1250, "account_age_days": 4},
  "output": {"flagged": true, "reason": "new_account_large_amount"},
  "model_card": {
    "version": "v2.3",
    "feature_schema": {"version": "1.0"},
    "metrics": {"r2_score": 0.91}
  },
  "training_snapshot": {
    "snapshot_id": "training_20260301_020000_ab12cd34",
    "snapshot_hash": "<sha256-of-snapshot>"
  }
}
```

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