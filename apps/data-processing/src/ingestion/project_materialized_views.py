from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional


@dataclass
class ProjectMaterializedView:
    project_id: int
    total_contributed: int = 0
    contributor_count: int = 0
    milestone_approved: bool = False
    contributors: set[str] = field(default_factory=set)
    last_processed_ledger: int = 0
    last_processed_timestamp: Optional[str] = None


def _coerce_int(value) -> int:
    if value is None:
        return 0
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str):
        cleaned = value.strip()
        if cleaned == "":
            return 0
        try:
            return int(float(cleaned))
        except ValueError:
            return 0
    return 0


def _extract_project_id(event: Dict) -> Optional[int]:
    candidates = [
        event.get("project_id"),
        event.get("projectId"),
        event.get("project"),
    ]

    if isinstance(event.get("data"), dict):
        candidates.append(event["data"].get("project_id"))
        candidates.append(event["data"].get("projectId"))

    if isinstance(event.get("value"), dict):
        candidates.append(event["value"].get("project_id"))
        candidates.append(event["value"].get("projectId"))

    if isinstance(event.get("topics"), list):
        for topic in event["topics"]:
            if isinstance(topic, dict):
                candidates.append(topic.get("project_id"))
                candidates.append(topic.get("projectId"))
            else:
                try:
                    candidates.append(int(topic))
                except (TypeError, ValueError):
                    continue

    for candidate in candidates:
        try:
            project_id = int(candidate)
            if project_id >= 0:
                return project_id
        except (TypeError, ValueError):
            continue
    return None


def _extract_amount(event: Dict) -> int:
    candidates = [
        event.get("amount"),
        event.get("deposit_amount"),
        event.get("value"),
    ]

    if isinstance(event.get("data"), dict):
        candidates.append(event["data"].get("amount"))
        candidates.append(event["data"].get("deposit_amount"))

    if isinstance(event.get("value"), dict):
        candidates.append(event["value"].get("amount"))
        candidates.append(event["value"].get("deposit_amount"))

    if isinstance(event.get("topics"), list):
        for topic in event["topics"]:
            if isinstance(topic, dict):
                candidates.append(topic.get("amount"))
            elif isinstance(topic, (int, float)) and not isinstance(topic, bool):
                candidates.append(topic)

    for candidate in candidates:
        amount = _coerce_int(candidate)
        if amount > 0:
            return amount
    return 0


def _extract_contributor(event: Dict) -> Optional[str]:
    candidates = [
        event.get("contributor"),
        event.get("user"),
        event.get("owner"),
        event.get("admin"),
        event.get("caller"),
    ]

    if isinstance(event.get("data"), dict):
        for key in ("contributor", "user", "owner", "admin", "caller"):
            candidates.append(event["data"].get(key))

    if isinstance(event.get("value"), dict):
        for key in ("contributor", "user", "owner", "admin", "caller"):
            candidates.append(event["value"].get(key))

    for candidate in candidates:
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()
    return None


def _extract_ledger(event: Dict) -> int:
    ledger = event.get("ledger")
    if ledger is None:
        ledger = event.get("ledger_sequence")
    if ledger is None and isinstance(event.get("data"), dict):
        ledger = event["data"].get("ledger")
    if ledger is None and isinstance(event.get("value"), dict):
        ledger = event["value"].get("ledger")
    return _coerce_int(ledger)


def _build_row(project_id: int, materialized: ProjectMaterializedView) -> Dict:
    return {
        "project_id": project_id,
        "total_contributed": materialized.total_contributed,
        "contributor_count": materialized.contributor_count,
        "milestone_approved": materialized.milestone_approved,
        "contributors": sorted(materialized.contributors),
        "last_processed_ledger": materialized.last_processed_ledger,
    }


