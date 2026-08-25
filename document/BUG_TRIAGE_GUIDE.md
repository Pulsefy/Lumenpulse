# Bug Triage Guide

**Version**: 1.0.0
**Audience**: Contributors, maintainers, and on-call engineers
**Purpose**: Define how bugs are reported, prioritized, assigned, and escalated — so every issue moves predictably from discovery to resolution.

---

## 1. Reporting a Bug

Before opening an issue, check whether the bug is already tracked:

1. Search open issues with relevant keywords.
2. Check the [error codes reference](error-codes.md) — some errors are expected behavior with documented recovery steps.
3. Check the [ETL & Data Pipeline Runbook](ETL_RUNBOOK.md) for data-layer failures.

If no existing issue covers the bug, open a new GitHub issue using the **Bug Report** template. Include:

| Field | What to provide |
|---|---|
| **Summary** | One-line description of the problem |
| **Environment** | Testnet / Mainnet; browser/device; app version |
| **Steps to reproduce** | Numbered, minimal steps that consistently trigger the bug |
| **Expected behavior** | What should happen |
| **Actual behavior** | What actually happens |
| **Logs / screenshots** | Paste relevant error output or attach screenshots |
| **Severity estimate** | Your initial read using the table in Section 2 |

---

## 2. Severity Definitions

Assign the severity that best matches the observed impact. A maintainer may adjust it during triage.

| Severity | Definition | Example |
|---|---|---|
| **P1** | Full service outage or data loss; mainnet funds at risk | News Feed API returning 503 for all users; wallet auth broken |
| **P2** | Partial outage or major feature broken; no workaround | Portfolio sync failing for a significant user segment |
| **P3** | Feature degraded but workaround exists | Sentiment score missing on some articles |
| **P4** | Cosmetic defect or minor inconvenience | Tooltip text truncated on mobile |

---

## 3. Triage Process

Maintainers review the bug backlog at least once per day. During triage, each new bug issue is:

1. **Confirmed** — a maintainer reproduces the bug or marks it `needs-repro` if more information is required.
2. **Severity-labeled** — the `P1`, `P2`, `P3`, or `P4` label is applied.
3. **Area-labeled** — one of `area:frontend`, `area:backend`, `area:contracts`, `area:data-processing`, or `area:mobile` is applied.
4. **Assigned or queued** — P1/P2 bugs are assigned immediately; P3/P4 enter the backlog milestone.

### Triage checklist

- [ ] Issue has a clear reproduction path or is labeled `needs-repro`.
- [ ] Severity label applied.
- [ ] Area label applied.
- [ ] Duplicate check performed — linked if duplicate found.
- [ ] P1/P2: owner assigned and acknowledged.

---

## 4. Escalation and Response Targets

| Severity | First response | Resolution target | Escalation path |
|---|---|---|---|
| **P1** | Immediate — page on-call | ASAP / continuous work | Escalate to maintainers if not resolved in 1 hour |
| **P2** | Within 15 minutes | Within 4 hours | Escalate to maintainers if not resolved in 1 business day |
| **P3** | Within 1 business day | Within the current sprint | Reprioritize if blocking downstream work |
| **P4** | Within 1 week | Best effort | File and label; revisit at sprint planning |

---

## 5. Hotfix Path

For P1 bugs requiring an emergency merge:

1. Branch from `main` using `fix/critical-<short-description>`.
2. Apply the minimal fix — no unrelated changes.
3. Get a single maintainer approval plus a green CI run.
4. Merge immediately.
5. Commit message prefix: `fix(critical): <description>`.
6. File a retrospective or postmortem issue after the fix is live (see Section 6).

---

## 6. When a Postmortem Is Required

P1 and P2 bugs that cause user-facing downtime or data integrity issues require a formal postmortem after resolution.

See the **[Incident Postmortem Workflow](INCIDENT_POSTMORTEM_WORKFLOW.md)** for:

- Full criteria for when a postmortem is required.
- Step-by-step instructions for drafting, reviewing, and publishing a postmortem.
- How to track and close action items.
- The postmortem template: [`POSTMORTEM_TEMPLATE.md`](POSTMORTEM_TEMPLATE.md).

Every P1 incident and any P2 with ≥ 15 minutes of user-facing downtime **must** have a postmortem opened within 24 hours of resolution.

---

## 7. Related Documents

- [Incident Postmortem Workflow](INCIDENT_POSTMORTEM_WORKFLOW.md) — full postmortem process.
- [Postmortem Template](POSTMORTEM_TEMPLATE.md) — reusable template for postmortem documents.
- [Error Codes Reference](error-codes.md) — API error codes and meanings.
- [ETL & Data Pipeline Runbook](ETL_RUNBOOK.md) — recovery procedures for data pipeline failures.
- [Review Playbook](review-playbook.md) — PR review standards and hotfix guidance.
- [Contributing Guide](../CONTRIBUTING.md) — branch naming, commit conventions, and PR process.
