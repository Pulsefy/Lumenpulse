# Model Health / SLO Contract (#1647)

This document specifies the model health contract exposed by the
data-processing service and consumed by the Node.js backend so that
predictions are only surfaced when the model is trustworthy.

## Motivation

The backend surfaces predictions from the data-processing (Python) service
with no quality signal attached. A model may currently be:

* drifting (feature distribution shifted from training),
* running on a stale snapshot (calibration out of date), or
* operating on out-of-distribution / stale input data.

This contract reports per-model SLO health so the backend can decide whether
to surface a prediction, and raises alerts when a model transitions into a
degraded or unavailable state.

## Endpoint

**GET** `<PYTHON_API_URL>/model/health`

The data-processing service exposes this at `GET /model/health`. It requires
the `X-API-Key` header. The backend proxies it at `GET /health/models`
(`src/health/health.controller.ts`).

## Response

```json
{
  "checked_at": "2026-10-16T13:00:00.000Z",
  "models": {
    "sentiment": {
      "model_type": "sentiment",
      "live_version": "v1.1",
      "drift": {
        "state": "trustworthy",
        "detail": "no drift beyond threshold",
        "value": null
      },
      "calibration_age": {
        "state": "trustworthy",
        "detail": "calibrated 60s ago",
        "value": 60
      },
      "data_freshness": {
        "state": "trustworthy",
        "detail": "all data feeds within freshness SLA",
        "value": 10
      },
      "overall": "trustworthy",
      "checked_at": "2026-10-16T13:00:00.000Z",
      "transitioned_to_degraded": false
    },
    "price_predictor": {
      ...
    }
  }
}
```

### Fields

| Field | Type | Meaning |
|---|---|---|
| `checked_at` | ISO-8601 UTC | Time this report was generated. |
| `models.<model_type>.model_type` | string | Model type identifier (e.g. `sentiment`, `price_predictor`). |
| `models.<model_type>.live_version` | string \| null | Currently promoted model version from the registry, or `null` when none is live. |
| `models.<model_type>.drift` | signal | Feature-distribution / schema drift state. |
| `models.<model_type>.calibration_age` | signal | Age of the last completed retraining run. |
| `models.<model_type>.data_freshness` | signal | Freshness of the ingestion feeds the model consumes. |
| `models.<model_type>.overall` | string | Worst of `drift`, `calibration_age`, `data_freshness`; `unavailable` when no live version exists. |
| `models.<model_type>.checked_at` | ISO-8601 UTC | Time this model was assessed. |
| `models.<model_type>.transitioned_to_degraded` | boolean | `true` when this assessment moved the model into a non-trustworthy state since the last assessment. |

### Signal shape

Each signal is:

```json
{
  "state": "trustworthy" \| "degraded" \| "unavailable",
  "detail": "human-readable explanation",
  "value": null \| number \| string[]
}
```

`value` carries structured context where useful (e.g. the drifted feature
names, the calibration age in seconds, the feed age in seconds).

### Signal classification

| Signal | trustworthy | degraded | unavailable |
|---|---|---|---|
| `drift` | PSI below threshold and no schema mismatch | PSI >= threshold or schema mismatch | drift check errored or no baseline recorded |
| `calibration_age` | within `MODEL_CALIBRATION_MAX_AGE_SECONDS` | exceeds the max age | no completed retraining run / no timestamp |
| `data_freshness` | all feeds healthy | at least one feed warning | at least one feed critical / unknowable |
| `overall` | all signals trustworthy | worst signal degraded (or no live version) | any signal unavailable or no live version |

## Backend consumption

The backend consumes `GET /health/models` via `HealthService.getModelHealthReport()`
(`src/health/health.service.ts`). A model whose `overall` is not `trustworthy`
should be treated as a degraded prediction signal: surface it with a quality
warning or withhold it entirely, depending on product policy.

When `transitioned_to_degraded` is `true`, the data-processing service has
already raised an alert through the Wave 9 / backend notification path
(`POST /notifications/drift-alerts`, HMAC-signed). The backend persists that
alert as a `DRIFT` notification via `DriftAlertIngestionService`.

## Alerting (Wave 9 notification path)

Transitions into `degraded` or `unavailable` raise an alert through
`src/notifications/drift_alert_dispatcher.py` →
`BackendNotificationClient.send_drift_alert()` →
`POST {BACKEND_URL}/notifications/drift-alerts` (HMAC-signed,
retried, spooled to disk on failure).

Severity mapping:

* `overall == unavailable` → `critical`
* `overall == degraded` → `warning` → backend `high`

## State persistence & transition detection

The monitor persists the last known per-model state to
`MODEL_HEALTH_STATE_PATH` (default `./data/model_health_states.json`) so
transitions are detected across restarts. An alert is raised only on the
transition into a non-trustworthy state, not on every assessment while the
state persists.

## Configuration

| Env var | Default | Meaning |
|---|---|---|
| `MODEL_HEALTH_STATE_PATH` | `./data/model_health_states.json` | Persisted state file for transition detection. |
| `MODEL_CALIBRATION_MAX_AGE_SECONDS` | `604800` (7 days) | Max age of a completed retraining run before `degraded`. |
| `FEATURE_DRIFT_PSI_THRESHOLD` | `0.25` | PSI threshold for feature drift (drift detector). |
| `PYTHON_API_URL` / `PYTHON_API_KEY` | — | Backend client config for calling the Python service. |
| `BACKEND_NOTIFICATION_URL` / `DRIFT_ALERT_INGEST_SECRET` | — | Backend notification ingestion config (Wave 9 path). |

## Integration points (data-processing)

* `src/ml/model_health.py` — `ModelHealthMonitor`, `get_model_health()`.
* `GET /model/health` in `src/api/server.py` (`ModelHealthResponse`).
* Tests: `tests/test_model_health.py`.

## Integration points (backend)

* `HealthService.getModelHealthReport()` — `src/health/health.service.ts`.
* `GET /health/models` — `src/health/health.controller.ts`.
* Types: `ModelHealthSignal`, `ModelHealthSnapshot`, `ModelHealthReport` in `health.service.ts`.
* Tests: `src/health/health.service.spec.ts`.