def _calculate_raw_totals(events: List[Dict]) -> Dict[int, int]:
    totals: Dict[int, int] = {}
    for event in events:
        event_type = (event.get("event_type") or event.get("type") or "").strip()
        if event_type != "DepositEvent":
            continue
        project_id = _extract_project_id(event)
        if project_id is None:
            continue
        totals[project_id] = totals.get(project_id, 0) + _extract_amount(event)
    return totals


def refresh_project_materialized_views(
    events: List[Dict],
    existing_rows: Optional[Dict[int, Dict]] = None,
) -> tuple[List[Dict], Dict]:
    project_rows: Dict[int, ProjectMaterializedView] = {}

    for project_id, existing in (existing_rows or {}).items():
        project_rows[project_id] = ProjectMaterializedView(
            project_id=project_id,
            total_contributed=_coerce_int(existing.get("total_contributed")),
            contributor_count=_coerce_int(existing.get("contributor_count")),
            milestone_approved=bool(existing.get("milestone_approved")),
            contributors=set(existing.get("contributors") or []),
            last_processed_ledger=_coerce_int(existing.get("last_processed_ledger")),
        )

    updated_rows = []
    events_sorted = sorted(events, key=lambda item: (_extract_ledger(item), str(item.get("event_type"))))
    raw_totals = _calculate_raw_totals(events_sorted)

    for event in events_sorted:
        event_type = (event.get("event_type") or event.get("type") or "").strip()
        project_id = _extract_project_id(event)
        if project_id is None:
            continue

        materialized = project_rows.setdefault(
            project_id,
            ProjectMaterializedView(project_id=project_id),
        )

        ledger = _extract_ledger(event)
        if ledger <= materialized.last_processed_ledger:
            continue

        if event_type == "ProjectCreatedEvent":
            materialized.milestone_approved = False
            materialized.last_processed_ledger = ledger
            materialized.last_processed_timestamp = event.get("timestamp")
            continue

        if event_type == "DepositEvent":
            amount = _extract_amount(event)
            contributor = _extract_contributor(event)
            if amount > 0:
                materialized.total_contributed += amount
            if contributor:
                if contributor not in materialized.contributors:
                    materialized.contributors.add(contributor)
                    materialized.contributor_count = len(materialized.contributors)
            materialized.last_processed_ledger = ledger
            materialized.last_processed_timestamp = event.get("timestamp")
            continue

        if event_type == "MilestoneApprovedEvent":
            materialized.milestone_approved = True
            materialized.last_processed_ledger = ledger
            materialized.last_processed_timestamp = event.get("timestamp")
            continue

        if event_type == "ContributionRefundedEvent":
            amount = _extract_amount(event)
            if amount > 0:
                materialized.total_contributed = max(materialized.total_contributed - amount, 0)
            materialized.last_processed_ledger = ledger
            materialized.last_processed_timestamp = event.get("timestamp")
            continue

        materialized.last_processed_ledger = ledger
        materialized.last_processed_timestamp = event.get("timestamp")

    for project_id, materialized in sorted(project_rows.items()):
        row = _build_row(project_id, materialized)
        updated_rows.append(row)

    checks = build_data_quality_checks(
        rows_by_project={row["project_id"]: row for row in updated_rows},
        raw_totals=raw_totals,
    )

    return updated_rows, checks


def build_data_quality_checks(rows_by_project: Dict[int, Dict], raw_totals: Optional[Dict[int, int]] = None) -> Dict:
    raw_totals = raw_totals or {}
    materialized_totals = {
        project_id: row.get("total_contributed", 0)
        for project_id, row in rows_by_project.items()
    }

    expected_totals = raw_totals or materialized_totals
    passed = all(
        materialized_totals.get(project_id, 0) == expected_totals.get(project_id, 0)
        for project_id in set(materialized_totals) | set(expected_totals)
    )

    return {
        "project_total_crosscheck": {
            "passed": passed,
            "details": {
                "project_totals": materialized_totals,
                "raw_total": raw_totals,
                "materialized_total": materialized_totals,
            },
        }
    }
