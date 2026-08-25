# Feature Lineage API

This document describes the lineage API endpoints added to the data-processing
service as part of issue #1254.  The API makes `src/lineage/feature_lineage.yaml`
queryable over HTTP so backend consumers and the data-contracts work in issue
#1073 can trace feature provenance programmatically.

---

## Why a lineage API?

`feature_lineage.yaml` and `LINEAGE.md` document how every ML feature and derived
KPI is produced from raw sources, but the information was only readable by opening
the file.  When a KPI looks wrong, tracing it back to its inputs was a manual
exercise.  These endpoints expose the same single source of truth over HTTP so
any service can query it at runtime.

---

## Base URL

```
http://localhost:8000
```

All lineage endpoints are under the `/api/lineage` prefix.

---

## Endpoints

### `GET /api/lineage`

List every registered entry (ML feature sets and KPI datasets) with a short
summary.

**No authentication required.**

**Response** — `200 OK`

```json
[
  {
    "id": "market_health_score",
    "display_name": "Market Health Score",
    "description": "Weighted combination of sentiment and normalised volume change ...",
    "owner": "data-team@lumenpulse.io",
    "source_file": "src/analytics/market_analyzer.py",
    "section": "kpi_datasets",
    "source_system": "Stellar Blockchain"
  },
  ...
]
```

**Fields**

| Field           | Type   | Description                                           |
|-----------------|--------|-------------------------------------------------------|
| `id`            | string | Unique identifier (use as `{name}` in the graph endpoint) |
| `display_name`  | string | Human-readable label                                  |
| `description`   | string | What this feature/KPI is                              |
| `owner`         | string | Owning team email or GitHub handle                    |
| `source_file`   | string | Path to the implementing module (relative to `apps/data-processing`) |
| `section`       | string | `ml_feature_sets` or `kpi_datasets`                   |
| `source_system` | string | Primary raw-data origin (e.g. `Stellar Blockchain`)   |

---

### `GET /api/lineage/{name}`

Return the full upstream/downstream lineage graph for a single entry.

`{name}` is the `id` field from the manifest (e.g. `market_health_score`,
`price_predictor_features`).

**No authentication required.**

**Response** — `200 OK`

```json
{
  "id": "market_health_score",
  "display_name": "Market Health Score",
  "description": "Weighted combination of sentiment and normalised volume change ...",
  "owner": "data-team@lumenpulse.io",
  "source_file": "src/analytics/market_analyzer.py",
  "section": "kpi_datasets",
  "source_system": "Stellar Blockchain",
  "transformation": "market_health_score = (sentiment_score × 0.7) + (tanh(volume_change) × 0.3)\n",
  "owning_module": "src/analytics/market_analyzer.py",
  "update_cadence": null,
  "storage": "in-memory + data/analytics.jsonl (append)",
  "upstream": [
    {
      "ref": "sentiment_compound",
      "label": "sentiment_compound",
      "kind": "lineage_entry"
    },
    {
      "ref": "src/ingestion/stellar_fetcher.py::get_asset_volume",
      "label": "input:volume_change",
      "kind": "module"
    },
    {
      "ref": "src/analytics/market_analyzer.py",
      "label": "source",
      "kind": "module"
    }
  ],
  "downstream": [
    {
      "ref": "src/analytics/forecaster.py",
      "label": "forecaster.py",
      "kind": "module"
    },
    {
      "ref": "src/api/server.py",
      "label": "server.py",
      "kind": "module"
    }
  ],
  "raw_entry": { ... }
}
```

**Key response fields**

| Field            | Description                                                        |
|------------------|--------------------------------------------------------------------|
| `source_system`  | Where raw data originates (Stellar Blockchain, News Feed, …)       |
| `transformation` | Mathematical formula or algorithm description                       |
| `owning_module`  | The `source_file` that computes this feature/KPI                   |
| `upstream`       | Nodes (modules, tables, other entries) that feed into this entry   |
| `downstream`     | Nodes that consume the output of this entry                        |
| `raw_entry`      | Complete original YAML entry for full detail                       |

