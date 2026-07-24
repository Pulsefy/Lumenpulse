"""
Recovery Coordinator
====================
Coordinates resumable ledger ingestion using the persistent
:class:`~src.ingestion.ledger_cursor_store.LedgerCursorStore`.

The coordinator encapsulates the full begin → process → advance / rollback
lifecycle so individual ingestion callables do not need to understand cursor
mechanics.

Typical usage
-------------
::

    coordinator = RecoveryCoordinator(
        store=LedgerCursorStore(),
        stream_id="contract:CABC...XYZ",
    )

    # One-shot: process a single batch
    coordinator.run_batch(
        fetch_fn=lambda start, end: fetch_events(start, end),
        persist_fn=lambda events: db.bulk_insert(events),
        batch_end_ledger=next_ledger,
    )

    # Continuous: keep polling until stopped
    coordinator.run_continuous(
        fetch_fn=fetch_events,
        persist_fn=db.bulk_insert,
        ledger_step=100,
        poll_interval_seconds=5,
    )

Design notes
------------
* ``fetch_fn(start_ledger, end_ledger) -> Iterable[Event]`` receives the
  *exclusive* lower bound (``last_safe_ledger``) and *inclusive* upper bound
  (``batch_end_ledger``).  It must not raise for an empty range.
* ``persist_fn(events) -> Optional[str]`` must persist the events atomically
  and return the *event_id* of the last event, or ``None`` if the batch was
  empty.
* On any exception inside ``fetch_fn`` or ``persist_fn``, the coordinator
  calls ``store.rollback_to_safe_point`` before re-raising, so the next run
  resumes from the last committed ledger.
* Duplicate detection: if ``persist_fn`` raises a ``DuplicateEventError``
  the coordinator logs a warning and advances the cursor without treating it
  as a failure — this covers idempotent re-runs after a crash at exactly the
  commit boundary.
"""

from __future__ import annotations

import logging
import time
from typing import Any, Callable, Iterable, Optional

from src.ingestion.ledger_cursor_store import LedgerCursorStore

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Sentinel exception
# ---------------------------------------------------------------------------


class DuplicateEventError(Exception):
    """
    Raised by *persist_fn* when all events in a batch have already been
    persisted (e.g. unique-constraint violation on ``event_id``).

    The coordinator treats this as a safe no-op and advances the cursor.
    """


# ---------------------------------------------------------------------------
# Coordinator
# ---------------------------------------------------------------------------


