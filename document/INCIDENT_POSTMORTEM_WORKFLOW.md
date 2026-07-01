# Incident Postmortem Workflow

**Version**: 1.0.0
**Audience**: On-call engineers, incident leads, and maintainers
**Purpose**: Define when a postmortem is required, how it must be completed, and how action items are tracked — so every significant incident produces consistent, actionable learnings.

---

## 1. When a Postmortem Is Required

A postmortem is **required** for any incident that meets one or more of the following criteria:

| Trigger | Examples |
|---|---|
| P1 or P2 severity | Full service outage, data loss, security breach |
| User-facing downtime ≥ 15 minutes | News Feed, Portfolio API, or Wallet auth unavailable |
| Data integrity issue | Missing or corrupted events in the Soroban indexer, portfolio drift |
| On-call escalation | Incident required waking or pulling in a second engineer |
| Recurring issue | Same failure mode occurring for the second time within 30 days |
| Security or compliance event | Any unauthorized access, secret exposure, or contract exploit |

A postmortem is **optional but encouraged** for:

- P3/P4 incidents resolved quickly with no lasting impact, where a contributing factor is newly identified.
- Near-misses caught before user impact.

When in doubt, write one. Postmortems are blameless learning documents, not performance reviews.

---

## 2. Severity Levels

Use these definitions when filling in the Incident Summary table of the postmortem template.

| Severity | Definition | Response Time |
|---|---|---|
| **P1** | Full service outage or data loss affecting all users or mainnet funds | Immediate — page on-call now |
| **P2** | Partial outage or degraded service affecting a significant user segment | Within 15 minutes |
| **P3** | Minor degradation or non-critical feature broken; workaround exists | Within 2 hours |
| **P4** | Cosmetic issue or low-impact bug with no service disruption | Next business day |

---

## 3. How to Complete a Postmortem

### Step 1 — Declare and assign (during or immediately after resolution)

As soon as a P1/P2 incident is resolved, the **incident lead** must:

1. Open a new GitHub issue titled `postmortem: <short incident title>` and label it `postmortem`.
2. Copy the postmortem template from [`document/POSTMORTEM_TEMPLATE.md`](POSTMORTEM_TEMPLATE.md).
3. Create a new file at `document/postmortems/POSTMORTEM-<YYYY-MM-DD>-<short-title>.md`.
4. Fill in the **Incident Summary** and **Timeline** sections while memory is fresh.
5. Assign the GitHub issue to the incident lead.

### Step 2 — Draft within 24 hours

The incident lead completes all sections of the postmortem document within **24 hours** of resolution:

- [ ] Incident Summary (all fields)
- [ ] Timeline (all key events with UTC timestamps)
- [ ] Impact (quantified where possible)
- [ ] Root Cause (single primary cause, specific)
- [ ] Contributing Factors (secondary conditions)
- [ ] Detection (how and when the incident was found)
- [ ] Resolution (mitigation steps and permanent fix)
- [ ] Action Items (every item has an owner and due date)
- [ ] Lessons Learned (what went well, what to improve)

### Step 3 — Review within 48 hours

Open a pull request targeting `main` with the postmortem file. At least one maintainer **not** directly involved in the incident should review it for:

- Accuracy and completeness of the timeline.
- Clarity of the root cause statement.
- Reasonableness of action items (actionable, scoped, owned).
- Blameless tone — focus on systems and processes, not individuals.

### Step 4 — Publish and link

Once merged, add a link to the postmortem document in the GitHub issue created in Step 1, then close the issue. Update the [postmortem index](#5-postmortem-index) at the bottom of this file.

---

## 4. How Action Items Are Tracked

Action items identified in a postmortem must be managed as first-class work, not left as untracked notes.

### Creating action item issues

For each row in the postmortem's **Action Items** table:

1. Open a GitHub issue with title: `[postmortem follow-up] <action description>`.
2. Label it `postmortem-follow-up`.
3. Assign it to the named owner.
4. Set a milestone or due date matching the postmortem table.
5. Paste the link back into the postmortem's Action Items table.

### Tracking progress

- Action items are reviewed at the next team sync after the postmortem is published.
- Overdue items (past their due date and not closed) must be escalated to a maintainer.
- Action items may be closed only when the fix is merged and verified — not when the PR is opened.

### Definition of done for an action item

An action item is **done** when all of the following are true:

- [ ] The fix, alert, runbook update, or process change is merged to `main`.
- [ ] The GitHub issue is closed with a comment citing the merged PR.
- [ ] The postmortem document is updated if the action changed the permanent fix or resolution steps.

---

## 5. Postmortem Index

List all published postmortems here in reverse chronological order. Update this table each time a new postmortem is merged.

| Date | Incident Title | Severity | Postmortem |
|---|---|---|---|
| _YYYY-MM-DD_ | _Example: Soroban indexer lag caused by missing DB index_ | _P2_ | _[POSTMORTEM-YYYY-MM-DD-short-title.md](postmortems/POSTMORTEM-YYYY-MM-DD-short-title.md)_ |

---

## 6. Related Documents

- [Postmortem Template](POSTMORTEM_TEMPLATE.md) — fill this out for every postmortem.
- [Bug Triage Guide](BUG_TRIAGE_GUIDE.md) — how bugs are reported, prioritized, and escalated.
- [ETL & Data Pipeline Runbook](ETL_RUNBOOK.md) — recovery procedures for data pipeline incidents.
- [Review Playbook](review-playbook.md) — PR review standards, including hotfix path for critical incidents.
