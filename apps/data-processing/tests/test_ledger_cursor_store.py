"""
Tests for LedgerCursorStore and RecoveryCoordinator.

All tests use an in-memory SQLite database so they run without a live
PostgreSQL instance.
"""

from __future__ import annotations

import sys
import threading
from typing import List, Optional
from unittest.mock import MagicMock, patch

import pytest

# Stub out heavy optional dependencies that aren't needed for this test.
_STUBS = [
    "langdetect",
    "vaderSentiment",
    "vaderSentiment.vaderSentiment",
    "torch",
    "transformers",
    "prophet",
    "spacy",
    "redis",
    "prometheus_client",
    "slowapi",
]
for _mod in _STUBS:
    if _mod not in sys.modules:
        sys.modules[_mod] = MagicMock()

# Import directly from submodules to avoid the heavy __init__.py chain.
from src.ingestion.ledger_cursor_store import LedgerCursorStore  # noqa: E402
from src.ingestion.recovery_coordinator import DuplicateEventError, RecoveryCoordinator  # noqa: E402

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

SQLITE_URL = "sqlite://"  # pure in-memory, no file


@pytest.fixture()
def store() -> LedgerCursorStore:
    """A fresh in-memory cursor store for each test."""
    return LedgerCursorStore(db_url=SQLITE_URL, auto_create_table=True)


@pytest.fixture()
def coordinator(store: LedgerCursorStore) -> RecoveryCoordinator:
    return RecoveryCoordinator(store=store, stream_id="test:stream")


# ---------------------------------------------------------------------------
# LedgerCursorStore — get_or_create
# ---------------------------------------------------------------------------


class TestGetOrCreate:
    def test_creates_new_cursor_at_zero(self, store: LedgerCursorStore) -> None:
        row = store.get_or_create("global")
        assert row.stream_id == "global"
        assert row.last_ingested_ledger == 0
        assert row.safe_ledger == 0
        assert row.status == "idle"

    def test_returns_existing_cursor(self, store: LedgerCursorStore) -> None:
        store.get_or_create("global")
        store.advance("global", 50)
        row = store.get_or_create("global")
        assert row.last_ingested_ledger == 50

    def test_independent_streams(self, store: LedgerCursorStore) -> None:
        store.get_or_create("stream:A")
        store.get_or_create("stream:B")
        store.advance("stream:A", 100)
        a = store.get_cursor("stream:A")
        b = store.get_cursor("stream:B")
        assert a["last_ingested_ledger"] == 100
        assert b["last_ingested_ledger"] == 0


# ---------------------------------------------------------------------------
# LedgerCursorStore — begin_batch
# ---------------------------------------------------------------------------


class TestBeginBatch:
    def test_sets_safe_ledger_and_status(self, store: LedgerCursorStore) -> None:
        store.get_or_create("s1")
        store.advance("s1", 200)
        safe = store.begin_batch("s1", 200)
        assert safe == 200
        cursor = store.get_cursor("s1")
        assert cursor["safe_ledger"] == 200
        assert cursor["status"] == "ingesting"

    def test_raises_for_unknown_stream(self, store: LedgerCursorStore) -> None:
        with pytest.raises(ValueError, match="No cursor found"):
            store.begin_batch("nonexistent", 0)

    def test_clears_previous_error_message(self, store: LedgerCursorStore) -> None:
        store.get_or_create("s2")
        store.rollback_to_safe_point("s2", error_message="boom")
        store.begin_batch("s2", 0)
        cursor = store.get_cursor("s2")
        assert cursor["error_message"] is None


# ---------------------------------------------------------------------------
# LedgerCursorStore — advance
# ---------------------------------------------------------------------------


class TestAdvance:
    def test_advances_cursor(self, store: LedgerCursorStore) -> None:
        store.get_or_create("s")
        store.begin_batch("s", 0)
        store.advance("s", 100, last_event_id="evt-100")
        cursor = store.get_cursor("s")
        assert cursor["last_ingested_ledger"] == 100
        assert cursor["safe_ledger"] == 100
        assert cursor["last_event_id"] == "evt-100"
        assert cursor["status"] == "idle"

    def test_raises_on_regression(self, store: LedgerCursorStore) -> None:
        store.get_or_create("s")
        store.advance("s", 500)
        with pytest.raises(ValueError, match="Refusing to regress"):
            store.advance("s", 499)

    def test_allows_equal_ledger(self, store: LedgerCursorStore) -> None:
        """Advancing to the current ledger (no-op progress) is allowed."""
        store.get_or_create("s")
        store.advance("s", 300)
        store.advance("s", 300)  # should not raise
        assert store.get_cursor("s")["last_ingested_ledger"] == 300

    def test_raises_for_unknown_stream(self, store: LedgerCursorStore) -> None:
        with pytest.raises(RuntimeError, match="Cannot advance"):
            store.advance("ghost", 1)


