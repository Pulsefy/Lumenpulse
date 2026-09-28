"""
quarantine_replay.py

Replay service for quarantined ingestion payloads (issue #1453).

Re-runs the current validator against previously quarantined payloads:

- Payloads that now pass are routed through the downstream sink exactly once
  (idempotent by payload hash) and their quarantine entry is marked replayed.
- Payloads that still fail stay quarantined with the validator's current
  error message and an updated ``last_attempted_at`` timestamp.
- ``dry_run=True`` reports what would happen without touching any files.
"""

from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional

from pydantic import ValidationError

from src.ingestion.payload_quarantine import (
    REPLAY_STATUS_PENDING,
    REPLAY_STATUS_REPLAYED,
    QuarantinedPayload,
    QuarantineStore,
)
from src.validators import (
    NewsArticle,
    OnChainMetric,
    validate_news_article,
    validate_onchain_metric,
)

logger = logging.getLogger(__name__)

NEWS_SOURCE = "news_fetcher"
DEFAULT_SINK_PATH = "./data/quarantine/replay_sink.jsonl"

ValidatorFn = Callable[[Dict[str, Any]], Optional[Any]]


@dataclass
class ReplaySummary:
    """Aggregated result of one replay run."""

    scanned: int = 0
    replayed: int = 0
    still_failing: int = 0
    errors: int = 0
    skipped: int = 0
    dry_run: bool = False
    details: List[Dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "scanned": self.scanned,
            "replayed": self.replayed,
            "still_failing": self.still_failing,
            "errors": self.errors,
            "skipped": self.skipped,
            "dry_run": self.dry_run,
            "details": self.details,
        }


def parse_iso8601(value: str) -> datetime:
    """Parse an ISO-8601 timestamp, accepting a trailing Z for UTC."""
    if not isinstance(value, str):
        raise TypeError(
            f"ISO-8601 timestamp must be a string, got {type(value).__name__}"
        )
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _parse_optional_iso8601(value: Optional[str]) -> Optional[datetime]:
    if value is None:
        return None
    return parse_iso8601(value)


def payload_fingerprint(payload: Any) -> str:
    """Return a stable SHA-256 hash of the canonical JSON form of *payload*."""
    serialized = json.dumps(payload, sort_keys=True, default=str, ensure_ascii=False)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


