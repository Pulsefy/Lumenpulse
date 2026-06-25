"""Utilities for building contributor-centric activity timelines from contract events."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

_MAX_LIMIT = 500
_DEFAULT_LIMIT = 100


def _normalize_timestamp(value: Optional[Any]) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.isoformat()
    return str(value)


def _action_category(event_type: Optional[Any]) -> str:
    normalized = str(event_type or "").lower()
    if "deposit" in normalized:
        return "deposit"
    if "contribution" in normalized or "contribute" in normalized:
        return "contribution"
    if "register" in normalized or "registry" in normalized or "verification" in normalized:
        return "registry"
    if "milestone" in normalized:
        return "milestone"
    if "withdraw" in normalized or "refund" in normalized or "clawback" in normalized:
        return "withdrawal"
    return "other"


def _get_field(event: Any, field: str) -> Any:
    """Safely read a field from either an object or a dict."""
    if isinstance(event, dict):
        return event.get(field)
    return getattr(event, field, None)


def _clamp_limit(limit: int) -> int:
    if limit < 1:
        return 1
    if limit > _MAX_LIMIT:
        return _MAX_LIMIT
    return limit


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def build_contributor_activity_timeline(
    events: Iterable[Any],
    contributor: Optional[str] = None,
    limit: int = _DEFAULT_LIMIT,
    project_id: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """Build a contributor-centric timeline from contract event-like objects or dicts.

    Args:
        events:      Iterable of ORM objects or plain dicts representing contract events.
        contributor: If provided, only events whose ``contributor`` matches are included.
                     The comparison is case-insensitive.
        limit:       Maximum number of entries to return (clamped to 1–500).
        project_id:  If provided, further filter to a single project.

    Returns:
        List of timeline entry dicts sorted newest-first, ready for JSON serialisation.
    """
    limit = _clamp_limit(limit)

    # Normalise the contributor filter once so we don't repeat it per row.
    contributor_lower: Optional[str] = contributor.lower() if contributor else None

    timeline: List[Dict[str, Any]] = []

    for event in events:
        event_contributor = _get_field(event, "contributor")

        # --- contributor filter (case-insensitive) ---
        if contributor_lower is not None:
            if event_contributor is None:
                continue
            if str(event_contributor).lower() != contributor_lower:
                continue

        # --- project filter ---
        if project_id is not None:
            if _get_field(event, "project_id") != project_id:
                continue

        timestamp = _get_field(event, "timestamp")
        entry: Dict[str, Any] = {
            "contributor": event_contributor,
            "timestamp": _normalize_timestamp(timestamp),
            "action_category": _action_category(_get_field(event, "event_type")),
            "event_type": _get_field(event, "event_type"),
            "project_id": _get_field(event, "project_id"),
            "contract_id": _get_field(event, "contract_id"),
            "amount": _get_field(event, "amount"),
            "milestone_id": _get_field(event, "milestone_id"),
            "status": _get_field(event, "status"),
            # Internal sort key — stripped before returning.
            "_sort_timestamp": timestamp,
        }
        timeline.append(entry)

    # Sort newest-first; events without a timestamp sink to the bottom.
    _epoch = datetime.fromtimestamp(0, tz=timezone.utc)

    def _sort_key(item: Dict[str, Any]) -> datetime:
        ts = item["_sort_timestamp"]
        if ts is None:
            return _epoch
        if isinstance(ts, datetime):
            return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)
        # Fallback: treat as epoch so un-parseable values don't crash.
        return _epoch

    timeline.sort(key=_sort_key, reverse=True)

    return [
        {k: v for k, v in item.items() if k != "_sort_timestamp"}
        for item in timeline[:limit]
    ]