**Upstream/downstream node fields**

| Field   | Description                                               |
|---------|-----------------------------------------------------------|
| `ref`   | Module path, table name, or manifest entry `id`           |
| `label` | Short human-readable label                                |
| `kind`  | `module` · `table` · `lineage_entry` · `external`         |

**Error — `404 Not Found`**

```json
{
  "detail": {
    "message": "No lineage entry found with id='bad_name'.",
    "valid_ids": ["price_predictor_features", "market_health_score", ...]
  }
}
```

---

### `GET /api/lineage/validate`

Run the full manifest validation and verify that every `source_file` referenced
in the manifest still exists on disk.

**No authentication required.**

**Response — `200 OK`** (all checks pass)

```json
{
  "valid": true,
  "manifest_path": "/workspaces/Lumenpulse/apps/data-processing/src/lineage/feature_lineage.yaml",
  "manifest_version": "1.0",
  "ml_feature_sets_count": 2,
  "kpi_datasets_count": 8,
  "checked_files": true,
  "issues": [],
  "missing_source_files": []
}
```

**Response — `422 Unprocessable Entity`** (validation errors found)

```json
{
  "detail": {
    "valid": false,
    "manifest_path": "...",
    "issues": [
      {
        "severity": "error",
        "message": "[kpi_datasets/market_health_score] source_file not found on disk: 'src/analytics/market_analyzer.py' — feature 'market_health_score' no longer exists."
      }
    ],
    "missing_source_files": ["src/analytics/market_analyzer.py"]
  }
}
```

The endpoint returns HTTP 422 whenever any `source_file` listed in the manifest
no longer exists on disk, satisfying acceptance criterion 4 from issue #1254.

**Validation rules applied**

1. YAML parses without errors.
2. Top-level keys `manifest_version`, `project`, `module` are present.
3. At least one `ml_feature_sets` entry and one `kpi_datasets` entry.
4. Every entry has `id`, `display_name`, `description`, `owner`, `source_file`.
5. No duplicate `id` values.
6. `owner` values are valid email addresses or `@github-handle` format.
7. Every `source_file` (and `model_file` when present) exists on disk.

---

## Interactive documentation (Swagger UI)

The full OpenAPI specification and a browser-based try-it-out UI are available
at:

```
http://localhost:8000/docs
```

An alternative ReDoc view is at:

```
http://localhost:8000/redoc
```

---

## Usage examples

```bash
# List all registered features and KPI datasets
curl http://localhost:8000/api/lineage

# Get the full lineage graph for the market health score
curl http://localhost:8000/api/lineage/market_health_score

# Get the ML feature set used by the price predictor
curl http://localhost:8000/api/lineage/price_predictor_features

# Validate the manifest and check all source files exist
curl http://localhost:8000/api/lineage/validate
```

---

## Data contracts integration (Issue #1073)

The lineage API is designed to serve as the queryable backend for the data
contracts and ownership map described in issue #1073.  Each response includes:

- **`owner`** — the team or individual responsible for this feature/KPI.
- **`source_system`** — the upstream system that provides raw data.
- **`owning_module`** — the specific file that implements the computation.
- **`upstream` nodes** — the full dependency chain up to raw sources.
- **`downstream` nodes** — every consumer of this feature/KPI.

A data-contract CI check can call `GET /api/lineage/validate` and gate on a
`200` response to ensure the manifest never drifts from the actual codebase.

---

## Single source of truth

All three endpoints read directly from `src/lineage/feature_lineage.yaml`.
No separate database or cache is involved.  To register a new feature or KPI,
update the YAML; the API reflects the change immediately on the next request.

See `LINEAGE.md` for the full contributor guide including how to add entries,
update formulas, and deprecate old features.
