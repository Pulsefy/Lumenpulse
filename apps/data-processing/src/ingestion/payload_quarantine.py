"""
payload_quarantine.py

Quarantine handler for malformed chain event payloads.

Goal: isolate bad payloads without stopping the ingestion pipeline.
- Malformed payloads are written to a JSONL quarantine log with full context.
- Healthy payloads continue processing normally.
- Maintainers can inspect quarantined items via the log file or QuarantineStore API.
- Quarantined payloads can be replayed after manual correction.

Usage (inline in any ingestion loop):
    from src.ingestion.payload_quarantine import QuarantineStore, quarantine_on_error

    store = QuarantineStore()          # default: ./data/quarantine/quarantine.jsonl

    # Option A – explicit quarantine
    result = validate_onchain_metric(raw)
    if result is None:
        store.add(raw, reason="validation_failed", source="stellar_fetcher")
        continue                       # healthy payloads keep going

    # Option B – decorator / context helper
    with quarantine_on_error(store, raw, source="stellar_fetcher"):
        process(raw)                   # any exception → quarantined, not re-raised
"""

from __future__ import annotations

import json
import logging
import os
import threading
import uuid
from contextlib import contextmanager
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Generator, Iterable, Iterator, List, Optional

logger = logging.getLogger("payload_quarantine")


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------

@dataclass
class QuarantinedPayload:
    """A single quarantined entry persisted to the log."""

    quarantine_id: str
    """Unique ID assigned at quarantine time (UUID4)."""

    source: str
    """Which fetcher / pipeline stage produced this payload."""

    reason: str
    """Short machine-readable reason code, e.g. 'validation_failed'."""

    error_detail: str
    """Human-readable description of the problem."""

    payload: Any
    """Original raw payload (must be JSON-serialisable)."""

    quarantined_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    """ISO-8601 timestamp when the payload was quarantined."""

    replayed: bool = False
    """Set to True when the entry has been successfully replayed."""

    tags: List[str] = field(default_factory=list)
    """Optional free-form tags for filtering (e.g. ['stellar', 'testnet'])."""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "QuarantinedPayload":
        return cls(**data)


# ---------------------------------------------------------------------------
# Storage backend
# ---------------------------------------------------------------------------

class QuarantineStore:
    """
    Thread-safe, append-only JSONL quarantine store.

    Each call to :meth:`add` appends one JSON line to *quarantine_path*.
    The file is created (including parent dirs) on first write.

    Parameters
    ----------
    quarantine_path:
        Path to the JSONL file.  Defaults to ``./data/quarantine/quarantine.jsonl``
        or the value of the ``QUARANTINE_PATH`` environment variable.
    """

    DEFAULT_PATH = os.getenv(
        "QUARANTINE_PATH",
        "./data/quarantine/quarantine.jsonl",
    )

    def __init__(self, quarantine_path: Optional[str] = None) -> None:
        self._path = Path(quarantine_path or self.DEFAULT_PATH)
        self._lock = threading.Lock()

    @property
    def path(self) -> Path:
        return self._path

    # ------------------------------------------------------------------
    # Write
    # ------------------------------------------------------------------

    def add(
        self,
        payload: Any,
        *,
        reason: str,
        source: str,
        error_detail: str = "",
        tags: Optional[List[str]] = None,
    ) -> QuarantinedPayload:
        """
        Quarantine *payload* and persist to the log.

        Parameters
        ----------
        payload:
            The raw (possibly invalid) payload dict/object.
        reason:
            Short snake_case reason code, e.g. ``"validation_failed"``,
            ``"missing_required_field"``, ``"unexpected_exception"``.
        source:
            Name of the ingestion stage that produced the payload,
            e.g. ``"stellar_fetcher"``, ``"news_fetcher"``.
        error_detail:
            Human-readable description of what went wrong.
        tags:
            Optional list of string tags for later filtering.

        Returns
        -------
        QuarantinedPayload
            The persisted entry (includes its generated ``quarantine_id``).
        """
        entry = QuarantinedPayload(
            quarantine_id=str(uuid.uuid4()),
            source=source,
            reason=reason,
            error_detail=error_detail,
            payload=payload,
            tags=tags or [],
        )
        self._write(entry)
        logger.warning(
            "Quarantined payload | id=%s source=%s reason=%s",
            entry.quarantine_id,
            entry.source,
            entry.reason,
        )
        return entry

    def _write(self, entry: QuarantinedPayload) -> None:
        """Append one JSON line to the quarantine file (thread-safe)."""
        self._path.parent.mkdir(parents=True, exist_ok=True)
        line = json.dumps(entry.to_dict(), ensure_ascii=False, default=str)
        with self._lock:
            with self._path.open("a", encoding="utf-8") as fh:
                fh.write(line + "\n")

    # ------------------------------------------------------------------
    # Read / inspect
    # ------------------------------------------------------------------

    def iter_entries(self) -> Iterator[QuarantinedPayload]:
        """
        Yield all quarantined entries from the log file.

        Skips lines that cannot be parsed (logs a warning).
        """
        if not self._path.exists():
            return
        with self._path.open("r", encoding="utf-8") as fh:
            for lineno, line in enumerate(fh, start=1):
                line = line.strip()
                if not line:
                    continue
                try:
                    data = json.loads(line)
                    yield QuarantinedPayload.from_dict(data)
                except (json.JSONDecodeError, TypeError, KeyError) as exc:
                    logger.warning("Could not parse quarantine line %d: %s", lineno, exc)

    def list_entries(
        self,
        *,
        source: Optional[str] = None,
        reason: Optional[str] = None,
        replayed: Optional[bool] = None,
    ) -> List[QuarantinedPayload]:
        """
        Return quarantined entries, optionally filtered.

        Parameters
        ----------
        source:
            Keep only entries from this source.
        reason:
            Keep only entries with this reason code.
        replayed:
            If ``True``, keep only replayed entries; ``False`` → only pending.
        """
        entries = list(self.iter_entries())
        if source is not None:
            entries = [e for e in entries if e.source == source]
        if reason is not None:
            entries = [e for e in entries if e.reason == reason]
        if replayed is not None:
            entries = [e for e in entries if e.replayed == replayed]
        return entries

    def count(self) -> int:
        """Return total number of quarantined entries."""
        return sum(1 for _ in self.iter_entries())

    # ------------------------------------------------------------------
    # Replay support
    # ------------------------------------------------------------------

    def replay(
        self,
        entries: Iterable[QuarantinedPayload],
        processor,
        *,
        mark_replayed: bool = True,
    ) -> Dict[str, Any]:
        """
        Attempt to re-process previously quarantined payloads.

        Parameters
        ----------
        entries:
            Iterable of :class:`QuarantinedPayload` to replay
            (e.g. from :meth:`list_entries`).
        processor:
            Callable ``(payload: Any) -> Any`` that processes a single payload.
            Should raise on failure.
        mark_replayed:
            If ``True`` (default), successfully replayed entries are written to
            a ``<quarantine>.replayed.jsonl`` sidecar so maintainers can track
            which items have been fixed.

        Returns
        -------
        dict
            ``{"attempted": int, "succeeded": int, "failed": int, "errors": list}``
        """
        attempted = succeeded = failed = 0
        errors: List[Dict[str, Any]] = []
        replayed_path = self._path.with_suffix(".replayed.jsonl")

        for entry in entries:
            attempted += 1
            try:
                processor(entry.payload)
                succeeded += 1
                if mark_replayed:
                    entry.replayed = True
                    line = json.dumps(entry.to_dict(), ensure_ascii=False, default=str)
                    with self._lock:
                        with replayed_path.open("a", encoding="utf-8") as fh:
                            fh.write(line + "\n")
                logger.info("Replayed quarantine_id=%s successfully", entry.quarantine_id)
            except Exception as exc:  # noqa: BLE001
                failed += 1
                errors.append({"quarantine_id": entry.quarantine_id, "error": str(exc)})
                logger.warning(
                    "Replay failed for quarantine_id=%s: %s",
                    entry.quarantine_id,
                    exc,
                )

        return {
            "attempted": attempted,
            "succeeded": succeeded,
            "failed": failed,
            "errors": errors,
        }