class RecoveryCoordinator:
    """
    Coordinates ledger ingestion with persistent cursor tracking and
    automatic recovery on failure.

    Parameters
    ----------
    store:
        A :class:`LedgerCursorStore` instance.
    stream_id:
        The stream key to track (e.g. ``"global"`` or
        ``"contract:CABC...XYZ"``).
    """

    def __init__(
        self,
        store: LedgerCursorStore,
        stream_id: str,
    ) -> None:
        self._store = store
        self._stream_id = stream_id

        # Ensure the cursor row exists before anything tries to read it.
        self._store.get_or_create(stream_id)

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

    @property
    def stream_id(self) -> str:
        return self._stream_id

    @property
    def store(self) -> LedgerCursorStore:
        return self._store

    # ------------------------------------------------------------------
    # Core batch runner
    # ------------------------------------------------------------------

    def run_batch(
        self,
        fetch_fn: Callable[[int, int], Iterable[Any]],
        persist_fn: Callable[[Iterable[Any]], Optional[str]],
        batch_end_ledger: int,
    ) -> Optional[str]:
        """
        Ingest one batch of events from ``(last_safe_ledger, batch_end_ledger]``.

        Steps
        -----
        1. Load current cursor state.
        2. Call ``store.begin_batch`` — saves a safe-point and marks status
           as ``"ingesting"``.
        3. Call ``fetch_fn(safe_ledger, batch_end_ledger)`` — retrieve events.
        4. Call ``persist_fn(events)`` — persist and return last event_id.
        5. Call ``store.advance`` — commit the new high-water mark.

        If steps 3 or 4 raise anything other than
        :class:`DuplicateEventError`:
        * ``store.rollback_to_safe_point`` is called.
        * The exception is re-raised.

        Returns
        -------
        str | None
            The last_event_id returned by *persist_fn*, or ``None`` for an
            empty batch.
        """
        cursor = self._store.get_cursor(self._stream_id)
        if cursor is None:
            # Should not happen — get_or_create is called in __init__.
            raise RuntimeError(
                f"Cursor disappeared for stream={self._stream_id!r}"
            )

        current_ledger: int = cursor["last_ingested_ledger"]

        if batch_end_ledger <= current_ledger:
            logger.debug(
                "run_batch: batch_end_ledger=%d <= current=%d for stream=%s — skipping",
                batch_end_ledger,
                current_ledger,
                self._stream_id,
            )
            return None

        safe_ledger = self._store.begin_batch(self._stream_id, current_ledger)

        logger.info(
            "Ingesting stream=%s ledgers (%d, %d]",
            self._stream_id,
            safe_ledger,
            batch_end_ledger,
        )

        last_event_id: Optional[str] = None

        try:
            events = fetch_fn(safe_ledger, batch_end_ledger)
            last_event_id = persist_fn(events)
        except DuplicateEventError as exc:
            # All events already exist — safe to advance without treating
            # this as a failure.
            logger.warning(
                "stream=%s batch (%d, %d] fully duplicate — advancing cursor. detail=%s",
                self._stream_id,
                safe_ledger,
                batch_end_ledger,
                exc,
            )
        except Exception as exc:
            rolled_back_to = self._store.rollback_to_safe_point(
                self._stream_id,
                error_message=f"{type(exc).__name__}: {exc}",
            )
            logger.error(
                "Ingestion failed stream=%s batch (%d, %d]; rolled back to ledger=%d. error=%s",
                self._stream_id,
                safe_ledger,
                batch_end_ledger,
                rolled_back_to,
                exc,
                exc_info=True,
            )
            raise

        self._store.advance(
            stream_id=self._stream_id,
            new_ledger=batch_end_ledger,
            last_event_id=last_event_id,
        )

        logger.info(
            "stream=%s cursor advanced to ledger=%d last_event_id=%s",
            self._stream_id,
            batch_end_ledger,
            last_event_id,
        )
        return last_event_id

    # ------------------------------------------------------------------
    # Continuous runner
    # ------------------------------------------------------------------

    def run_continuous(
        self,
        fetch_fn: Callable[[int, int], Iterable[Any]],
        persist_fn: Callable[[Iterable[Any]], Optional[str]],
        ledger_step: int,
        get_network_tip_fn: Callable[[], int],
        poll_interval_seconds: float = 5.0,
        max_retries_on_failure: int = 3,
        retry_backoff_seconds: float = 10.0,
        stop_event: Optional[Any] = None,
    ) -> None:
        """
        Continuously ingest ledgers, advancing ``ledger_step`` per iteration.

        Parameters
        ----------
        fetch_fn, persist_fn:
            Same semantics as in :meth:`run_batch`.
        ledger_step:
            Number of ledgers per batch (e.g. 100).
        get_network_tip_fn:
            Zero-argument callable returning the latest confirmed ledger
            sequence on the network.  Used to avoid requesting ledgers that
            do not yet exist.
        poll_interval_seconds:
            How long to sleep when the cursor is at the network tip.
        max_retries_on_failure:
            Number of consecutive failures before the loop exits.
        retry_backoff_seconds:
            Sleep duration between retry attempts after a failure.
        stop_event:
            Optional :class:`threading.Event`; the loop exits when set.
        """
        consecutive_failures = 0

        while True:
            if stop_event is not None and stop_event.is_set():
                logger.info(
                    "run_continuous: stop_event set — exiting stream=%s",
                    self._stream_id,
                )
                break

            cursor = self._store.get_cursor(self._stream_id)
            if cursor is None:
                logger.error(
                    "run_continuous: cursor vanished for stream=%s — aborting",
                    self._stream_id,
                )
                break

            current_ledger: int = cursor["last_ingested_ledger"]
            network_tip: int = get_network_tip_fn()
            batch_end = min(current_ledger + ledger_step, network_tip)

            if batch_end <= current_ledger:
                logger.debug(
                    "run_continuous stream=%s at tip (ledger=%d); sleeping %.1fs",
                    self._stream_id,
                    current_ledger,
                    poll_interval_seconds,
                )
                time.sleep(poll_interval_seconds)
                continue

            try:
                self.run_batch(fetch_fn, persist_fn, batch_end)
                consecutive_failures = 0  # reset on success
            except Exception as exc:
                consecutive_failures += 1
                logger.error(
                    "run_continuous stream=%s failure %d/%d: %s",
                    self._stream_id,
                    consecutive_failures,
                    max_retries_on_failure,
                    exc,
                )
                if consecutive_failures >= max_retries_on_failure:
                    logger.critical(
                        "run_continuous stream=%s exceeded max_retries=%d — stopping loop",
                        self._stream_id,
                        max_retries_on_failure,
                    )
                    break
                time.sleep(retry_backoff_seconds)

    # ------------------------------------------------------------------
    # Recovery helpers
    # ------------------------------------------------------------------

    def resume_from_safe_point(self) -> int:
        """
        If the cursor is in ``"failed"`` state, reset it to ``"idle"`` so it
        can be retried.  The cursor ledger is already at ``safe_ledger``
        (set during rollback), so no ledger adjustment is needed here.

        Returns the ledger that ingestion will resume from.
        """
        cursor = self._store.get_cursor(self._stream_id)
        if cursor is None:
            raise RuntimeError(
                f"Cannot resume: cursor not found for stream={self._stream_id!r}"
            )
        if cursor["status"] == "failed":
            self._store.mark_idle(self._stream_id)
            logger.info(
                "Cursor for stream=%s reset from 'failed' → 'idle'; will resume from ledger=%d",
                self._stream_id,
                cursor["last_ingested_ledger"],
            )
        return cursor["last_ingested_ledger"]

    def current_status(self) -> dict:
        """
        Return the current cursor dict, or raise if it is missing.
        """
        cursor = self._store.get_cursor(self._stream_id)
        if cursor is None:
            raise RuntimeError(
                f"No cursor found for stream={self._stream_id!r}"
            )
        return cursor

    # ------------------------------------------------------------------
    # Duplicate check
    # ------------------------------------------------------------------

    def is_duplicate_event(self, event_id: str) -> bool:
        """
        Delegate to :meth:`LedgerCursorStore.is_duplicate`.

        Returns ``True`` if *event_id* matches the last recorded event,
        indicating a likely duplicate at the batch boundary.
        """
        return self._store.is_duplicate(self._stream_id, event_id)
