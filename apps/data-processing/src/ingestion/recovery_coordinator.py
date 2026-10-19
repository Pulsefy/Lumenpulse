# -*- coding: utf-8 -*-
"""
Recovery Coordinator
====================
Coordinates resumable ledger ingestion using the persistent
:class:`~src.ingestion.ledger_cursor_store.LedgerCursorStore`.

The coordinator encapsulates the full begin → process → advance / rollback
lifecycle so individual ingestion callables do not need to understand cursor
mechanics.

New in this revision (#1451)
----------------------------
* **Failure classification** — :class:`FailureClassifier` decides whether an
  exception represents a *transient* condition (network glitch, rate-limit,
  temporary unavailability) or a *permanent* one (bad schema, auth error,
  validation failure).  Only transient failures are retried.

* **Retry with exponential back-off** — :class:`RetryPolicy` governs the
  maximum number of attempts, initial back-off, maximum back-off cap, and
  optional full jitter.  :meth:`RecoveryCoordinator.run_batch` retries the
  entire fetch → persist sequence according to this policy before giving up.

* **Exhausted-retry alerting** — when all retry attempts are consumed the
  coordinator fires an alert via :class:`~src.alert_notifier.AlertNotifier`
  so on-call engineers are notified without having to poll logs.

Typical usage
-------------
::

    coordinator = RecoveryCoordinator(
        store=LedgerCursorStore(),
        stream_id="contract:CABC...XYZ",
    )

    # One-shot: process a single batch (retries on transient failures)
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
import math
import random
import time
from dataclasses import dataclass, field
from enum import Enum
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
# Failure classification
# ---------------------------------------------------------------------------


class FailureKind(str, Enum):
    """High-level failure category returned by :class:`FailureClassifier`."""

    TRANSIENT = "transient"
    """Temporary condition — network blip, rate-limit, temporary outage.
    The operation *may* succeed if retried after a delay."""

    PERMANENT = "permanent"
    """Unrecoverable condition — validation error, bad schema, auth failure.
    Retrying will produce the same failure; skip to avoid infinite loops."""


# Substrings that appear in exception type names or messages that indicate
# the failure is transient.  Case-insensitive match.
_TRANSIENT_INDICATORS = (
    "network",
    "timeout",
    "timed out",
    "connection",
    "connectionerror",
    "connectionreset",
    "connecttimeout",
    "readtimeout",
    "ratelimit",
    "rate_limit",
    "too many requests",
    "service unavailable",
    "unavailable",
    "temporarily",
    "retry",
    "backoff",
    "throttl",
    "503",
    "504",
    "gateway",
    "overloaded",
    "ioerror",
    "oserror",
    "brokenpipe",
)

# Substrings that indicate a *permanent* failure.
_PERMANENT_INDICATORS = (
    "validation",
    "validationerror",
    "schema",
    "parse",
    "parseerror",
    "deserializ",
    "authentication",
    "unauthorized",
    "forbidden",
    "403",
    "401",
    "permissiondenied",
    "notfound",
    "typeerror",
    "valueerror",
    "assertionerror",
    "keyerror",
    "attributeerror",
    "invalid",
)


class FailureClassifier:
    """
    Classify an exception as :attr:`FailureKind.TRANSIENT` or
    :attr:`FailureKind.PERMANENT`.

    The classification is heuristic: it inspects the fully-qualified
    exception type name and the stringified message for known indicator
    substrings.  Permanent indicators take precedence over transient ones.
    If neither matches, the failure defaults to *transient* so that unknown
    errors receive at least one retry before the pipeline gives up.

    Parameters
    ----------
    extra_transient:
        Additional lower-case substrings to treat as transient.
    extra_permanent:
        Additional lower-case substrings to treat as permanent.
    """

    def __init__(
        self,
        extra_transient: tuple[str, ...] = (),
        extra_permanent: tuple[str, ...] = (),
    ) -> None:
        self._transient = _TRANSIENT_INDICATORS + extra_transient
        self._permanent = _PERMANENT_INDICATORS + extra_permanent

    def classify(self, exc: BaseException) -> FailureKind:
        """Return the failure kind for *exc*."""
        # Build a combined fingerprint from the type name + message.
        type_name = type(exc).__name__.lower()
        message = str(exc).lower()
        fingerprint = f"{type_name} {message}"

        # Permanent check takes priority.
        for indicator in self._permanent:
            if indicator in fingerprint:
                return FailureKind.PERMANENT

        for indicator in self._transient:
            if indicator in fingerprint:
                return FailureKind.TRANSIENT

        # Unknown failures default to transient (one retry attempt allowed).
        return FailureKind.TRANSIENT


# ---------------------------------------------------------------------------
# Retry policy
# ---------------------------------------------------------------------------


@dataclass
class RetryPolicy:
    """
    Parameters controlling the retry-with-back-off strategy.

    Parameters
    ----------
    max_attempts:
        Total number of attempts (initial try + retries).  Must be ≥ 1.
        Set to ``1`` to disable retries.
    base_backoff_seconds:
        Delay (in seconds) before the *second* attempt.  Subsequent delays
        are ``base_backoff_seconds * 2 ** (attempt - 1)``, capped by
        ``max_backoff_seconds``.
    max_backoff_seconds:
        Upper cap on the calculated delay.
    jitter:
        When ``True`` (default), apply full jitter by sampling from
        ``[0, calculated_delay]``.  This avoids thundering-herd when many
        streams retry simultaneously.
    """

    max_attempts: int = 3
    base_backoff_seconds: float = 2.0
    max_backoff_seconds: float = 60.0
    jitter: bool = True

    def __post_init__(self) -> None:
        if self.max_attempts < 1:
            raise ValueError("max_attempts must be >= 1")
        if self.base_backoff_seconds <= 0:
            raise ValueError("base_backoff_seconds must be > 0")
        if self.max_backoff_seconds < self.base_backoff_seconds:
            raise ValueError(
                "max_backoff_seconds must be >= base_backoff_seconds"
            )

    def delay_for_attempt(self, attempt: int) -> float:
        """
        Return the number of seconds to sleep before *attempt* (1-indexed).

        ``attempt == 1`` means the first retry (after the initial failure).
        Returns ``0.0`` for the first attempt (no pre-delay before the very
        first try).
        """
        if attempt <= 1:
            return 0.0
        # Exponential back-off: base * 2^(attempt-2) capped at max.
        raw = self.base_backoff_seconds * math.pow(2.0, attempt - 2)
        capped = min(raw, self.max_backoff_seconds)
        if self.jitter:
            return random.uniform(0.0, capped)
        return capped


# Default policy used when callers do not supply one.
DEFAULT_RETRY_POLICY = RetryPolicy()

# ---------------------------------------------------------------------------
# Coordinator
# ---------------------------------------------------------------------------


class RecoveryCoordinator:
    """
    Coordinates ledger ingestion with persistent cursor tracking,
    automatic retry with exponential back-off, failure classification,
    exhausted-retry alerting, and recovery on failure.

    Parameters
    ----------
    store:
        A :class:`LedgerCursorStore` instance.
    stream_id:
        The stream key to track (e.g. ``"global"`` or
        ``"contract:CABC...XYZ"``).
    retry_policy:
        Controls max attempts and back-off timing.  Defaults to
        :data:`DEFAULT_RETRY_POLICY` (3 attempts, 2-second base back-off,
        60-second cap, full jitter).
    classifier:
        Decides whether a failure is transient or permanent.  Defaults to
        :class:`FailureClassifier` with built-in heuristics.
    notifier:
        An :class:`~src.alert_notifier.AlertNotifier`-like object used to
        fire an alert when retries are exhausted.  If ``None``, a default
        instance is constructed lazily the first time it is needed.
    """

    def __init__(
        self,
        store: LedgerCursorStore,
        stream_id: str,
        retry_policy: Optional[RetryPolicy] = None,
        classifier: Optional[FailureClassifier] = None,
        notifier: Optional[Any] = None,
    ) -> None:
        self._store = store
        self._stream_id = stream_id
        self._retry_policy = retry_policy or DEFAULT_RETRY_POLICY
        self._classifier = classifier or FailureClassifier()
        self._notifier = notifier  # lazily initialised if None

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

    @property
    def retry_policy(self) -> RetryPolicy:
        return self._retry_policy

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _get_notifier(self) -> Any:
        """Return the alert notifier, constructing the default lazily."""
        if self._notifier is None:
            from src.alert_notifier import AlertNotifier

            self._notifier = AlertNotifier()
        return self._notifier

    def _send_exhausted_alert(
        self,
        batch_end_ledger: int,
        attempt_count: int,
        last_exc: BaseException,
    ) -> None:
        """Fire an alert that retries for this batch have been exhausted."""
        try:
            notifier = self._get_notifier()
            # Build a minimal anomaly-like object so the existing notifier
            # path can route the alert without a schema change.
            payload = {
                "event": "retry_exhausted",
                "stream_id": self._stream_id,
                "batch_end_ledger": batch_end_ledger,
                "attempts": attempt_count,
                "last_error": f"{type(last_exc).__name__}: {last_exc}",
            }
            # Use the generic webhook/Telegram path if available.
            if hasattr(notifier, "_send_webhooks"):
                notifier._send_webhooks(payload)
            if hasattr(notifier, "_send_telegram_text"):
                notifier._send_telegram_text(
                    f"🚨 Ingestion retry exhausted\n"
                    f"stream={self._stream_id}\n"
                    f"batch_end_ledger={batch_end_ledger}\n"
                    f"attempts={attempt_count}\n"
                    f"error={type(last_exc).__name__}: {last_exc}"
                )
        except Exception as alert_exc:  # noqa: BLE001
            logger.error(
                "Failed to send retry-exhausted alert for stream=%s: %s",
                self._stream_id,
                alert_exc,
            )

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
        Ingest one batch of events from ``(last_safe_ledger, batch_end_ledger]``
        with automatic retry on transient failures.

        Steps
        -----
        1. Load current cursor state.
        2. Call ``store.begin_batch`` — saves a safe-point and marks status
           as ``"ingesting"``.
        3. Attempt up to ``retry_policy.max_attempts`` times:

           a. Call ``fetch_fn(safe_ledger, batch_end_ledger)`` — retrieve events.
           b. Call ``persist_fn(events)`` — persist and return last event_id.
           c. On :class:`DuplicateEventError`, advance the cursor (idempotent
              re-run) and return.
           d. On any other exception, classify it:

              - **Transient**: rollback, sleep with back-off, retry.
              - **Permanent**: rollback and re-raise immediately (no more
                attempts).

        4. If all attempts are exhausted, fire an alert, rollback, and
           re-raise the last exception.
        5. Call ``store.advance`` — commit the new high-water mark.

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
        last_exc: Optional[BaseException] = None
        policy = self._retry_policy

        for attempt in range(1, policy.max_attempts + 1):
            # Sleep before every retry (attempt > 1).
            delay = policy.delay_for_attempt(attempt)
            if delay > 0:
                logger.info(
                    "stream=%s batch (%d, %d] retry %d/%d — sleeping %.2fs",
                    self._stream_id,
                    safe_ledger,
                    batch_end_ledger,
                    attempt,
                    policy.max_attempts,
                    delay,
                )
                time.sleep(delay)

            try:
                events = fetch_fn(safe_ledger, batch_end_ledger)
                last_event_id = persist_fn(events)
                # Success — break out of the retry loop.
                last_exc = None
                break

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
                last_exc = None
                break

            except Exception as exc:  # noqa: BLE001
                last_exc = exc
                kind = self._classifier.classify(exc)

                rolled_back_to = self._store.rollback_to_safe_point(
                    self._stream_id,
                    error_message=f"{type(exc).__name__}: {exc}",
                )
                logger.error(
                    "Ingestion failed stream=%s batch (%d, %d] attempt=%d/%d "
                    "kind=%s rolled_back_to=%d error=%s",
                    self._stream_id,
                    safe_ledger,
                    batch_end_ledger,
                    attempt,
                    policy.max_attempts,
                    kind.value,
                    rolled_back_to,
                    exc,
                    exc_info=True,
                )

                if kind == FailureKind.PERMANENT:
                    logger.error(
                        "stream=%s permanent failure — not retrying. error=%s",
                        self._stream_id,
                        exc,
                    )
                    raise

                # Transient: continue the retry loop (delay applied at the
                # top of the next iteration).
                if attempt == policy.max_attempts:
                    # This was the last attempt.
                    break

        # ----------------------------------------------------------------
        # Retry loop finished — check if we still have an outstanding error.
        # ----------------------------------------------------------------
        if last_exc is not None:
            logger.critical(
                "stream=%s exhausted %d/%d retry attempts — alerting and giving up. error=%s",
                self._stream_id,
                policy.max_attempts,
                policy.max_attempts,
                last_exc,
            )
            self._send_exhausted_alert(
                batch_end_ledger=batch_end_ledger,
                attempt_count=policy.max_attempts,
                last_exc=last_exc,
            )
            raise last_exc

        # ----------------------------------------------------------------
        # All good — advance the cursor.
        # ----------------------------------------------------------------
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
            Note: each call to :meth:`run_batch` already retries internally
            according to the :class:`RetryPolicy`; this counter tracks
            *batch-level* consecutive failures in the continuous loop.
        retry_backoff_seconds:
            Sleep duration between batch-level retry attempts after a
            batch failure.
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
                    "run_continuous stream=%s batch-level failure %d/%d: %s",
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
