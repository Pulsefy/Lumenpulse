# Metadata Drift Detector (#882)

## Goal
Detect when off-chain backend metadata (`ProjectView`, `ProjectMilestone`)
falls out of sync with on-chain identifiers or status.

## How it works
`ContractEvent` rows are the raw, immutable record of events ingested from
the Soroban RPC event stream — the closest thing this service has to
ground-truth on-chain state. `ProjectView` and `ProjectMilestone` are
mutable "materialized view" tables that get incrementally updated as events
arrive (see `PostgresService.save_project_view` / `save_project_milestone`).

`src/metadata_drift_detector.py` recomputes canonical project/milestone
state directly from the `ContractEvent` log (independent of however the
materialized views were last updated) and diffs it against what's currently
persisted. Any mismatch indicates drift — e.g. a missed event, a bug in
incremental update logic, or a partial write.

Compared fields:
- **Project**: `status`, `total_contributions`, `unique_contributors`,
  `last_event_ledger` (staleness only), and whether a `ProjectView` row
  exists at all.
- **Milestone**: `status`, and whether a `ProjectMilestone` row exists for
  every milestone observed in the event log.

## Acceptance criteria mapping
- **Compares selected backend records against chain-derived state** —
  `MetadataDriftDetector.run_for_project` / `run_all`.
- **Produces actionable drift reports** — findings are returned as a
  `DriftReport` and persisted to the `metadata_drift_findings` table (with
  `reviewed` / `reviewed_by` / `review_notes` fields, consistent with the
  existing `RoundAnomalySignal` review workflow).
- **Supports scheduled and manual execution** — registered as a 6-hourly
  APScheduler job (`metadata_drift_detection` in `src/scheduler.py`) and
  exposed as a CLI script (`scripts/detect_metadata_drift.py`).
- **Does not mutate source data automatically** — the detector only reads
  `ContractEvent`, `ProjectView`, and `ProjectMilestone`; it never writes to
  them. Findings are written exclusively to the separate
  `metadata_drift_findings` table. See
  `tests/test_metadata_drift_detector.py::test_does_not_mutate_source_records`.

## Usage

```bash
# Check every project that has at least one ingested contract event
python scripts/detect_metadata_drift.py

# Check a single project
python scripts/detect_metadata_drift.py --project-id 101

# Preview findings without persisting them
python scripts/detect_metadata_drift.py --no-persist --json
```

Programmatically:

```python
from src.metadata_drift_detector import MetadataDriftDetector

detector = MetadataDriftDetector()
report = detector.run_and_persist()  # all known projects
print(report.to_dict())
```

## Reviewing findings

```python
from src.db.postgres_service import PostgresService

service = PostgresService()
findings = service.get_metadata_drift_findings(reviewed=False, severity="critical")
service.mark_metadata_drift_finding_reviewed(findings[0].id, reviewed_by="maintainer")
```

## Limitations / follow-ups
- Drift is derived from the locally ingested `ContractEvent` log, not a live
  Soroban RPC read. If event ingestion itself has gaps, this detector won't
  catch them (that's covered by the separate ingestion quality checks in
  `src/ingestion/stellar_ingestion_checks.py`). A future iteration could add
  an optional live-RPC spot-check mode for higher assurance.
- `last_event_ledger` drift is only flagged when the backend is *behind* the
  chain-derived ledger (staleness), not when it's ahead, since a backend
  legitimately may have ingested events not yet reflected in a partial
  ContractEvent backfill window.