class ReplaySink:
    """
    Idempotent JSONL sink for replayed payloads.

    Records are keyed by payload fingerprint; a second write of the same
    payload is a no-op, which makes repeated replays idempotent.
    """

    def __init__(self, sink_path: Optional[str] = None) -> None:
        self._path = sink_path or DEFAULT_SINK_PATH

    @property
    def path(self) -> str:
        return self._path

    def contains(self, fingerprint: str) -> bool:
        """Return True if a record with this fingerprint already exists."""
        try:
            with open(self._path, encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        record = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if record.get("fingerprint") == fingerprint:
                        return True
        except FileNotFoundError:
            return False
        return False

    def write(self, payload: Any, fingerprint: str) -> bool:
        """Write the payload once; return False if it already existed."""
        if self.contains(fingerprint):
            return False
        record = {
            "fingerprint": fingerprint,
            "replayed_at": datetime.now(timezone.utc).isoformat(),
            "payload": payload,
        }
        with open(self._path, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(record, ensure_ascii=False, default=str) + "\n")
        return True


def select_validator(source: str) -> Optional[ValidatorFn]:
    """Map a quarantine source name to its ingestion-time validator."""
    if source == NEWS_SOURCE:
        return validate_news_article
    if source.startswith("stellar"):
        return validate_onchain_metric
    return None


def validator_failure_message(validator: ValidatorFn, payload: Dict[str, Any]) -> str:
    """Return the validator's own error text for *payload*, or '' if valid."""
    if validator is validate_news_article:
        model = NewsArticle
    else:
        model = OnChainMetric
    try:
        model(**payload)
    except ValidationError as exc:
        try:
            return str(exc.errors(include_url=False))
        except Exception:
            return str(exc)
    return ""


def _entry_quarantined_at(entry: QuarantinedPayload) -> Optional[datetime]:
    try:
        return parse_iso8601(entry.quarantined_at)
    except (ValueError, TypeError):
        return None


def _matches_filters(
    entry: QuarantinedPayload,
    *,
    since: Optional[datetime],
    until: Optional[datetime],
    source: Optional[str],
    include_replayed: bool,
) -> bool:
    if source is not None and entry.source != source:
        return False
    if not include_replayed and entry.replayed:
        return False
    if since is None and until is None:
        return True
    quarantined_at = _entry_quarantined_at(entry)
    if quarantined_at is None:
        return False
    if since is not None and quarantined_at < since:
        return False
    if until is not None and quarantined_at > until:
        return False
    return True


def select_entries(
    store: QuarantineStore,
    *,
    since: Optional[str] = None,
    until: Optional[str] = None,
    source: Optional[str] = None,
    include_replayed: bool = False,
) -> List[QuarantinedPayload]:
    """
    Return pending quarantine entries in ``[since, until]`` for *source*.

    ``since`` and ``until`` are ISO-8601 timestamps and both bounds are
    inclusive; they are compared against each entry's ``quarantined_at``.
    """
    since_dt = _parse_optional_iso8601(since)
    until_dt = _parse_optional_iso8601(until)
    return [
        entry
        for entry in store.list_entries(source=source)
        if _matches_filters(
            entry,
            since=since_dt,
            until=until_dt,
            source=source,
            include_replayed=include_replayed,
        )
    ]


class QuarantineReplayService:
    """
    Replays quarantined payloads through the current validator.

    Parameters
    ----------
    store:
        The quarantine log to read entries from and update.
    sink:
        Idempotent downstream write target for payloads that now validate.
    """

    def __init__(
        self,
        store: QuarantineStore,
        sink: Optional[ReplaySink] = None,
    ) -> None:
        self._store = store
        self._sink = sink or ReplaySink()

    def replay(
        self,
        *,
        since: Optional[str] = None,
        until: Optional[str] = None,
        source: Optional[str] = None,
        limit: Optional[int] = None,
        dry_run: bool = False,
    ) -> Dict[str, Any]:
        """
        Replay matching quarantined payloads and return a summary dict.

        Entries already marked replayed are skipped unless they match the
        filters again with ``include_replayed`` (not exposed here), so a
        second identical run is a no-op.
        """
        entries = select_entries(self._store, since=since, until=until, source=source)
        if limit is not None and limit >= 0:
            entries = entries[:limit]

        summary = ReplaySummary(dry_run=dry_run)
        summary.scanned = len(entries)

        for entry in entries:
            if entry.replayed:
                summary.skipped += 1
                continue
            self._replay_entry(entry, summary, dry_run=dry_run)

        return summary.to_dict()

    def _replay_entry(
        self,
        entry: QuarantinedPayload,
        summary: ReplaySummary,
        *,
        dry_run: bool,
    ) -> None:
        payload = entry.payload
        if not isinstance(payload, dict):
            detail = "payload is not a JSON object"
            summary.details.append(
                {
                    "quarantine_id": entry.quarantine_id,
                    "outcome": "error",
                    "detail": detail,
                }
            )
            if not dry_run:
                self._mark_failed(entry, detail)
            summary.errors += 1
            return

        validator = select_validator(entry.source)
        if validator is None:
            detail = f"no validator registered for source {entry.source!r}"
            summary.details.append(
                {
                    "quarantine_id": entry.quarantine_id,
                    "outcome": "error",
                    "detail": detail,
                }
            )
            if not dry_run:
                self._mark_failed(entry, detail)
            summary.errors += 1
            return

        validated = validator(payload)
        if validated is None:
            failure = validator_failure_message(validator, payload) or (
                "validation failed"
            )
            summary.details.append(
                {
                    "quarantine_id": entry.quarantine_id,
                    "outcome": "still_failing",
                    "detail": failure,
                }
            )
            if not dry_run:
                self._mark_failed(entry, failure)
            summary.still_failing += 1
            return

        fingerprint = payload_fingerprint(payload)
        if dry_run:
            summary.details.append(
                {
                    "quarantine_id": entry.quarantine_id,
                    "outcome": "would_replay",
                }
            )
            summary.replayed += 1
            return

        try:
            self._sink.write(payload, fingerprint)
        except OSError as exc:
            logger.warning(
                "Downstream write failed for quarantine_id=%s: %s",
                entry.quarantine_id,
                exc,
            )
            summary.details.append(
                {
                    "quarantine_id": entry.quarantine_id,
                    "outcome": "error",
                    "detail": f"downstream write failed: {exc}",
                }
            )
            summary.errors += 1
            return

        replayed_at = datetime.now(timezone.utc).isoformat()
        self._store.update_entry(
            entry.quarantine_id,
            status=REPLAY_STATUS_REPLAYED,
            replayed_at=replayed_at,
            last_attempted_at=replayed_at,
        )
        logger.info(
            "Replayed quarantine_id=%s source=%s", entry.quarantine_id, entry.source
        )
        summary.details.append(
            {
                "quarantine_id": entry.quarantine_id,
                "outcome": "replayed",
            }
        )
        summary.replayed += 1

    def _mark_failed(self, entry: QuarantinedPayload, failure: str) -> None:
        self._store.update_entry(
            entry.quarantine_id,
            status=REPLAY_STATUS_PENDING,
            last_attempted_at=datetime.now(timezone.utc).isoformat(),
            error_detail=failure,
        )
