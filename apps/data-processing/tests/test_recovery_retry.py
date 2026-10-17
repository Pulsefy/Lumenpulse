# -*- coding: utf-8 -*-
"""
tests/test_recovery_retry.py

Unit tests for the automatic retry / backoff / downstream-skip behavior added
to :mod:`src.ingestion.recovery_coordinator` and
:mod:`src.pipeline_run_registry`.

Acceptance criteria exercised
------------------------------
AC1  Failed stages retry automatically with back-off, bounded by attempt count.
AC2  Transient and permanent failures are distinguished and handled differently.
AC3  A stage that exhausts retries alerts and is recorded as permanently failed.
AC4  Downstream stages are skipped rather than run on incomplete input.
AC5  Recovery actions are visible in the pipeline run registry.
"""

from __future__ import annotations

import sys
import time
from typing import List, Optional
from unittest.mock import MagicMock, call, patch

import pytest

# ---------------------------------------------------------------------------
# Stub heavy optional dependencies that aren't installed in this environment
# so we can import recovery_coordinator without SQLAlchemy / other deps.
# ---------------------------------------------------------------------------
_STUBS = [
    "sqlalchemy",
    "sqlalchemy.orm",
    "sqlalchemy.exc",
    "sqlalchemy.pool",
    "sqlalchemy.engine",
    "sqlalchemy.dialects",
    "sqlalchemy.dialects.postgresql",
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

# Also stub the ledger_cursor_store so the SQLAlchemy machinery is never
# reached during test collection.
if "src.ingestion.ledger_cursor_store" not in sys.modules:
    _lcs = MagicMock()
    _lcs.LedgerCursorStore = MagicMock
    sys.modules["src.ingestion.ledger_cursor_store"] = _lcs

from src.ingestion.recovery_coordinator import (
    PermanentError,
    StageResult,
    StageRetryPolicy,
    TransientError,
    run_pipeline_with_retry,
    run_stage_with_retry,
)
from src.pipeline_run_registry import (
    OUTCOME_PERMANENTLY_FAILED,
    OUTCOME_RETRY,
    OUTCOME_SKIPPED,
    OUTCOME_SUCCESS,
    PipelineRunRegistry,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def no_sleep(_: float) -> None:
    """Drop-in replacement for time.sleep that does nothing."""


def make_registry(tmp_path) -> PipelineRunRegistry:
    return PipelineRunRegistry(path=str(tmp_path / "runs.json"))


# ---------------------------------------------------------------------------
# StageRetryPolicy.backoff_for
# ---------------------------------------------------------------------------


class TestStageRetryPolicyBackoff:
    """AC1 – back-off is exponential and capped."""

    def test_first_attempt_uses_base(self) -> None:
        policy = StageRetryPolicy(base_backoff_seconds=2.0, jitter_factor=0.0)
        assert policy.backoff_for(1) == pytest.approx(2.0)

    def test_doubles_each_attempt(self) -> None:
        policy = StageRetryPolicy(base_backoff_seconds=1.0, jitter_factor=0.0)
        assert policy.backoff_for(2) == pytest.approx(2.0)
        assert policy.backoff_for(3) == pytest.approx(4.0)

    def test_capped_at_max(self) -> None:
        policy = StageRetryPolicy(
            base_backoff_seconds=10.0,
            max_backoff_seconds=15.0,
            jitter_factor=0.0,
        )
        assert policy.backoff_for(5) <= 15.0

    def test_jitter_stays_within_factor(self) -> None:
        policy = StageRetryPolicy(base_backoff_seconds=10.0, jitter_factor=0.1)
        for _ in range(50):
            result = policy.backoff_for(1)
            assert 9.0 <= result <= 11.0


# ---------------------------------------------------------------------------
# run_stage_with_retry – success path
# ---------------------------------------------------------------------------


class TestRunStageSuccess:
    """AC1 – successful stage returns immediately, no retries."""

    def test_succeeds_on_first_attempt(self) -> None:
        fn = MagicMock()
        result = run_stage_with_retry(
            "fetch",
            fn,
            StageRetryPolicy(max_attempts=3),
            sleep_fn=no_sleep,
        )
        assert result.succeeded is True
        assert result.attempts == 1
        fn.assert_called_once()

    def test_result_stage_id_matches(self) -> None:
        result = run_stage_with_retry(
            "my_stage",
            lambda: None,
            StageRetryPolicy(),
            sleep_fn=no_sleep,
        )
        assert result.stage_id == "my_stage"


# ---------------------------------------------------------------------------
# Transient retry behaviour  (AC1 + AC2)
# ---------------------------------------------------------------------------


class TestTransientRetry:
    """AC1 + AC2 – transient errors are retried up to max_attempts."""

    def test_retries_until_success(self) -> None:
        call_count = 0

        def flaky():
            nonlocal call_count
            call_count += 1
            if call_count < 3:
                raise TransientError("network blip")

        result = run_stage_with_retry(
            "fetch",
            flaky,
            StageRetryPolicy(max_attempts=5, base_backoff_seconds=0),
            sleep_fn=no_sleep,
        )
        assert result.succeeded is True
        assert result.attempts == 3
        assert call_count == 3

    def test_exhausts_attempts_and_permanently_fails(self) -> None:
        fn = MagicMock(side_effect=TransientError("timeout"))
        result = run_stage_with_retry(
            "fetch",
            fn,
            StageRetryPolicy(max_attempts=3, base_backoff_seconds=0),
            sleep_fn=no_sleep,
        )
        assert result.succeeded is False
        assert result.permanent_failure is True
        assert result.attempts == 3
        assert fn.call_count == 3

    def test_unknown_exception_treated_as_transient_by_default(self) -> None:
        fn = MagicMock(side_effect=RuntimeError("something broke"))
        result = run_stage_with_retry(
            "fetch",
            fn,
            StageRetryPolicy(max_attempts=2, base_backoff_seconds=0),
            sleep_fn=no_sleep,
        )
        assert result.succeeded is False
        assert result.permanent_failure is True
        assert fn.call_count == 2

    def test_unknown_exception_not_retried_when_flag_off(self) -> None:
        """AC2 – treat_unknown_as_transient=False stops at first unknown exc."""
        fn = MagicMock(side_effect=RuntimeError("boom"))
        result = run_stage_with_retry(
            "fetch",
            fn,
            StageRetryPolicy(
                max_attempts=5,
                base_backoff_seconds=0,
                treat_unknown_as_transient=False,
            ),
            sleep_fn=no_sleep,
        )
        assert result.succeeded is False
        assert result.permanent_failure is True
        # Only one attempt – non-transient, no retry
        assert fn.call_count == 1

    def test_backoff_sleep_called_between_retries(self) -> None:
        """AC1 – sleep is invoked between attempts."""
        sleep_calls: List[float] = []
        fn = MagicMock(side_effect=[TransientError("a"), TransientError("b"), None])
        run_stage_with_retry(
            "fetch",
            fn,
            StageRetryPolicy(max_attempts=3, base_backoff_seconds=5.0, jitter_factor=0.0),
            sleep_fn=sleep_calls.append,
        )
        # Two failures → two sleeps before the successful third attempt
        assert len(sleep_calls) == 2
        # First sleep: 5s (attempt 1), second sleep: 10s (attempt 2)
        assert sleep_calls[0] == pytest.approx(5.0)
        assert sleep_calls[1] == pytest.approx(10.0)


# ---------------------------------------------------------------------------
# Permanent error behaviour  (AC2 + AC3)
# ---------------------------------------------------------------------------


class TestPermanentError:
    """AC2 – PermanentError bypasses retry budget."""

    def test_permanent_error_not_retried(self) -> None:
        fn = MagicMock(side_effect=PermanentError("schema mismatch"))
        result = run_stage_with_retry(
            "transform",
            fn,
            StageRetryPolicy(max_attempts=10, base_backoff_seconds=0),
            sleep_fn=no_sleep,
        )
        assert result.succeeded is False
        assert result.permanent_failure is True
        # Must only be attempted once
        assert fn.call_count == 1

    def test_no_sleep_on_permanent_error(self) -> None:
        sleep_calls: List[float] = []
        run_stage_with_retry(
            "transform",
            MagicMock(side_effect=PermanentError("bad data")),
            StageRetryPolicy(max_attempts=5),
            sleep_fn=sleep_calls.append,
        )
        assert sleep_calls == []


# ---------------------------------------------------------------------------
# Registry visibility  (AC5)
# ---------------------------------------------------------------------------


class TestRegistryVisibility:
    """AC5 – every retry action is visible in the pipeline run registry."""

    def test_retry_attempts_recorded(self, tmp_path) -> None:
        registry = make_registry(tmp_path)
        call_count = 0

        def flaky():
            nonlocal call_count
            call_count += 1
            if call_count < 3:
                raise TransientError("blip")

        run_stage_with_retry(
            "stage_a",
            flaky,
            StageRetryPolicy(max_attempts=5, base_backoff_seconds=0, jitter_factor=0.0),
            registry=registry,
            sleep_fn=no_sleep,
        )

        runs = registry.get_runs()
        entry = runs["stage_a"]
        # Final outcome is success
        assert entry["outcome"] == OUTCOME_SUCCESS

    def test_permanent_failure_recorded(self, tmp_path) -> None:
        registry = make_registry(tmp_path)
        run_stage_with_retry(
            "stage_b",
            MagicMock(side_effect=TransientError("always fails")),
            StageRetryPolicy(max_attempts=3, base_backoff_seconds=0, jitter_factor=0.0),
            registry=registry,
            sleep_fn=no_sleep,
        )

        runs = registry.get_runs()
        entry = runs["stage_b"]
        assert entry["outcome"] == OUTCOME_PERMANENTLY_FAILED
        assert entry["total_attempts"] == 3
        assert "always fails" in (entry.get("error") or "")

    def test_retry_in_progress_recorded_with_retry_outcome(self, tmp_path) -> None:
        """Each intermediate failure should be visible as OUTCOME_RETRY."""
        registry = make_registry(tmp_path)
        recorded_outcomes: List[str] = []

        # Monkey-patch record_retry to capture intermediate outcomes
        original_retry = registry.record_retry

        def capturing_retry(stage_id, attempt, max_attempts, error=None, next_retry_at=None):
            original_retry(
                stage_id,
                attempt=attempt,
                max_attempts=max_attempts,
                error=error,
                next_retry_at=next_retry_at,
            )
            recorded_outcomes.append(
                registry.get_runs().get(stage_id, {}).get("outcome", "")
            )

        registry.record_retry = capturing_retry  # type: ignore[method-assign]

        call_count = 0

        def eventually_succeeds():
            nonlocal call_count
            call_count += 1
            if call_count < 3:
                raise TransientError("tmp")

        run_stage_with_retry(
            "stage_c",
            eventually_succeeds,
            StageRetryPolicy(max_attempts=5, base_backoff_seconds=0, jitter_factor=0.0),
            registry=registry,
            sleep_fn=no_sleep,
        )

        # Two intermediate retry outcomes were recorded
        assert all(o == OUTCOME_RETRY for o in recorded_outcomes)
        assert len(recorded_outcomes) == 2

    def test_skipped_stage_recorded(self, tmp_path) -> None:
        registry = make_registry(tmp_path)
        run_pipeline_with_retry(
            stages=[
                ("fail_stage", MagicMock(side_effect=PermanentError("boom"))),
                ("skip_stage", MagicMock()),
            ],
            policy=StageRetryPolicy(max_attempts=1, base_backoff_seconds=0, jitter_factor=0.0),
            registry=registry,
            sleep_fn=no_sleep,
        )
        runs = registry.get_runs()
        assert runs["skip_stage"]["outcome"] == OUTCOME_SKIPPED
        assert runs["skip_stage"]["skipped_because"] == "fail_stage"


# ---------------------------------------------------------------------------
# Downstream skip  (AC4)
# ---------------------------------------------------------------------------


class TestDownstreamSkip:
    """AC4 – stages after a permanent failure are not executed."""

    def test_downstream_stages_not_called(self) -> None:
        stage_a = MagicMock(side_effect=PermanentError("bad payload"))
        stage_b = MagicMock()
        stage_c = MagicMock()

        results = run_pipeline_with_retry(
            stages=[("a", stage_a), ("b", stage_b), ("c", stage_c)],
            policy=StageRetryPolicy(max_attempts=1, base_backoff_seconds=0, jitter_factor=0.0),
            sleep_fn=no_sleep,
        )

        stage_b.assert_not_called()
        stage_c.assert_not_called()

    def test_downstream_results_are_skipped(self) -> None:
        results = run_pipeline_with_retry(
            stages=[
                ("a", MagicMock(side_effect=PermanentError("boom"))),
                ("b", MagicMock()),
                ("c", MagicMock()),
            ],
            policy=StageRetryPolicy(max_attempts=1, base_backoff_seconds=0, jitter_factor=0.0),
            sleep_fn=no_sleep,
        )

        assert results[0].permanent_failure is True
        assert results[1].skipped is True
        assert results[1].skipped_because == "a"
        assert results[2].skipped is True
        assert results[2].skipped_because == "a"

    def test_transient_exhaustion_also_skips_downstream(self) -> None:
        """AC4 – exhausting transient retries still skips downstream."""
        results = run_pipeline_with_retry(
            stages=[
                ("fetch", MagicMock(side_effect=TransientError("timeout"))),
                ("transform", MagicMock()),
            ],
            policy=StageRetryPolicy(max_attempts=2, base_backoff_seconds=0, jitter_factor=0.0),
            sleep_fn=no_sleep,
        )
        assert results[0].permanent_failure is True
        assert results[1].skipped is True

    def test_partial_pipeline_success(self) -> None:
        """Stages before the failure still run and succeed."""
        results = run_pipeline_with_retry(
            stages=[
                ("ok_stage", MagicMock()),
                ("bad_stage", MagicMock(side_effect=PermanentError("x"))),
                ("skipped_stage", MagicMock()),
            ],
            policy=StageRetryPolicy(max_attempts=1, base_backoff_seconds=0, jitter_factor=0.0),
            sleep_fn=no_sleep,
        )
        assert results[0].succeeded is True
        assert results[1].permanent_failure is True
        assert results[2].skipped is True

    def test_all_succeed_returns_all_success(self) -> None:
        results = run_pipeline_with_retry(
            stages=[("a", MagicMock()), ("b", MagicMock()), ("c", MagicMock())],
            policy=StageRetryPolicy(max_attempts=3, base_backoff_seconds=0, jitter_factor=0.0),
            sleep_fn=no_sleep,
        )
        assert all(r.succeeded for r in results)
        assert not any(r.skipped for r in results)


# ---------------------------------------------------------------------------
# Alerting on permanent failure  (AC3)
# ---------------------------------------------------------------------------


class TestAlertOnPermanentFailure:
    """AC3 – exhausting retries fires notify_stage_permanent_failure."""

    def test_alert_fired_on_exhaustion(self) -> None:
        notifier = MagicMock()
        run_stage_with_retry(
            "fetch",
            MagicMock(side_effect=TransientError("down")),
            StageRetryPolicy(max_attempts=3, base_backoff_seconds=0, jitter_factor=0.0),
            notifier=notifier,
            sleep_fn=no_sleep,
        )
        notifier.notify_stage_permanent_failure.assert_called_once()
        kwargs = notifier.notify_stage_permanent_failure.call_args
        assert kwargs.kwargs.get("stage_id") == "fetch" or kwargs.args[0] == "fetch"

    def test_alert_includes_downstream_stage_ids(self) -> None:
        notifier = MagicMock()
        run_stage_with_retry(
            "fetch",
            MagicMock(side_effect=PermanentError("bad schema")),
            StageRetryPolicy(max_attempts=1, base_backoff_seconds=0, jitter_factor=0.0),
            notifier=notifier,
            downstream_stage_ids=["transform", "load"],
            sleep_fn=no_sleep,
        )
        call_kwargs = notifier.notify_stage_permanent_failure.call_args.kwargs
        assert "transform" in call_kwargs.get("downstream_skipped", [])
        assert "load" in call_kwargs.get("downstream_skipped", [])

    def test_no_alert_on_success(self) -> None:
        notifier = MagicMock()
        run_stage_with_retry(
            "fetch",
            MagicMock(),
            StageRetryPolicy(max_attempts=3, base_backoff_seconds=0, jitter_factor=0.0),
            notifier=notifier,
            sleep_fn=no_sleep,
        )
        notifier.notify_stage_permanent_failure.assert_not_called()

    def test_alert_not_fatal_when_notifier_raises(self) -> None:
        """A broken notifier must not crash the pipeline coordinator."""
        notifier = MagicMock()
        notifier.notify_stage_permanent_failure.side_effect = RuntimeError("webhook down")

        # Should not raise
        result = run_stage_with_retry(
            "fetch",
            MagicMock(side_effect=PermanentError("bad")),
            StageRetryPolicy(max_attempts=1, base_backoff_seconds=0, jitter_factor=0.0),
            notifier=notifier,
            sleep_fn=no_sleep,
        )
        assert result.permanent_failure is True

    def test_pipeline_fires_alert_with_downstream_ids_in_notifier(self) -> None:
        """Alert from run_pipeline_with_retry includes correct downstream IDs."""
        notifier = MagicMock()
        run_pipeline_with_retry(
            stages=[
                ("fetch", MagicMock(side_effect=PermanentError("x"))),
                ("transform", MagicMock()),
                ("load", MagicMock()),
            ],
            policy=StageRetryPolicy(max_attempts=1, base_backoff_seconds=0, jitter_factor=0.0),
            notifier=notifier,
            sleep_fn=no_sleep,
        )
        notifier.notify_stage_permanent_failure.assert_called_once()
        kwargs = notifier.notify_stage_permanent_failure.call_args.kwargs
        assert set(kwargs.get("downstream_skipped", [])) == {"transform", "load"}


# ---------------------------------------------------------------------------
# PipelineRunRegistry – new methods
# ---------------------------------------------------------------------------


class TestRegistryNewMethods:
    """Direct tests for the new registry recording methods (AC5)."""

    def test_record_retry(self, tmp_path) -> None:
        reg = make_registry(tmp_path)
        reg.record_start("s1")
        reg.record_retry("s1", attempt=1, max_attempts=3, error="timeout")
        entry = reg.get_runs()["s1"]
        assert entry["outcome"] == OUTCOME_RETRY
        assert entry["retry_attempt"] == 1
        assert entry["retry_max_attempts"] == 3
        assert "timeout" in (entry.get("error") or "")

    def test_record_permanently_failed(self, tmp_path) -> None:
        reg = make_registry(tmp_path)
        reg.record_start("s2")
        reg.record_permanently_failed("s2", attempts=4, error="schema mismatch")
        entry = reg.get_runs()["s2"]
        assert entry["outcome"] == OUTCOME_PERMANENTLY_FAILED
        assert entry["total_attempts"] == 4
        assert "schema mismatch" in (entry.get("error") or "")

    def test_record_skipped(self, tmp_path) -> None:
        reg = make_registry(tmp_path)
        reg.record_skipped("downstream", skipped_because="upstream")
        entry = reg.get_runs()["downstream"]
        assert entry["outcome"] == OUTCOME_SKIPPED
        assert entry["skipped_because"] == "upstream"

    def test_record_skipped_without_reason(self, tmp_path) -> None:
        reg = make_registry(tmp_path)
        reg.record_skipped("stage_x")
        entry = reg.get_runs()["stage_x"]
        assert entry["outcome"] == OUTCOME_SKIPPED
        assert entry.get("skipped_because") is None

    def test_outcome_constants_are_distinct(self) -> None:
        from src.pipeline_run_registry import (
            OUTCOME_FAILED,
            OUTCOME_PERMANENTLY_FAILED,
            OUTCOME_RETRY,
            OUTCOME_SKIPPED,
            OUTCOME_SUCCESS,
        )

        outcomes = {
            OUTCOME_SUCCESS,
            OUTCOME_FAILED,
            OUTCOME_RETRY,
            OUTCOME_PERMANENTLY_FAILED,
            OUTCOME_SKIPPED,
        }
        assert len(outcomes) == 5, "All outcome constants must be distinct strings"
