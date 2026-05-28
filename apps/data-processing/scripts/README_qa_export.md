# QA Dataset Export — Issue #742

Repeatable exports of raw events, materialized views, and KPIs for QA and contributor debugging.

## Quick Start

```bash
# Export all datasets for ledger range 1000–2000
python scripts/export_qa_datasets.py --start-ledger 1000 --end-ledger 2000

# Custom output directory
python scripts/export_qa_datasets.py --start-ledger 1000 --end-ledger 2000 --output-dir /tmp/qa

# Export only events and KPIs
python scripts/export_qa_datasets.py --start-ledger 1000 --end-ledger 2000 --datasets events kpis

# Override database URL
python scripts/export_qa_datasets.py --start-ledger 1000 --end-ledger 2000 \
  --database-url postgresql://user:pass@host:5432/lumenpulse
```

The script reads `DATABASE_URL` from the environment if `--database-url` is not provided.

## Output Files

Three JSON files are written to `--output-dir` (default: `exports/qa/`):

| File | Contents |
|------|----------|
| `events_<start>_<end>.json` | Raw contract events (`AnalyticsRecord` rows with `record_type='event'`) |
| `views_<start>_<end>.json` | Materialized views: aggregated articles, social posts, and analytics records |
| `kpis_<start>_<end>.json` | Asset KPIs from `AssetTrend` rows |

## Envelope Schema

Every file shares the same top-level envelope:

```json
{
  "status": "completed",
  "exported_at": "2024-01-01T00:00:00+00:00",
  "start_ledger": 1000,
  "end_ledger": 2000,
  "dataset": "events",
  "count": 42,
  "records": [ ... ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | Always `"completed"` on success |
| `exported_at` | ISO-8601 | UTC timestamp of export |
| `start_ledger` | int | Inclusive start of ledger range |
| `end_ledger` | int | Inclusive end of ledger range |
| `dataset` | string | `"events"`, `"views"`, or `"kpis"` |
| `count` | int | Total number of records exported |
| `records` | array/object | Dataset-specific payload (see below) |

## Record Schemas

### events — `records` is an array

```json
{
  "id": 1,
  "record_type": "event",
  "asset": "XLM",
  "metric_name": "contract_call",
  "window": null,
  "value": 1.0,
  "previous_value": null,
  "change_percentage": null,
  "trend_direction": null,
  "extra_data": { "ledger": 1500 },
  "timestamp": "2024-01-01T00:00:00+00:00"
}
```

Rows are filtered to `record_type = 'event'` and, when the `extra_data.ledger` field is present, to the requested ledger range.

### views — `records` is an object with three keys

```json
{
  "articles": [
    {
      "article_id": "art-1",
      "title": "XLM surges",
      "source": "cryptonews",
      "primary_asset": "XLM",
      "sentiment_score": 0.7,
      "sentiment_label": "positive",
      "published_at": "2024-01-01T00:00:00+00:00"
    }
  ],
  "social_posts": [
    {
      "post_id": "post-1",
      "platform": "twitter",
      "primary_asset": "XLM",
      "sentiment_score": 0.5,
      "sentiment_label": "positive",
      "posted_at": "2024-01-01T00:00:00+00:00"
    }
  ],
  "analytics_records": [
    {
      "id": 2,
      "record_type": "sentiment_summary",
      "asset": "XLM",
      "metric_name": "sentiment_score",
      "window": "24h",
      "value": 0.65,
      "timestamp": "2024-01-01T00:00:00+00:00"
    }
  ]
}
```

`count` in the envelope is the sum of all three sub-arrays.

### kpis — `records` is an array

```json
{
  "id": 1,
  "asset": "XLM",
  "metric_name": "sentiment_score",
  "window": "24h",
  "trend_direction": "up",
  "score": 0.8,
  "current_value": 0.5,
  "previous_value": 0.3,
  "change_percentage": 66.7,
  "extra_data": {},
  "timestamp": "2024-01-01T00:00:00+00:00"
}
```

## Python API

```python
from src.qa_exporter import QAExporter

exporter = QAExporter(start_ledger=1000, end_ledger=2000, output_dir="exports/qa")

# Export individually
result = exporter.export_events()   # → ExportResult(dataset, path, count, status)
result = exporter.export_views()
result = exporter.export_kpis()

# Or export all at once
results = exporter.run()            # → List[ExportResult]
```

## Running Tests

```bash
pytest tests/test_qa_exporter.py -v
```