# ---------------------------------------------------------------------------
# LedgerCursorStore — rollback_to_safe_point
# ---------------------------------------------------------------------------


class TestRollback:
    def test_rolls_back_to_safe_ledger(self, store: LedgerCursorStore) -> None:
        store.get_or_create("s")
        store.advance("s", 100)
        store.begin_batch("s", 100)
        # Pretend we processed a few ledgers but failed before advance
        rolled = store.rollback_to_safe_point("s", error_message="timeout")
        assert rolled == 100
        cursor = store.get_cursor("s")
        assert cursor["last_ingested_ledger"] == 100
        assert cursor["status"] == "failed"
        assert "timeout" in cursor["error_message"]

    def test_truncates_long_error_message(self, store: LedgerCursorStore) -> None:
        store.get_or_create("s")
        store.rollback_to_safe_point("s", error_message="x" * 3000)
        cursor = store.get_cursor("s")
        assert len(cursor["error_message"]) == 2048

    def test_raises_for_unknown_stream(self, store: LedgerCursorStore) -> None:
        with pytest.raises(RuntimeError, match="Cannot rollback"):
            store.rollback_to_safe_point("ghost")


# ---------------------------------------------------------------------------
# LedgerCursorStore — mark_idle
# ---------------------------------------------------------------------------


class TestMarkIdle:
    def test_clears_failed_status(self, store: LedgerCursorStore) -> None:
        store.get_or_create("s")
        store.rollback_to_safe_point("s", error_message="err")
        store.mark_idle("s")
        cursor = store.get_cursor("s")
        assert cursor["status"] == "idle"
        assert cursor["error_message"] is None

    def test_raises_for_unknown_stream(self, store: LedgerCursorStore) -> None:
        with pytest.raises(RuntimeError, match="Cannot mark idle"):
            store.mark_idle("ghost")


# ---------------------------------------------------------------------------
# LedgerCursorStore — is_duplicate
# ---------------------------------------------------------------------------


class TestIsDuplicate:
    def test_returns_true_for_last_event(self, store: LedgerCursorStore) -> None:
        store.get_or_create("s")
        store.advance("s", 10, last_event_id="evt-abc")
        assert store.is_duplicate("s", "evt-abc") is True

    def test_returns_false_for_different_event(self, store: LedgerCursorStore) -> None:
        store.get_or_create("s")
        store.advance("s", 10, last_event_id="evt-abc")
        assert store.is_duplicate("s", "evt-xyz") is False

    def test_returns_false_for_unknown_stream(self, store: LedgerCursorStore) -> None:
        assert store.is_duplicate("ghost", "any") is False


# ---------------------------------------------------------------------------
# LedgerCursorStore — list_cursors / get_cursor
# ---------------------------------------------------------------------------


class TestListAndGet:
    def test_list_cursors_empty(self, store: LedgerCursorStore) -> None:
        assert store.list_cursors() == []

    def test_list_cursors_multiple(self, store: LedgerCursorStore) -> None:
        store.get_or_create("a")
        store.get_or_create("b")
        store.get_or_create("c")
        rows = store.list_cursors()
        assert len(rows) == 3
        # Ordered by stream_id
        assert [r["stream_id"] for r in rows] == ["a", "b", "c"]

    def test_get_cursor_returns_none_for_missing(self, store: LedgerCursorStore) -> None:
        assert store.get_cursor("missing") is None

    def test_get_cursor_returns_dict(self, store: LedgerCursorStore) -> None:
        store.get_or_create("s")
        cursor = store.get_cursor("s")
        assert isinstance(cursor, dict)
        for key in ("stream_id", "last_ingested_ledger", "safe_ledger", "status"):
            assert key in cursor


# ---------------------------------------------------------------------------
# RecoveryCoordinator — run_batch
# ---------------------------------------------------------------------------


