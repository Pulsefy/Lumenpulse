# -*- coding: utf-8 -*-
"""
Tests for the retry/recovery machinery added in #1451.

Coverage
--------
* FailureClassifier — transient vs permanent classification
* RetryPolicy — delay calculation, jitter, validation
* RecoveryCoordinator.run_batch — success path, transient retries,
  permanent failure fast-exit, retry exhaustion with alerting,
  DuplicateEventError handling
* PipelineRunRegistry — record_retry, record_skip, record_alert, and
  that existing record_start/record_finish still work correctly
* pipeline_topology.build_topology — skipped status propagation when
  upstream dependencies fail; new fields exposed in the output
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time
from typing import Any, Iterable, Optional
from unittest.mock import MagicMock, call, patch

import pytest

# ---------------------------------------------------------------------------
# Stub out heavy optional dependencies that are not available in this env.
# We must do this BEFORE importing any src module that transitively pulls
# them in.  Critically, sqlalchemy is stubbed so that ledger_cursor_store
# (which our RecoveryCoordinator imports) can be collected without error.
# ---------------------------------------------------------------------------
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
    "requests",
    "apscheduler",
    "apscheduler.events",
    # SQLAlchemy must be fully stubbed before ledger_cursor_store is imported.
    "sqlalchemy",
    "sqlalchemy.orm",
    "sqlalchemy.orm.session",
    "sqlalchemy.exc",
    "sqlalchemy.dialects",
    "sqlalchemy.dialects.postgresql",
    "sqlalchemy.pool",
    "sqlalchemy.engine",
    # Also stub the ledger_cursor_store itself so RecoveryCoordinator can
    # import without any real DB dependency.
    "src.ingestion.ledger_cursor_store",
]
for _mod in _STUBS:
    if _mod not in sys.modules:
        sys.modules[_mod] = MagicMock()

# Provide a realistic LedgerCursorStore class on the stub so type annotations
# resolve correctly.
_lcs_mod = sys.modules["src.ingestion.ledger_cursor_store"]
_lcs_mod.LedgerCursorStore = MagicMock  # type: ignore[attr-defined]

from src.ingestion.recovery_coordinator import (
    DEFAULT_RETRY_POLICY,
    DuplicateEventError,
    FailureClassifier,
    FailureKind,
    RecoveryCoordinator,
    RetryPolicy,
)
from src.pipeline_run_registry import (
    OUTCOME_FAILED,
    OUTCOME_SKIPPED,
    OUTCOME_SUCCESS,
    STATE_RUNNING,
    PipelineRunRegistry,
)
from src.pipeline_topology import (
    STATUS_FAILED,
    STATUS_NEVER_RUN,
    STATUS_SKIPPED,
    STATUS_SUCCESS,
    build_topology,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_store(stream_id: str = "test-stream") -> MagicMock:
    """Return a MagicMock that mimics LedgerCursorStore."""
    store = MagicMock()
    store.get_or_create.return_value = None
    store.get_cursor.return_value = {"last_ingested_ledger": 100, "status": "idle"}
    store.begin_batch.return_value = 100
    store.rollback_to_safe_point.return_value = 100
    store.advance.return_value = None
    return store


def _make_coordinator(
    stream_id: str = "test-stream",
    retry_policy: Optional[RetryPolicy] = None,
    notifier: Optional[Any] = None,
) -> RecoveryCoordinator:
    store = _make_store(stream_id)
    policy = retry_policy or RetryPolicy(
        max_attempts=3,
        base_backoff_seconds=0.001,  # near-zero for test speed
        max_backoff_seconds=0.01,
        jitter=False,
    )
    return RecoveryCoordinator(
        store=store,
        stream_id=stream_id,
        retry_policy=policy,
        notifier=notifier,
    )


# ---------------------------------------------------------------------------
# FailureClassifier
# ---------------------------------------------------------------------------


class TestFailureClassifier:
    def setup_method(self):
        self.clf = FailureClassifier()

    def test_network_error_is_transient(self):
        assert self.clf.classify(ConnectionError("network reset")) == FailureKind.TRANSIENT

    def test_timeout_is_transient(self):
        assert self.clf.classify(TimeoutError("timed out")) == FailureKind.TRANSIENT

    def test_validation_error_is_permanent(self):
        assert self.clf.classify(ValueError("validation failed")) == FailureKind.PERMANENT

    def test_schema_error_is_permanent(self):
        err = Exception("SchemaError: unexpected field")
        assert self.clf.classify(err) == FailureKind.PERMANENT

    def test_authentication_error_is_permanent(self):
        err = Exception("authentication required")
        assert self.clf.classify(err) == FailureKind.PERMANENT

    def test_403_response_is_permanent(self):
        err = Exception("HTTP 403 Forbidden")
        assert self.clf.classify(err) == FailureKind.PERMANENT

    def test_503_response_is_transient(self):
        err = Exception("HTTP 503 Service Unavailable")
        assert self.clf.classify(err) == FailureKind.TRANSIENT

    def test_rate_limit_is_transient(self):
        err = Exception("ratelimit exceeded, retry after 60s")
        assert self.clf.classify(err) == FailureKind.TRANSIENT

    def test_unknown_error_defaults_to_transient(self):
        err = Exception("something totally unexpected happened")
        assert self.clf.classify(err) == FailureKind.TRANSIENT

    def test_permanent_takes_precedence_over_transient(self):
        # Message contains both "retry" (transient) and "validation" (permanent).
        err = Exception("validation error; please retry with corrected input")
        assert self.clf.classify(err) == FailureKind.PERMANENT

    def test_extra_transient_keyword(self):
        clf = FailureClassifier(extra_transient=("custom_transient",))
        err = Exception("custom_transient failure occurred")
        assert clf.classify(err) == FailureKind.TRANSIENT

    def test_extra_permanent_keyword(self):
        clf = FailureClassifier(extra_permanent=("custom_permanent",))
        err = Exception("custom_permanent condition encountered")
        assert clf.classify(err) == FailureKind.PERMANENT


# ---------------------------------------------------------------------------
# RetryPolicy
# ---------------------------------------------------------------------------


class TestRetryPolicy:
    def test_default_values(self):
        p = RetryPolicy()
        assert p.max_attempts == 3
        assert p.base_backoff_seconds == 2.0
        assert p.max_backoff_seconds == 60.0
        assert p.jitter is True

    def test_first_attempt_no_delay(self):
        p = RetryPolicy(jitter=False)
        assert p.delay_for_attempt(1) == 0.0

    def test_second_attempt_base_delay(self):
        p = RetryPolicy(base_backoff_seconds=2.0, max_backoff_seconds=60.0, jitter=False)
        assert p.delay_for_attempt(2) == pytest.approx(2.0)

    def test_third_attempt_exponential(self):
        p = RetryPolicy(base_backoff_seconds=2.0, max_backoff_seconds=60.0, jitter=False)
        assert p.delay_for_attempt(3) == pytest.approx(4.0)

    def test_delay_capped_at_max(self):
        p = RetryPolicy(
            base_backoff_seconds=10.0, max_backoff_seconds=15.0, jitter=False
        )
        assert p.delay_for_attempt(5) <= 15.0

    def test_jitter_within_bounds(self):
        p = RetryPolicy(base_backoff_seconds=2.0, max_backoff_seconds=60.0, jitter=True)
        for _ in range(50):
            delay = p.delay_for_attempt(2)
            assert 0.0 <= delay <= 2.0

    def test_invalid_max_attempts(self):
        with pytest.raises(ValueError, match="max_attempts"):
            RetryPolicy(max_attempts=0)

    def test_invalid_base_backoff(self):
        with pytest.raises(ValueError, match="base_backoff_seconds"):
            RetryPolicy(base_backoff_seconds=-1.0)

    def test_invalid_max_backoff_less_than_base(self):
        with pytest.raises(ValueError, match="max_backoff_seconds"):
            RetryPolicy(base_backoff_seconds=10.0, max_backoff_seconds=5.0)


# ---------------------------------------------------------------------------
# RecoveryCoordinator.run_batch
# ---------------------------------------------------------------------------


class TestRunBatchRetry:
    """Tests for retry logic inside run_batch."""

    def test_success_on_first_attempt(self):
        coord = _make_coordinator()
        fetch_fn = MagicMock(return_value=[1, 2, 3])
        persist_fn = MagicMock(return_value="evt-1")

        result = coord.run_batch(fetch_fn, persist_fn, batch_end_ledger=200)

        assert result == "evt-1"
        fetch_fn.assert_called_once_with(100, 200)
        persist_fn.assert_called_once()
        coord.store.advance.assert_called_once_with(
            stream_id="test-stream", new_ledger=200, last_event_id="evt-1"
        )

    def test_skipped_when_batch_end_not_after_current(self):
        coord = _make_coordinator()
        fetch_fn = MagicMock()
        persist_fn = MagicMock()

        result = coord.run_batch(fetch_fn, persist_fn, batch_end_ledger=100)

        assert result is None
        fetch_fn.assert_not_called()

    def test_transient_failure_retried(self):
        """A transient failure on attempt 1 should be retried."""
        coord = _make_coordinator(
            retry_policy=RetryPolicy(
                max_attempts=3,
                base_backoff_seconds=0.001,
                max_backoff_seconds=0.01,
                jitter=False,
            )
        )
        transient_exc = ConnectionError("network reset")
        fetch_fn = MagicMock(
            side_effect=[transient_exc, [1, 2]]  # fails once, then succeeds
        )
        persist_fn = MagicMock(return_value="evt-2")

        result = coord.run_batch(fetch_fn, persist_fn, batch_end_ledger=200)

        assert result == "evt-2"
        assert fetch_fn.call_count == 2
        # rollback should have been called for the first failure
        coord.store.rollback_to_safe_point.assert_called_once()

    def test_permanent_failure_not_retried(self):
        """A permanent failure should not be retried."""
        coord = _make_coordinator()
        perm_exc = ValueError("schema validation failed")
        fetch_fn = MagicMock(side_effect=perm_exc)
        persist_fn = MagicMock()

        with pytest.raises(ValueError):
            coord.run_batch(fetch_fn, persist_fn, batch_end_ledger=200)

        # Only one attempt for permanent failures.
        assert fetch_fn.call_count == 1
        coord.store.rollback_to_safe_point.assert_called_once()

    def test_exhausted_retries_raises_and_alerts(self):
        """Exhausting all retry attempts should fire an alert and re-raise."""
        notifier = MagicMock()
        coord = _make_coordinator(
            retry_policy=RetryPolicy(
                max_attempts=2,
                base_backoff_seconds=0.001,
                max_backoff_seconds=0.01,
                jitter=False,
            ),
            notifier=notifier,
        )
        transient_exc = ConnectionError("service unavailable")
        fetch_fn = MagicMock(side_effect=transient_exc)
        persist_fn = MagicMock()

        with pytest.raises(ConnectionError):
            coord.run_batch(fetch_fn, persist_fn, batch_end_ledger=200)

        # All attempts exhausted.
        assert fetch_fn.call_count == 2
        # Alert was sent.
        notifier._send_webhooks.assert_called_once()
        payload = notifier._send_webhooks.call_args[0][0]
        assert payload["event"] == "retry_exhausted"
        assert payload["stream_id"] == "test-stream"
        assert payload["attempts"] == 2

    def test_duplicate_event_advances_without_error(self):
        """DuplicateEventError should advance the cursor, not raise."""
        coord = _make_coordinator()
        fetch_fn = MagicMock(return_value=[])
        persist_fn = MagicMock(side_effect=DuplicateEventError("already exists"))

        # Should not raise.
        result = coord.run_batch(fetch_fn, persist_fn, batch_end_ledger=200)

        # Cursor is advanced even though persist_fn raised.
        coord.store.advance.assert_called_once()
        # rollback should NOT have been called.
        coord.store.rollback_to_safe_point.assert_not_called()

    def test_three_transient_then_success(self):
        """Verify all three attempts are tried and the last one wins."""
        notifier = MagicMock()
        coord = _make_coordinator(
            retry_policy=RetryPolicy(
                max_attempts=4,
                base_backoff_seconds=0.001,
                max_backoff_seconds=0.01,
                jitter=False,
            ),
            notifier=notifier,
        )
        exc = TimeoutError("timed out")
        fetch_fn = MagicMock(
            side_effect=[exc, exc, exc, [42]]  # 3 failures, 4th succeeds
        )
        persist_fn = MagicMock(return_value="evt-final")

        result = coord.run_batch(fetch_fn, persist_fn, batch_end_ledger=200)

        assert result == "evt-final"
        assert fetch_fn.call_count == 4
        # No alert fired because we eventually succeeded.
        notifier._send_webhooks.assert_not_called()

    def test_alert_telegram_message_sent(self):
        """When retries are exhausted, the Telegram path is also called."""
        notifier = MagicMock()
        coord = _make_coordinator(
            retry_policy=RetryPolicy(
                max_attempts=1,
                base_backoff_seconds=0.001,
                max_backoff_seconds=0.01,
                jitter=False,
            ),
            notifier=notifier,
        )
        fetch_fn = MagicMock(side_effect=ConnectionError("network failure"))
        persist_fn = MagicMock()

        with pytest.raises(ConnectionError):
            coord.run_batch(fetch_fn, persist_fn, batch_end_ledger=200)

        notifier._send_telegram_text.assert_called_once()
        msg = notifier._send_telegram_text.call_args[0][0]
        assert "retry exhausted" in msg.lower()

    def test_cursor_missing_raises_runtime_error(self):
        """If the cursor disappears, run_batch must raise RuntimeError."""
        coord = _make_coordinator()
        coord.store.get_cursor.return_value = None

        with pytest.raises(RuntimeError, match="Cursor disappeared"):
            coord.run_batch(MagicMock(), MagicMock(), batch_end_ledger=200)


# ---------------------------------------------------------------------------
# PipelineRunRegistry — new methods
# ---------------------------------------------------------------------------


class TestPipelineRunRegistryNewMethods:
    def setup_method(self, _method):
        import tempfile

        self.tmp = tempfile.mktemp(suffix=".json")
        self.reg = PipelineRunRegistry(path=self.tmp)

    def teardown_method(self, _method):
        try:
            os.unlink(self.tmp)
        except FileNotFoundError:
            pass

    # ── record_retry ───────────────────────────────────────────────────

    def test_record_retry_sets_retry_count(self):
        self.reg.record_start("stage_a")
        self.reg.record_retry("stage_a", attempt=1, error="connection reset")
        runs = self.reg.get_runs()
        assert runs["stage_a"]["retry_count"] == 1
        assert runs["stage_a"]["last_retry_at"] is not None
        assert runs["stage_a"]["last_retry_error"] == "connection reset"

    def test_record_retry_increments_on_repeated_calls(self):
        self.reg.record_start("stage_a")
        self.reg.record_retry("stage_a", attempt=1)
        self.reg.record_retry("stage_a", attempt=2)
        runs = self.reg.get_runs()
        assert runs["stage_a"]["retry_count"] == 2

    def test_record_retry_preserves_running_state(self):
        self.reg.record_start("stage_a")
        self.reg.record_retry("stage_a", attempt=1)
        runs = self.reg.get_runs()
        assert runs["stage_a"]["state"] == STATE_RUNNING

    # ── record_skip ────────────────────────────────────────────────────

    def test_record_skip_sets_skipped_outcome(self):
        self.reg.record_skip("stage_b", skip_reason="upstream 'stage_a' failed")
        runs = self.reg.get_runs()
        entry = runs["stage_b"]
        assert entry["outcome"] == OUTCOME_SKIPPED
        assert entry["state"] == OUTCOME_SKIPPED
        assert entry["skip_reason"] == "upstream 'stage_a' failed"
        assert entry["last_run"] is not None

    def test_record_skip_duration_zero(self):
        self.reg.record_skip("stage_b", skip_reason="dependency failed")
        runs = self.reg.get_runs()
        assert runs["stage_b"]["duration_seconds"] == 0.0

    def test_record_skip_clears_error(self):
        self.reg.record_skip("stage_c", skip_reason="upstream failed")
        runs = self.reg.get_runs()
        assert runs["stage_c"]["error"] is None

    # ── record_alert ───────────────────────────────────────────────────

    def test_record_alert_sets_alerted(self):
        self.reg.record_start("stage_a")
        self.reg.record_alert("stage_a")
        runs = self.reg.get_runs()
        assert runs["stage_a"]["alerted"] is True
        assert runs["stage_a"]["alerted_at"] is not None

    # ── record_start resets counters ───────────────────────────────────

    def test_record_start_resets_retry_count_and_skip_reason(self):
        self.reg.record_start("stage_a")
        self.reg.record_retry("stage_a", attempt=2)
        self.reg.record_skip("stage_a", skip_reason="something failed")
        # A new run should reset the counters.
        self.reg.record_start("stage_a")
        runs = self.reg.get_runs()
        assert runs["stage_a"]["retry_count"] == 0
        assert runs["stage_a"]["skip_reason"] is None
        assert runs["stage_a"]["alerted"] is False

    # ── existing methods still work ────────────────────────────────────

    def test_record_finish_success(self):
        self.reg.record_start("stage_x")
        self.reg.record_finish("stage_x", OUTCOME_SUCCESS)
        runs = self.reg.get_runs()
        assert runs["stage_x"]["outcome"] == OUTCOME_SUCCESS

    def test_record_finish_failed(self):
        self.reg.record_start("stage_x")
        self.reg.record_finish("stage_x", OUTCOME_FAILED, error="boom")
        runs = self.reg.get_runs()
        assert runs["stage_x"]["outcome"] == OUTCOME_FAILED
        assert runs["stage_x"]["error"] == "boom"

    def test_thread_safety(self):
        """Multiple threads writing concurrently should not corrupt the file."""
        errors = []

        def _worker(stage_id):
            try:
                self.reg.record_start(stage_id)
                self.reg.record_retry(stage_id, attempt=1)
                self.reg.record_finish(stage_id, OUTCOME_SUCCESS)
            except Exception as exc:
                errors.append(exc)

        threads = [threading.Thread(target=_worker, args=(f"stage_{i}",)) for i in range(10)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert errors == []
        runs = self.reg.get_runs()
        assert len(runs) == 10


# ---------------------------------------------------------------------------
# pipeline_topology.build_topology — downstream skipping
# ---------------------------------------------------------------------------


class TestBuildTopologySkipping:
    """Tests for the skipped-status propagation in build_topology."""

    def _make_runs(self, **kwargs):
        """Helper: build a runs dict from stage_id -> outcome."""
        runs = {}
        for stage_id, outcome in kwargs.items():
            runs[stage_id] = {
                "stage_id": stage_id,
                "state": outcome,
                "outcome": outcome,
                "last_run": "2026-10-17T00:00:00+00:00",
                "duration_seconds": 1.0,
                "error": "boom" if outcome == "failed" else None,
                "retry_count": 0,
                "last_retry_at": None,
                "skip_reason": None,
                "alerted": False,
            }
        return runs

    def test_no_failed_deps_not_skipped(self):
        runs = self._make_runs(
            market_analyzer_hourly="success",
            model_retraining_daily="success",
        )
        topology = build_topology(runs)
        model_stage = next(s for s in topology if s["id"] == "model_retraining_daily")
        assert model_stage["status"] == STATUS_SUCCESS

    def test_failed_dep_marks_downstream_skipped(self):
        """market_analyzer_hourly failed → model_retraining_daily should be skipped."""
        runs = self._make_runs(market_analyzer_hourly="failed")
        topology = build_topology(runs)
        model_stage = next(s for s in topology if s["id"] == "model_retraining_daily")
        assert model_stage["status"] == STATUS_SKIPPED
        assert model_stage["outcome"] == STATUS_SKIPPED
        assert "market_analyzer_hourly" in model_stage["skip_reason"]

    def test_skip_propagates_transitively(self):
        """
        market_analyzer_hourly failed
        → model_retraining_daily skipped
        → feature_drift_detection skipped (depends on model_retraining_daily)
        """
        runs = self._make_runs(market_analyzer_hourly="failed")
        topology = build_topology(runs)
        feature_drift = next(s for s in topology if s["id"] == "feature_drift_detection")
        assert feature_drift["status"] == STATUS_SKIPPED

    def test_stage_without_deps_not_affected(self):
        runs = self._make_runs(market_analyzer_hourly="failed")
        topology = build_topology(runs)
        # A stage with no dependencies should not be skipped.
        rpc = next(s for s in topology if s["id"] == "rpc_provider_benchmark")
        assert rpc["status"] in (STATUS_NEVER_RUN, STATUS_SUCCESS)

    def test_explicitly_skipped_in_registry_preserved(self):
        """A skip recorded in the registry should be surfaced directly."""
        runs = {
            "model_retraining_daily": {
                "stage_id": "model_retraining_daily",
                "state": "skipped",
                "outcome": "skipped",
                "last_run": "2026-10-17T00:00:00+00:00",
                "skip_reason": "upstream 'market_analyzer_hourly' failed",
                "duration_seconds": 0.0,
                "error": None,
                "retry_count": 0,
                "last_retry_at": None,
                "alerted": False,
            }
        }
        topology = build_topology(runs)
        model_stage = next(s for s in topology if s["id"] == "model_retraining_daily")
        assert model_stage["status"] == STATUS_SKIPPED
        assert "market_analyzer_hourly" in model_stage["skip_reason"]

    def test_new_fields_present_in_all_stages(self):
        """Every stage in the topology must carry the new fields."""
        topology = build_topology({})
        for stage in topology:
            assert "retry_count" in stage
            assert "last_retry_at" in stage
            assert "skip_reason" in stage
            assert "alerted" in stage

    def test_failed_stage_not_overridden_to_skipped(self):
        """A stage that is itself failed should not be reclassified as skipped."""
        runs = self._make_runs(
            daily_onchain_kpi_snapshot="failed",
            kpi_reconciliation="failed",  # its dep also failed
        )
        topology = build_topology(runs)
        kpi_rec = next(s for s in topology if s["id"] == "kpi_reconciliation")
        # The registry says "failed"; that should win over the skip logic.
        assert kpi_rec["status"] == STATUS_FAILED

    def test_kpi_reconciliation_skipped_when_dep_fails(self):
        """kpi_reconciliation depends on daily_onchain_kpi_snapshot."""
        runs = self._make_runs(daily_onchain_kpi_snapshot="failed")
        topology = build_topology(runs)
        kpi_rec = next(s for s in topology if s["id"] == "kpi_reconciliation")
        assert kpi_rec["status"] == STATUS_SKIPPED
        assert "daily_onchain_kpi_snapshot" in kpi_rec["skip_reason"]
