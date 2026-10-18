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

## Price prediction ensembles

`POST /price/predict` accepts a numeric `features` object and an optional
`schema_version`. The promoted price ensemble averages the successfully
serving members equally; member failures are returned as failure records and
the remaining members are re-weighted. The response and prediction log include
each member's prediction, contribution, weight, and status. If all members
fail, the endpoint returns an error rather than a fabricated prediction.

```json
{
  "features": {"feature_a": 0.25, "feature_b": 12.0},
  "schema_version": "1.0"
}
```

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