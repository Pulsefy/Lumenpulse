# -*- coding: utf-8 -*-
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

    # Named-stage pipeline: run stages with retry, skip downstream on failure
    policy = StageRetryPolicy(max_attempts=4, base_backoff_seconds=2.0)
    run_pipeline_with_retry(
        stages=[("fetch", fetch_stage), ("transform", transform_stage)],
        policy=policy,
        registry=PipelineRunRegistry(),
        notifier=AlertNotifier(),
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
* Transient vs permanent errors: raise :class:`TransientError` for network
  blips or temporary unavailability (will be retried with exponential backoff).
  Raise :class:`PermanentError` for validation failures or schema mismatches
  (will not be retried; downstream stages are skipped immediately).
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Tuple

from src.ingestion.ledger_cursor_store import LedgerCursorStore

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Sentinel exceptions
# ---------------------------------------------------------------------------


class DuplicateEventError(Exception):
    """
    Raised by *persist_fn* when all events in a batch have already been
    persisted (e.g. unique-constraint violation on ``event_id``).

    The coordinator treats this as a safe no-op and advances the cursor.
    """


class TransientError(Exception):
    """
    Raised to signal a temporary, retriable failure (e.g. network timeout,
    rate-limit response, database deadlock).

    The retry engine will back off and re-attempt the stage up to the
    ``max_attempts`` budget configured in :class:`StageRetryPolicy`.
    """


class PermanentError(Exception):
    """
    Raised to signal a non-retriable failure (e.g. schema mismatch, bad
    payload, programming error).

    The retry engine will immediately record the stage as permanently failed,
    fire an alert, and skip all downstream stages that depend on it.
    """


# ---------------------------------------------------------------------------
# Retry policy
# ---------------------------------------------------------------------------


@dataclass
class StageRetryPolicy:
    """Configuration for the per-stage retry / back-off strategy.

    Parameters
    ----------
    max_attempts:
        Maximum number of times a stage may be attempted (including the
        first try).  Must be ≥ 1.  A value of 1 means no retries — the
        first failure is treated as permanent.
    base_backoff_seconds:
        Initial sleep duration after the first failure.  Each subsequent
        failure doubles this value (exponential back-off with optional
        jitter via ``jitter_factor``).
    max_backoff_seconds:
        Upper bound on the computed back-off to prevent unbounded sleep.
    jitter_factor:
        Fraction of the base sleep to add as uniform random noise, e.g.
        ``0.1`` adds ±10 % jitter.  Set to 0.0 to disable jitter.
    treat_unknown_as_transient:
        When ``True`` (the default), any exception that is *not* a
        :class:`PermanentError` is treated as transient and retried.
        When ``False``, only :class:`TransientError` is retried; any
        other exception is promoted to a permanent failure immediately.
    """

    max_attempts: int = 3
    base_backoff_seconds: float = 1.0
    max_backoff_seconds: float = 60.0
    jitter_factor: float = 0.1
    treat_unknown_as_transient: bool = True

    def backoff_for(self, attempt: int) -> float:
        """Compute the sleep duration after *attempt* (1-based).

        Returns a value in ``[0, max_backoff_seconds]``.
        """
        import random

        raw = self.base_backoff_seconds * (2 ** (attempt - 1))
        capped = min(raw, self.max_backoff_seconds)
        jitter = random.uniform(-self.jitter_factor, self.jitter_factor) * capped
        return max(0.0, capped + jitter)


# ---------------------------------------------------------------------------
# Stage execution result
# ---------------------------------------------------------------------------


@dataclass
class StageResult:
    """Outcome of a single stage execution attempt."""

    stage_id: str
    succeeded: bool
    skipped: bool = False
    permanent_failure: bool = False
    attempts: int = 0
    error: Optional[str] = None
    skipped_because: Optional[str] = None  # upstream stage_id


# ---------------------------------------------------------------------------
# Core per-stage retry runner
# ---------------------------------------------------------------------------


def run_stage_with_retry(
    stage_id: str,
    stage_fn: Callable[[], Any],
    policy: StageRetryPolicy,
    registry: Optional[Any] = None,
    notifier: Optional[Any] = None,
    downstream_stage_ids: Optional[Sequence[str]] = None,
    sleep_fn: Callable[[float], None] = time.sleep,
) -> StageResult:
    """Run *stage_fn* with automatic retry and exponential back-off.

    Parameters
    ----------
    stage_id:
        Human-readable identifier for this stage (used in logs and registry).
    stage_fn:
        Zero-argument callable that executes the stage.  It should raise
        :class:`TransientError` for retriable problems and
        :class:`PermanentError` for non-retriable ones.  Any other exception
        is treated according to ``policy.treat_unknown_as_transient``.
    policy:
        :class:`StageRetryPolicy` controlling retry count and back-off timing.
    registry:
        Optional :class:`~src.pipeline_run_registry.PipelineRunRegistry`
        instance.  When supplied, each attempt is recorded (retry, permanently
        failed, or success).
    notifier:
        Optional :class:`~src.alert_notifier.AlertNotifier` instance.  When
        supplied, ``notify_stage_permanent_failure`` is called once the stage
        exhausts its retry budget.
    downstream_stage_ids:
        List of stage IDs that depend on this one.  Used only to populate the
        alert body and the ``skipped_because`` registry entries.
    sleep_fn:
        Injectable sleep function (default: ``time.sleep``).  Override in
        tests to avoid real delays.

    Returns
    -------
    StageResult
        Whether the stage succeeded, was skipped, or permanently failed.
    """
    if registry is not None:
        registry.record_start(stage_id)

    last_error: Optional[Exception] = None

    for attempt in range(1, policy.max_attempts + 1):
        try:
            stage_fn()
            # Success — record and return
            if registry is not None:
                registry.record_finish(stage_id, outcome="success")
            logger.info("Stage %r succeeded on attempt %d", stage_id, attempt)
            return StageResult(
                stage_id=stage_id,
                succeeded=True,
                attempts=attempt,
            )

        except PermanentError as exc:
            # Non-retriable: give up immediately
            last_error = exc
            logger.error(
                "Stage %r permanently failed on attempt %d: %s",
                stage_id,
                attempt,
                exc,
            )
            break

        except Exception as exc:
            last_error = exc
            is_transient = isinstance(exc, TransientError) or policy.treat_unknown_as_transient
            if not is_transient:
                logger.error(
                    "Stage %r non-transient failure on attempt %d: %s",
                    stage_id,
                    attempt,
                    exc,
                )
                break

            # Transient: record the retry and back off (if attempts remain)
            if attempt < policy.max_attempts:
                backoff = policy.backoff_for(attempt)
                next_retry_at = datetime.fromtimestamp(
                    time.time() + backoff, tz=timezone.utc
                ).isoformat()
                logger.warning(
                    "Stage %r transient failure (attempt %d/%d): %s — retrying in %.2fs",
                    stage_id,
                    attempt,
                    policy.max_attempts,
                    exc,
                    backoff,
                )
                if registry is not None:
                    registry.record_retry(
                        stage_id=stage_id,
                        attempt=attempt,
                        max_attempts=policy.max_attempts,
                        error=str(exc),
                        next_retry_at=next_retry_at,
                    )
                sleep_fn(backoff)
            else:
                logger.error(
                    "Stage %r transient failure on final attempt %d/%d: %s",
                    stage_id,
                    attempt,
                    policy.max_attempts,
                    exc,
                )

    # All attempts exhausted (or non-retriable break) → permanent failure
    error_str = str(last_error) if last_error is not None else "unknown error"

    if registry is not None:
        registry.record_permanently_failed(
            stage_id=stage_id,
            attempts=attempt,  # noqa: F821 — defined in loop above
            error=error_str,
        )

    if notifier is not None:
        try:
            notifier.notify_stage_permanent_failure(
                stage_id=stage_id,
                total_attempts=attempt,  # noqa: F821
                error=error_str,
                downstream_skipped=list(downstream_stage_ids or []),
            )
        except Exception:
            logger.exception("Alert delivery failed for stage=%r", stage_id)

    return StageResult(
        stage_id=stage_id,
        succeeded=False,
        permanent_failure=True,
        attempts=attempt,  # noqa: F821
        error=error_str,
    )


# ---------------------------------------------------------------------------
# Pipeline runner: ordered stages with downstream skip
# ---------------------------------------------------------------------------


def run_pipeline_with_retry(
    stages: Sequence[Tuple[str, Callable[[], Any]]],
    policy: StageRetryPolicy,
    registry: Optional[Any] = None,
    notifier: Optional[Any] = None,
    sleep_fn: Callable[[float], None] = time.sleep,
) -> List[StageResult]:
    """Run a linear sequence of named stages, skipping downstream of failures.

    Stages are executed in order.  When a stage permanently fails, all
    remaining stages are marked as skipped (recorded in the registry) rather
    than run on incomplete input.

    Parameters
    ----------
    stages:
        Ordered sequence of ``(stage_id, callable)`` pairs.
    policy:
        Retry policy applied to every stage.
    registry:
        Optional registry for recording outcomes.
    notifier:
        Optional notifier for permanent-failure alerts.
    sleep_fn:
        Injectable sleep function for testing.

    Returns
    -------
    list[StageResult]
        One :class:`StageResult` per stage, in execution order.
    """
    results: List[StageResult] = []
    failed_upstream: Optional[str] = None

    # Build a list of all stage IDs so we can tell the notifier which will be
    # skipped when we fire the alert for the failing stage.
    all_stage_ids = [sid for sid, _ in stages]

    for idx, (stage_id, stage_fn) in enumerate(stages):
        if failed_upstream is not None:
            # Skip this stage — upstream permanently failed
            logger.warning(
                "Skipping stage %r because upstream stage %r permanently failed",
                stage_id,
                failed_upstream,
            )
            if registry is not None:
                registry.record_skipped(
                    stage_id=stage_id,
                    skipped_because=failed_upstream,
                )
            results.append(
                StageResult(
                    stage_id=stage_id,
                    succeeded=False,
                    skipped=True,
                    skipped_because=failed_upstream,
                )
            )
            continue

        downstream_ids = all_stage_ids[idx + 1 :]
        result = run_stage_with_retry(
            stage_id=stage_id,
            stage_fn=stage_fn,
            policy=policy,
            registry=registry,
            notifier=notifier,
            downstream_stage_ids=downstream_ids,
            sleep_fn=sleep_fn,
        )
        results.append(result)

        if result.permanent_failure:
            failed_upstream = stage_id

    return results


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
        retry_policy: Optional[StageRetryPolicy] = None,
        registry: Optional[Any] = None,
        notifier: Optional[Any] = None,
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
            Number of consecutive failures before the loop exits.  Ignored
            when *retry_policy* is supplied.
        retry_backoff_seconds:
            Sleep duration between retry attempts after a failure.  Ignored
            when *retry_policy* is supplied.
        stop_event:
            Optional :class:`threading.Event`; the loop exits when set.
        retry_policy:
            When provided, each batch is wrapped in
            :func:`run_stage_with_retry` using this policy.  Overrides the
            legacy ``max_retries_on_failure`` / ``retry_backoff_seconds``
            parameters.
        registry:
            Optional :class:`~src.pipeline_run_registry.PipelineRunRegistry`.
            Passed through to :func:`run_stage_with_retry`.
        notifier:
            Optional :class:`~src.alert_notifier.AlertNotifier`.  When the
            batch exhausts its retry budget, a permanent-failure alert fires.
        """
        # Build a StageRetryPolicy from legacy params if none was supplied.
        effective_policy = retry_policy or StageRetryPolicy(
            max_attempts=max_retries_on_failure,
            base_backoff_seconds=retry_backoff_seconds,
            jitter_factor=0.0,
        )

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

            stage_id = f"{self._stream_id}:batch:{batch_end}"

            def _batch_fn(
                _fetch=fetch_fn,
                _persist=persist_fn,
                _end=batch_end,
            ) -> None:
                self.run_batch(_fetch, _persist, _end)

            result = run_stage_with_retry(
                stage_id=stage_id,
                stage_fn=_batch_fn,
                policy=effective_policy,
                registry=registry,
                notifier=notifier,
            )

            if result.succeeded:
                consecutive_failures = 0
            else:
                consecutive_failures += 1
                logger.error(
                    "run_continuous stream=%s batch permanently failed (%d consecutive failures)",
                    self._stream_id,
                    consecutive_failures,
                )
                break

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