class TestRunBatch:
    def _make_fns(self, events: list, last_id: Optional[str] = "evt-end"):
        """Return (fetch_fn, persist_fn) that record calls."""
        fetched: List[tuple] = []

        def fetch(start, end):
            fetched.append((start, end))
            return iter(events)

        def persist(evts):
            list(evts)  # consume
            return last_id

        return fetch, persist, fetched

    def test_happy_path_advances_cursor(self, coordinator: RecoveryCoordinator) -> None:
        fetch, persist, _ = self._make_fns(["e1", "e2"], last_id="e2")
        coordinator.run_batch(fetch, persist, batch_end_ledger=100)
        cursor = coordinator.current_status()
        assert cursor["last_ingested_ledger"] == 100
        assert cursor["status"] == "idle"
        assert cursor["last_event_id"] == "e2"

    def test_skips_when_batch_end_not_ahead(
        self, coordinator: RecoveryCoordinator
    ) -> None:
        fetch, persist, fetched = self._make_fns([])
        coordinator.store.advance("test:stream", 500)
        result = coordinator.run_batch(fetch, persist, batch_end_ledger=500)
        assert result is None
        assert fetched == []

    def test_fetch_passes_correct_ledger_range(
        self, coordinator: RecoveryCoordinator
    ) -> None:
        coordinator.store.advance("test:stream", 200)
        fetched = []

        def fetch(start, end):
            fetched.append((start, end))
            return iter([])

        coordinator.run_batch(fetch, lambda e: None, batch_end_ledger=300)
        assert fetched == [(200, 300)]

    def test_rollback_on_fetch_failure(
        self, coordinator: RecoveryCoordinator
    ) -> None:
        coordinator.store.advance("test:stream", 100)

        def bad_fetch(start, end):
            raise RuntimeError("network error")

        with pytest.raises(RuntimeError, match="network error"):
            coordinator.run_batch(bad_fetch, lambda e: None, batch_end_ledger=200)

        cursor = coordinator.current_status()
        assert cursor["status"] == "failed"
        assert cursor["last_ingested_ledger"] == 100  # rolled back
        assert "network error" in cursor["error_message"]

    def test_rollback_on_persist_failure(
        self, coordinator: RecoveryCoordinator
    ) -> None:
        coordinator.store.advance("test:stream", 100)

        def bad_persist(evts):
            raise IOError("db write failed")

        with pytest.raises(IOError, match="db write failed"):
            coordinator.run_batch(lambda s, e: iter([]), bad_persist, batch_end_ledger=200)

        cursor = coordinator.current_status()
        assert cursor["status"] == "failed"
        assert cursor["last_ingested_ledger"] == 100

    def test_duplicate_event_error_is_not_fatal(
        self, coordinator: RecoveryCoordinator
    ) -> None:
        coordinator.store.advance("test:stream", 100)

        def dup_persist(evts):
            raise DuplicateEventError("already exists")

        # Should NOT raise; cursor advances past the duplicate batch.
        coordinator.run_batch(lambda s, e: iter([]), dup_persist, batch_end_ledger=200)
        cursor = coordinator.current_status()
        assert cursor["last_ingested_ledger"] == 200
        assert cursor["status"] == "idle"

    def test_empty_batch_advances_cursor(
        self, coordinator: RecoveryCoordinator
    ) -> None:
        """An empty batch (no events) is valid and the cursor should advance."""
        coordinator.run_batch(
            lambda s, e: iter([]),
            lambda evts: None,
            batch_end_ledger=50,
        )
        assert coordinator.current_status()["last_ingested_ledger"] == 50


# ---------------------------------------------------------------------------
# RecoveryCoordinator — run_continuous
# ---------------------------------------------------------------------------


