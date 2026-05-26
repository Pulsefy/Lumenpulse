from typing import List, Dict, Tuple, Any
from datetime import datetime
import json
import os

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "data")
OUTPUT_FILE = os.path.join(DATA_DIR, "crowdfund_metrics.jsonl")


def _parse_iso(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def compute_kpis_from_events(events: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Compute TVL and cumulative deposit volume time-series from crowdfund vault events.

    Event format (expected):
      {
        "id": "unique-event-id",
        "type": "deposit" | "withdraw",
        "project_id": 123,
        "amount": 100.0,
        "timestamp": "2024-01-01T12:00:00Z",
        // optional correction fields:
        "correction_of": "original-event-id"  # indicates this event replaces original
      }

    Rules:
      - Idempotent: duplicate event `id` are ignored.
      - Corrections: if `correction_of` present, the original event is reversed (if seen)
        and the corrected event applied in its place.

    Returns a list sorted by timestamp of dicts:
      {"timestamp": iso, "tvl": float, "cumulative_deposits": float}
    """

    # Keep track of seen events and project balances
    seen = {}
    project_balances: Dict[int, float] = {}
    cumulative_deposits = 0.0

    # sort events by timestamp ascending
    events_sorted = sorted(events, key=lambda e: _parse_iso(e.get("timestamp")))

    series: List[Dict[str, Any]] = []

    for ev in events_sorted:
        ev_id = ev.get("id")
        if not ev_id:
            # ignore malformed
            continue

        # Handle corrections that replace a prior event
        correction_of = ev.get("correction_of")
        if correction_of:
            orig = seen.get(correction_of)
            if orig:
                # reverse original
                _reverse_event_effect(orig, project_balances)
                # remove original's contribution to cumulative_deposits if it was a deposit
                if orig.get("type") == "deposit":
                    cumulative_deposits -= float(orig.get("amount", 0))
                # mark original as replaced
                seen.pop(correction_of, None)

        # Idempotency: skip if we've already applied this event
        if ev_id in seen:
            continue

        # Apply event
        _apply_event_effect(ev, project_balances)

        if ev.get("type") == "deposit":
            cumulative_deposits += float(ev.get("amount", 0))

        # record seen
        seen[ev_id] = ev

        # compute current TVL
        tvl = sum(project_balances.values())

        series.append(
            {
                "timestamp": ev.get("timestamp"),
                "tvl": tvl,
                "cumulative_deposits": cumulative_deposits,
            }
        )

    return series


def _apply_event_effect(ev: Dict[str, Any], project_balances: Dict[int, float]):
    p = int(ev.get("project_id", 0))
    amt = float(ev.get("amount", 0))
    t = ev.get("type")

    if p not in project_balances:
        project_balances[p] = 0.0

    if t == "deposit":
        project_balances[p] += amt
    elif t == "withdraw":
        project_balances[p] -= amt
        # floor at zero to avoid negative TVL due to out-of-order events
        if project_balances[p] < 0:
            project_balances[p] = 0.0


def _reverse_event_effect(ev: Dict[str, Any], project_balances: Dict[int, float]):
    # reverse the effect of a single event
    p = int(ev.get("project_id", 0))
    amt = float(ev.get("amount", 0))
    t = ev.get("type")

    if p not in project_balances:
        project_balances[p] = 0.0

    if t == "deposit":
        project_balances[p] -= amt
        if project_balances[p] < 0:
            project_balances[p] = 0.0
    elif t == "withdraw":
        project_balances[p] += amt


def persist_series(series: List[Dict[str, Any]], output_file: str = OUTPUT_FILE):
    os.makedirs(os.path.dirname(output_file), exist_ok=True)
    # Write JSON Lines for easy incremental reads
    with open(output_file, "w", encoding="utf-8") as fh:
        for item in series:
            fh.write(json.dumps(item) + "\n")


def load_persisted_series(output_file: str = OUTPUT_FILE) -> List[Dict[str, Any]]:
    if not os.path.exists(output_file):
        return []
    res = []
    with open(output_file, "r", encoding="utf-8") as fh:
        for line in fh:
            if not line.strip():
                continue
            try:
                res.append(json.loads(line))
            except Exception:
                continue
    return res
