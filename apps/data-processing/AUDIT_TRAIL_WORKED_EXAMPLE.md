# Prediction Audit Trail — Worked Example

**Issue #1639 · Wave 10**

> **Question:** "Why did the system flag this contribution in March?"

This document traces one flagged Lumenpulse contribution (a negative-sentiment
flag on an XLM project post) end-to-end through the audit trail, showing
exactly how to call the export API and how to read the assembled response.

---

## 1. Context

| Store | What it holds | When written |
|---|---|---|
| `prediction_logs` (Postgres) | `request_id`, `model_type`, `model_version`, `input_hash`, `output`, `latency_ms`, `created_at` | At inference time (Wave 8) |
| `<version>.meta.json` (model registry) | Training metrics, schema version, data query bounds, seed, library versions | At training time (Wave 9) |
| `<version>.card.json` (model registry) | Training data info, hyperparameters, evaluation metrics, provenance | At training time (Wave 9) |

The audit-trail export joins these three sources for a single prediction.

---

## 2. Scenario

On **15 March 2026** at 09:00 UTC the system analysed a social post
mentioning XLM and emitted a `negative` sentiment score of **−0.62**,
flagging the associated contribution.

The correlation/request ID logged at the time was:
```
req-march-flagged-001
```

---

## 3. Step 1 — Retrieve by prediction ID

```bash
curl -s \
  -H "X-API-Key: $INTERNAL_API_KEY" \
  "http://data-processing:8000/model/audit-trail/prediction/req-march-flagged-001" \
  | jq .
```

**Response (abbreviated):**

```json
{
  "query_type": "prediction_id",
  "total": 1,
  "records": [
    {
      "prediction": {
        "request_id": "req-march-flagged-001",
        "model_type": "sentiment",
        "model_version": "v2.3",
        "input_hash": "e4d909c290d0fb1ca068ffaddf22cbd0...",
        "output": {
          "sentiment": -0.62,
          "asset_codes": ["XLM"],
          "sentiment_label": "negative"
        },
        "latency_ms": 55.0,
        "created_at": "2026-03-15T09:00:00+00:00",
        "raw_input": "[REDACTED]"
      },
      "model": {
        "model_type": "sentiment",
        "model_version": "v2.3",
        "registry_metadata": {
          "schema_version": "2",
          "metrics": { "mse": 0.009, "r2": 0.97 },
          "feature_names": ["sentiment_score", "volume", "volatility"]
        }
      },
      "model_card": {
        "version": "v2.3",
        "training_data": {
          "row_count": 12000,
          "data_start_date": "2025-11-01",
          "data_end_date": "2026-01-31",
          "description": "Extended with DeFi / Soroban terms"
        },
        "hyperparameters": { "params": {} },
        "metrics": { "r2_score": null, "additional_metrics": {} },
        "source_code_commit": "abc123def",
        "training_script": "retraining_pipeline.py",
        "created_by": "retraining_pipeline"
      },
      "privacy": {
        "input_hash_algorithm": "sha256_of_scrubbed_input",
        "raw_input_included": false,
        "raw_input_policy": "redacted_per_wave9_policy",
        "output_scrubbed_at_log_time": true
      },
      "assembled_at": "2026-10-19T17:00:00+00:00"
    }
  ],
  "export_run_logged": true
}
```

### Reading the answer

| Question | Where to look | Answer |
|---|---|---|
| Which model flagged it? | `prediction.model_version` | `v2.3` |
| What did the model see? | `prediction.input_hash` | SHA-256 of scrubbed input |
| What score was emitted? | `prediction.output.sentiment` | `−0.62` |
| What asset was tagged? | `prediction.output.asset_codes` | `["XLM"]` |
| When was the model trained? | `model_card.training_data.data_end_date` | `2026-01-31` |
| How many examples was it trained on? | `model_card.training_data.row_count` | `12 000` |
| Was the training data extended? | `model_card.training_data.description` | Yes — DeFi/Soroban terms added |
| Which code produced the model? | `model_card.source_code_commit` | `abc123def` |
| Were the features drifted? | `model.registry_metadata.schema_version` | `"2"` — check against serving schema |

---

## 4. Step 2 — Find all XLM flags in March 2026 (time-range query)

```bash
curl -s \
  -H "X-API-Key: $INTERNAL_API_KEY" \
  "http://data-processing:8000/model/audit-trail/time-range?\
start=2026-03-01T00:00:00Z\
&end=2026-03-31T23:59:59Z\
&model_type=sentiment" \
  | jq '.total, .records[].prediction.output.sentiment_label'
```

---

## 5. Step 3 — Find all XLM-related predictions (subject query)

```bash
curl -s \
  -H "X-API-Key: $INTERNAL_API_KEY" \
  "http://data-processing:8000/model/audit-trail/subject?subject=XLM&model_type=sentiment" \
  | jq '.total'
```

---

## 6. Personal data handling

| Field | Treatment |
|---|---|
| `prediction.input_hash` | SHA-256 of the **scrubbed** input — cannot be reversed |
| `prediction.raw_input` | `[REDACTED]` unless `LOG_PREDICTION_RAW_INPUT=true` **and** caller carries `audit:raw_input` scope |
| `prediction.output` | Scrubbed at log time; no further treatment required |
| `privacy.output_scrubbed_at_log_time` | Always `true` — confirms Wave 9 scrubbing was applied |

---

## 7. Export run audit

Every call to the audit trail endpoints creates a row in `audit_export_runs`:

```sql
SELECT query_type, query_params, row_count, status, created_at
FROM audit_export_runs
ORDER BY created_at DESC
LIMIT 10;
```

The `export_run_logged: true` flag in every response confirms the run was
recorded.

---

## 8. Endpoints summary

| Endpoint | Query mode | Use when … |
|---|---|---|
| `GET /model/audit-trail/prediction/{request_id}` | Single prediction ID | You have the correlation ID from logs or an alert |
| `GET /model/audit-trail/subject?subject=XLM` | Subject label | You want all predictions related to an asset or contributor |
| `GET /model/audit-trail/time-range?start=…&end=…` | Date window | You're investigating a period (e.g. "all March flags") |

All endpoints require `X-API-Key` authentication.
