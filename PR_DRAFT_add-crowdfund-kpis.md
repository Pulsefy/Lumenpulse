PR Title: Add crowdfund KPI computation, persistence, API endpoint, and tests

Related Issue: #734 Compute Protocol KPIs (TVL, Volume) from Crowdfund Vault Events

Summary
-------
This PR introduces a lightweight, idempotent processor for computing protocol-level KPIs (TVL and cumulative deposit volume) from Crowdfund Vault events. It includes JSONL persistence for the computed time-series and an HTTP API for backend consumption.

What changed
------------
- Added KPI computation module: [apps/data-processing/src/analytics/crowdfund_metrics.py](apps/data-processing/src/analytics/crowdfund_metrics.py)
- Exposed persisted KPIs via API: [apps/data-processing/src/api/server.py](apps/data-processing/src/api/server.py) (new route `GET /crowdfund/metrics`)
- Unit tests: [apps/data-processing/tests/unit/test_crowdfund_metrics.py](apps/data-processing/tests/unit/test_crowdfund_metrics.py)

Files of interest
-----------------
- [apps/data-processing/src/analytics/crowdfund_metrics.py](apps/data-processing/src/analytics/crowdfund_metrics.py)
- [apps/data-processing/src/api/server.py](apps/data-processing/src/api/server.py#L1-L300)
- [apps/data-processing/tests/unit/test_crowdfund_metrics.py](apps/data-processing/tests/unit/test_crowdfund_metrics.py)

Behavior & assumptions
----------------------
- Input event schema expected: `id`, `type` (`deposit`|`withdraw`), `project_id`, `amount`, `timestamp` (ISO), optional `correction_of`.
- Idempotency: duplicate event `id` values are ignored.
- Corrections: events with `correction_of` reverse the original event (if seen) and apply the corrected event.
- TVL is computed as the sum of per-project balances; negative balances are floored to zero to tolerate out-of-order messages.
- Persistence location: `apps/data-processing/data/crowdfund_metrics.jsonl` (JSON Lines)

How to test locally
--------------------
1) Setup Python venv and install deps:
```powershell
cd apps/data-processing
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

2) Run the unit test for KPI logic:
```powershell
pytest tests/unit/test_crowdfund_metrics.py -q
```

3) Run a quick manual ingestion script (example):
```python
from src.analytics.crowdfund_metrics import compute_kpis_from_events, persist_series

events = [
  {"id":"e1","type":"deposit","project_id":1,"amount":100.0,"timestamp":"2024-01-01T00:00:00Z"},
  {"id":"e2","type":"withdraw","project_id":1,"amount":30.0,"timestamp":"2024-01-01T01:00:00Z"},
  {"id":"e3","type":"deposit","project_id":1,"amount":120.0,"timestamp":"2024-01-01T02:00:00Z","correction_of":"e1"},
]

series = compute_kpis_from_events(events)
persist_series(series)
print(series)
```

4) Start API and fetch persisted series:
```powershell
uvicorn src.api.server:app --host 0.0.0.0 --port 8000 --reload
curl http://localhost:8000/crowdfund/metrics
```

Reviewer checklist
------------------
- [ ] Confirm event schema and correction semantics match indexer output.
- [ ] Validate idempotency logic for duplicate events.
- [ ] Review persistence strategy (JSONL file vs DB) for production suitability.
- [ ] Ensure API route and CORS/security boundaries are acceptable.

Notes / Next steps
-----------------
- Production: replace file-based persistence with a durable store (Postgres / S3) and add retention/rotation.
- Add an ingestion adapter to map Soroban/Horizon events to the expected event schema and run `compute_kpis_from_events` in the indexer pipeline.
- Add Prometheus metrics and observability for the KPI job.

If you want I can open a PR branch & push these commits, or implement the ingestion adapter that wires Horizon/Soroban events into `compute_kpis_from_events`.
