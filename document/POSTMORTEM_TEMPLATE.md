# Incident Postmortem Template

**Version**: 1.0.0
**Audience**: On-call engineers, incident leads, and maintainers
**Purpose**: Provide a consistent, reusable structure for documenting incident postmortems so that every incident produces actionable learnings and traceable follow-up tasks.

> **How to use this template**: Copy this file, rename it to `POSTMORTEM-<YYYY-MM-DD>-<short-title>.md`, place it under `document/postmortems/`, and fill in every section. Remove this callout block before publishing.

---

## Incident Summary

| Field | Value |
|---|---|
| **Incident ID** | INC-XXXX |
| **Title** | _One-line description of the incident_ |
| **Date / Time (UTC)** | YYYY-MM-DD HH:MM – HH:MM UTC |
| **Duration** | _e.g., 47 minutes_ |
| **Severity** | _P1 / P2 / P3 / P4_ |
| **Status** | _Resolved / Monitoring / Ongoing_ |
| **Incident Lead** | _@handle_ |
| **Scribe** | _@handle_ |
| **Reviewers** | _@handle, @handle_ |

---

## Timeline

List events in chronological order. Include detection, escalation, key debugging steps, mitigation, and resolution. Use UTC timestamps.

| Time (UTC) | Event |
|---|---|
| HH:MM | _Brief description of what happened_ |
| HH:MM | _Alert fired / page sent_ |
| HH:MM | _On-call engineer acknowledged_ |
| HH:MM | _Root cause identified_ |
| HH:MM | _Mitigation applied_ |
| HH:MM | _Service fully restored_ |

---

## Impact

Describe the observable effect on users and systems during the incident window.

- **Services affected**: _e.g., News Feed API, Portfolio sync, Soroban event indexer_
- **User-facing impact**: _e.g., 100% of requests to /api/news returned 503 for 34 minutes_
- **Data impact**: _e.g., ~12 minutes of Soroban events not indexed; backfilled after resolution_
- **Financial / reward impact**: _e.g., No reward contract calls were attempted during the window_
- **Blast radius**: _e.g., Testnet only / Mainnet / All environments_

---

## Root Cause

State the single primary cause of the incident. Be specific — name the component, line of code, configuration value, or external dependency that failed.

> _Example: A missing index on the `soroban_events.ledger_sequence` column caused query time to exceed the 5-second NestJS timeout under load introduced by the v1.4 deployment._

---

## Contributing Factors

List conditions that made the incident worse or more likely to occur. These are not root causes but are important for prevention.

- _e.g., No alerting threshold was set for query latency on the soroban-events endpoint._
- _e.g., The staging environment did not mirror production data volume, so the regression was not caught in QA._
- _e.g., Runbook for Soroban RPC failures did not cover database-side latency spikes._

---

## Detection

Explain how the incident was identified and whether detection was timely.

- **Detected by**: _Automated alert / User report / On-call observation_
- **Alert / signal**: _e.g., Prometheus alert `soroban_event_lag_seconds > 60` fired at HH:MM_
- **Time to detection**: _e.g., 8 minutes after first user impact_
- **Detection gap**: _Describe any delay and why it occurred_

---

## Resolution

Describe the steps taken to resolve the incident, including any temporary mitigations and the final fix.

### Immediate Mitigation

_e.g., Restarted the soroban-event-indexer service to clear in-flight query backlog._

### Permanent Fix

_e.g., Added `CREATE INDEX CONCURRENTLY idx_soroban_events_ledger ON soroban_events(ledger_sequence)` in migration `0042_add_soroban_ledger_index.sql`._

### Verification

_e.g., Confirmed event lag returned to < 5 seconds via Grafana dashboard; backfilled missing events using `backfill_contract_events.py`._

---

## Action Items

Each action item must have a single owner and a concrete due date. Track these as GitHub issues and link them here.

| # | Action | Owner | Due Date | Issue |
|---|---|---|---|---|
| 1 | _Add Prometheus alert for DB query latency on soroban-events endpoint_ | @handle | YYYY-MM-DD | #XXX |
| 2 | _Update staging data volume to match production for load-sensitive paths_ | @handle | YYYY-MM-DD | #XXX |
| 3 | _Add runbook entry for database latency spikes affecting the indexer_ | @handle | YYYY-MM-DD | #XXX |

---

## Lessons Learned

Summarize the key insights from this incident. Focus on what the team will do differently going forward.

### What went well

- _e.g., On-call acknowledged the page within 3 minutes._
- _e.g., The Soroban indexer cursor mechanism prevented data loss after restart._

### What could be improved

- _e.g., Alerting coverage for database-side performance was incomplete._
- _e.g., The runbook did not provide a clear decision tree for this failure mode._

### Follow-up questions

_Optional: List any open questions that need investigation but are not yet action items._

- _e.g., Is query latency also a risk for the portfolio reconciliation job?_