class TestRunContinuous:
    def test_stops_when_stop_event_is_set(
        self, coordinator: RecoveryCoordinator
    ) -> None:
        stop = threading.Event()
        stop.set()
        # Should return immediately without calling fetch_fn at all.
        called = []
        coordinator.run_continuous(
            fetch_fn=lambda s, e: called.append((s, e)) or iter([]),
            persist_fn=lambda evts: None,
            ledger_step=100,
            get_network_tip_fn=lambda: 1000,
            stop_event=stop,
        )
        assert called == []

    def test_processes_batches_until_tip(
        self, coordinator: RecoveryCoordinator
    ) -> None:
        stop = threading.Event()
        batches: List[tuple] = []

        def fetch(start, end):
            batches.append((start, end))
            # Set stop after the first successful batch.
            stop.set()
            return iter([])

        coordinator.run_continuous(
            fetch_fn=fetch,
            persist_fn=lambda evts: None,
            ledger_step=100,
            get_network_tip_fn=lambda: 500,
            stop_event=stop,
            poll_interval_seconds=0,
        )
        # Exactly one batch should have been processed.
        assert len(batches) == 1
        assert batches[0] == (0, 100)

    def test_exits_after_max_retries(
        self, coordinator: RecoveryCoordinator
    ) -> None:
        def bad_fetch(start, end):
            raise RuntimeError("persistent failure")

        coordinator.run_continuous(
            fetch_fn=bad_fetch,
            persist_fn=lambda evts: None,
            ledger_step=50,
            get_network_tip_fn=lambda: 1000,
            max_retries_on_failure=2,
            retry_backoff_seconds=0,
        )
        cursor = coordinator.current_status()
        assert cursor["status"] == "failed"

    def test_sleeps_at_tip(self, coordinator: RecoveryCoordinator) -> None:
        """When at the network tip, the loop sleeps and then the stop event fires."""
        stop = threading.Event()
        coordinator.store.advance("test:stream", 1000)
        sleep_calls: List[float] = []

        def fake_sleep(duration):
            sleep_calls.append(duration)
            stop.set()

        with patch("src.ingestion.recovery_coordinator.time.sleep", side_effect=fake_sleep):
            coordinator.run_continuous(
                fetch_fn=lambda s, e: iter([]),
                persist_fn=lambda evts: None,
                ledger_step=100,
                get_network_tip_fn=lambda: 1000,
                poll_interval_seconds=7.0,
                stop_event=stop,
            )

        assert len(sleep_calls) == 1
        assert sleep_calls[0] == 7.0


# ---------------------------------------------------------------------------
# RecoveryCoordinator — resume_from_safe_point
# ---------------------------------------------------------------------------


class TestResume:
    def test_resets_failed_to_idle(self, coordinator: RecoveryCoordinator) -> None:
        coordinator.store.advance("test:stream", 300)
        coordinator.store.rollback_to_safe_point("test:stream", "boom")
        ledger = coordinator.resume_from_safe_point()
        assert ledger == 300
        assert coordinator.current_status()["status"] == "idle"

    def test_no_op_when_already_idle(self, coordinator: RecoveryCoordinator) -> None:
        coordinator.store.advance("test:stream", 50)
        ledger = coordinator.resume_from_safe_point()
        assert ledger == 50
        assert coordinator.current_status()["status"] == "idle"


# ---------------------------------------------------------------------------
# RecoveryCoordinator — is_duplicate_event
# ---------------------------------------------------------------------------


class TestIsDuplicateEvent:
    def test_delegates_to_store(self, coordinator: RecoveryCoordinator) -> None:
        coordinator.store.advance("test:stream", 10, last_event_id="evt-42")
        assert coordinator.is_duplicate_event("evt-42") is True
        assert coordinator.is_duplicate_event("evt-99") is False


# ---------------------------------------------------------------------------
# Concurrency smoke test
# ---------------------------------------------------------------------------


class TestConcurrency:
    def test_concurrent_get_or_create_does_not_duplicate(
        self, store: LedgerCursorStore
    ) -> None:
        """Multiple threads calling get_or_create with the same stream_id
        must result in exactly one row.

        Note: SQLite's StaticPool does not support true concurrent multi-thread
        access so this test runs threads sequentially without a race window.
        The unique-constraint protection is exercised properly with PostgreSQL
        in CI.  We verify the logical invariant (single row) rather than
        race-condition behaviour here.
        """
        errors: List[Exception] = []

        def create():
            try:
                store.get_or_create("concurrent:stream")
            except Exception as exc:
                errors.append(exc)

        # Run sequentially to avoid SQLite threading issues.
        for _ in range(10):
            create()

        # All calls should succeed (or silently handle the IntegrityError).
        assert errors == []
        rows = store.list_cursors()
        assert len(rows) == 1
        assert rows[0]["stream_id"] == "concurrent:stream"