# ---------------------------------------------------------------------------
# Context-manager helper
# ---------------------------------------------------------------------------

@contextmanager
def quarantine_on_error(
    store: QuarantineStore,
    payload: Any,
    *,
    source: str,
    reason: str = "unexpected_exception",
    tags: Optional[List[str]] = None,
) -> Generator[None, None, None]:
    """
    Context manager that catches *any* exception inside the ``with`` block,
    quarantines *payload*, logs the error, and suppresses the exception so
    the enclosing pipeline loop can continue.

    Example
    -------
    .. code-block:: python

        store = QuarantineStore()
        for raw in incoming_payloads:
            with quarantine_on_error(store, raw, source="stellar_fetcher"):
                validated = validate_onchain_metric(raw)
                if validated is None:
                    raise ValueError("Pydantic validation failed")
                pipeline.process(validated)
            # execution always reaches here; bad payloads are quarantined, not dropped silently
    """
    try:
        yield
    except Exception as exc:  # noqa: BLE001
        store.add(
            payload,
            reason=reason,
            source=source,
            error_detail=str(exc),
            tags=tags,
        )


# ---------------------------------------------------------------------------
# Convenience: process a batch, quarantining failures
# ---------------------------------------------------------------------------

def process_with_quarantine(
    payloads: Iterable[Any],
    processor,
    store: QuarantineStore,
    *,
    source: str,
    reason: str = "unexpected_exception",
    tags: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    Run *processor* over each item in *payloads*, quarantining failures.

    Parameters
    ----------
    payloads:
        Iterable of raw payload dicts/objects.
    processor:
        Callable ``(payload) -> Any``; raise to signal failure.
    store:
        :class:`QuarantineStore` instance.
    source:
        Ingestion stage name written to each quarantine entry.
    reason:
        Default reason code when an exception is caught.
    tags:
        Optional tags attached to every quarantined entry.

    Returns
    -------
    dict
        ``{"processed": int, "quarantined": int}``
    """
    processed = quarantined_count = 0

    for payload in payloads:
        try:
            processor(payload)
            processed += 1
        except Exception as exc:  # noqa: BLE001
            store.add(
                payload,
                reason=reason,
                source=source,
                error_detail=str(exc),
                tags=tags,
            )
            quarantined_count += 1

    return {"processed": processed, "quarantined": quarantined_count}