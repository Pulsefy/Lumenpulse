# Ledger-Range Export — Issue #883

Repeatable export of raw Soroban contract events and normalized project state for a given Stellar ledger range. Intended for **incident debugging** by maintainers.

## Quick Start

```bash
# Export all data for ledger range 1000–2000
python scripts/export_ledger_range.py --start-ledger 1000 --end-ledger 2000

# Custom output directory
python scripts/export_ledger_range.py --start-ledger 1000 --end-ledger 2000 \
    --output-dir /tmp/incident_exports

# Single-ledger export
python scripts/export_ledger_range.py --start-ledger 1500 --end-ledger 1500

# Override database URL
python scripts/export_ledger_range.py --start-ledger 1000 --end-ledger 2000 \
    --database-url postgresql://user:pass@host:5432/lumenpulse
```

The script reads `DATABASE_URL` from the environment if `--database-url` is not provided.

## Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `--start-ledger` | int | ✓ | First ledger number, inclusive |
| `--end-ledger` | int | ✓ | Last ledger number, inclusive |
| `--output-dir` | string | | Output directory (default: `exports/ledger`) |
| `--database-url` | string | | Overrides `DATABASE_URL` env var |

Validation rules:
- Both ledgers must be non-negative integers.
- `start_ledger` must be ≤ `end_ledger`.
- `start_ledger == end_ledger` is valid (single-ledger export).

## Output File

A single JSON file is written:

```
<output-dir>/ledger_export_<start>_<end>.json
```

Example: `exports/ledger/ledger_export_1000_2000.json`

### Top-Level Structure

```json
{
  "metadata": {
    "startLedger": 1000,
    "endLedger": 2000,
    "exportTimestamp": "2026-06-25T12:00:00+00:00",
    "exportVersion": "1"
  },
  "raw": [ ... ],
  "normalized": {
    "project_views": [ ... ],
    "project_contributors": [ ... ],
    "project_milestones": [ ... ]
  }
}
```

### `metadata`

| Field | Type | Description |
|-------|------|-------------|
| `startLedger` | int | Inclusive start of the requested range |
| `endLedger` | int | Inclusive end of the requested range |
| `exportTimestamp` | ISO-8601 | UTC time of export run |
| `exportVersion` | string | Schema version (`"1"`) |

### `raw` — array of ContractEvent rows

Each object represents one raw Soroban event whose `ledger` column falls in `[startLedger, endLedger]`:

```json
{
  "id": 1,
  "contract_id": "CABC...",
  "event_id": "evt-1",
  "ledger": 1500,
  "event_type": "contribution",
  "project_id": 42,
  "contributor": "GBOB...",
  "amount": 100.0,
  "milestone_id": null,
  "status": "active",
  "topics": [],
  "raw_data": { "key": "value" },
  "timestamp": "2024-01-01T00:00:00+00:00"
}
```

### `normalized` — object with three arrays

Normalized rows are matched by their `last_event_ledger` / `last_contribution_ledger` column:

#### `project_views`

Rows from `project_views` where `last_event_ledger` is in range:

```json
{
  "id": 1,
  "project_id": 42,
  "contract_id": "CABC...",
  "owner": "GALICE...",
  "total_contributions": 100.0,
  "unique_contributors": 1,
  "status": "active",
  "last_event_ledger": 1500,
  "extra_data": {}
}
```

#### `project_contributors`

Rows from `project_contributors` where `last_contribution_ledger` is in range:

```json
{
  "id": 1,
  "project_id": 42,
  "contributor": "GBOB...",
  "total_contributed": 100.0,
  "first_contribution_ledger": 1500,
  "last_contribution_ledger": 1500,
  "extra_data": {}
}
```

#### `project_milestones`

Rows from `project_milestones` where `last_event_ledger` is in range:

```json
{
  "id": 1,
  "project_id": 42,
  "milestone_id": 1,
  "status": "pending",
  "approved_at": null,
  "last_event_ledger": 1500,
  "extra_data": {}
}
```

## Intended Debugging Workflow

1. Identify the approximate ledger range of an incident (e.g., from monitoring alerts or Stellar explorer).
2. Run the export:
   ```bash
   python scripts/export_ledger_range.py --start-ledger <start> --end-ledger <end>
   ```
3. Inspect `raw` to see exactly which contract events arrived in that window.
4. Compare `normalized` against expected project state — mismatches between raw events and normalized output indicate a processing bug.
5. Re-run as many times as needed; the tool never modifies source data and always overwrites the output file with a fresh snapshot.

## Python API

```python
from src.ledger_export import LedgerRangeExporter

exporter = LedgerRangeExporter(
    start_ledger=1000,
    end_ledger=2000,
    output_dir="exports/ledger",
)
result = exporter.export()
# result.path, result.raw_count, result.normalized_counts, result.status
```

## Running Tests

```bash
pytest tests/test_ledger_export.py -v
```

## Limitations

- **Normalized coverage**: `project_views` and `project_milestones` are matched by `last_event_ledger`; `project_contributors` by `last_contribution_ledger`. Rows updated by earlier ledgers whose last-ledger pointer falls outside the range will not appear, even if they were affected by events within the range.
- **No DB required for tests**: All tests use mocks; a live database is only needed for actual incident debugging.
- **Large ranges**: Rows are loaded entirely into memory. For very large ranges (millions of events), increase available memory or narrow the range.
