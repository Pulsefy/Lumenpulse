"""Tests for the Source Freshness SLA Monitor (issue #1060).

Covers:
- All three feeds: news, price, on-chain (stellar).
- Threshold-based severity classification (healthy / warning / critical).
- Configurable thresholds via environment variables.
- Stale-source reports contain actionable fields.
- Non-blocking behaviour: an exception in one probe does not stop others.
- run_freshness_check() orchestration.
- FreshnessResult.to_lag_snapshot() bridge dict.
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

import pytest

from src.ingestion.freshness_monitor import (
    FreshnessSeverity,
    FreshnessResult,
    FreshnessThreshold,
    StaleSourceReport,
    _freshness_thresholds,
    _severity_for_freshness,
    evaluate_freshness_results,
    probe_news_freshness,
    probe_onchain_freshness,
    probe_price_freshness,
    run_freshness_check,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _ts_ago(seconds: float) -> datetime:
    """Return a timezone-aware UTC datetime *seconds* in the past."""
    return datetime.now(timezone.utc) - timedelta(seconds=seconds)


# ---------------------------------------------------------------------------
# _freshness_thresholds — env-var configurability
# ---------------------------------------------------------------------------


class TestFreshnessThresholds:
    def test_defaults_news(self):
        t = _freshness_thresholds("news_freshness")
        assert t["warning"] == 1800.0
        assert t["critical"] == 3600.0

    def test_defaults_price(self):
        t = _freshness_thresholds("price_freshness")
        assert t["warning"] == 300.0
        assert t["critical"] == 900.0

    def test_defaults_onchain(self):
        t = _freshness_thresholds("onchain_freshness")
        assert t["warning"] == 120.0
        assert t["critical"] == 600.0

    def test_env_override_news_warning(self, monkeypatch):
        monkeypatch.setenv("NEWS_FRESHNESS_WARNING_SECONDS", "999")
        t = _freshness_thresholds("news_freshness")
        assert t["warning"] == 999.0

    def test_env_override_price_critical(self, monkeypatch):
        monkeypatch.setenv("PRICE_FRESHNESS_CRITICAL_SECONDS", "1234")
        t = _freshness_thresholds("price_freshness")
        assert t["critical"] == 1234.0

    def test_env_override_onchain(self, monkeypatch):
        monkeypatch.setenv("ONCHAIN_FRESHNESS_WARNING_SECONDS", "60")
        monkeypatch.setenv("ONCHAIN_FRESHNESS_CRITICAL_SECONDS", "300")
        t = _freshness_thresholds("onchain_freshness")
        assert t["warning"] == 60.0
        assert t["critical"] == 300.0

    def test_unknown_metric_uses_fallback_defaults(self):
        t = _freshness_thresholds("nonexistent_metric")
        assert t["warning"] == 600.0
        assert t["critical"] == 1800.0


class TestFreshnessThresholdClassFactory:
    def test_for_source_returns_correct_thresholds(self):
        ft = FreshnessThreshold.for_source("news", "news_freshness")
        assert ft.source == "news"
        assert ft.metric_name == "news_freshness"
        assert ft.warning_seconds == 1800.0
        assert ft.critical_seconds == 3600.0


# ---------------------------------------------------------------------------
# _severity_for_freshness
# ---------------------------------------------------------------------------


class TestSeverityForFreshness:
    def test_healthy_when_below_warning(self):
        assert _severity_for_freshness(100.0, "news_freshness") == FreshnessSeverity.HEALTHY

    def test_warning_when_between_thresholds(self):
        # Default: news warning=1800, critical=3600
        assert _severity_for_freshness(2000.0, "news_freshness") == FreshnessSeverity.WARNING

    def test_critical_when_above_critical_threshold(self):
        assert _severity_for_freshness(5000.0, "news_freshness") == FreshnessSeverity.CRITICAL

    def test_price_feed_tighter_thresholds(self):
        # Default: price warning=300, critical=900
        assert _severity_for_freshness(500.0, "price_freshness") == FreshnessSeverity.WARNING
        assert _severity_for_freshness(1000.0, "price_freshness") == FreshnessSeverity.CRITICAL

    def test_onchain_tightest_thresholds(self):
        # Default: onchain warning=120, critical=600
        assert _severity_for_freshness(60.0, "onchain_freshness") == FreshnessSeverity.HEALTHY
        assert _severity_for_freshness(200.0, "onchain_freshness") == FreshnessSeverity.WARNING
        assert _severity_for_freshness(700.0, "onchain_freshness") == FreshnessSeverity.CRITICAL


# ---------------------------------------------------------------------------
# probe_news_freshness
# ---------------------------------------------------------------------------


class TestProbeNewsFreshness:
    def test_healthy_when_recent(self):
        result = probe_news_freshness(last_article_at=_ts_ago(60))
        assert result.severity == FreshnessSeverity.HEALTHY
        assert result.is_stale() is False
        assert result.source == "news"
        assert result.metric_name == "news_freshness"

    def test_warning_when_stale_within_critical(self):
        result = probe_news_freshness(last_article_at=_ts_ago(2000))
        assert result.severity == FreshnessSeverity.WARNING
        assert result.is_stale() is True

    def test_critical_when_very_stale(self):
        result = probe_news_freshness(last_article_at=_ts_ago(5000))
        assert result.severity == FreshnessSeverity.CRITICAL

    def test_critical_when_no_timestamp_provided(self):
        result = probe_news_freshness()
        assert result.severity == FreshnessSeverity.CRITICAL
        assert result.last_seen_at is None
        assert result.error is not None

    def test_uses_fetcher_fn_when_timestamp_absent(self):
        ts = _ts_ago(30)
        result = probe_news_freshness(fetcher_fn=lambda: ts)
        assert result.severity == FreshnessSeverity.HEALTHY
        assert result.last_seen_at == ts

    def test_non_blocking_on_exception_in_fetcher_fn(self):
        def bad_fetcher():
            raise RuntimeError("network error")

        result = probe_news_freshness(fetcher_fn=bad_fetcher)
        # Should not propagate; returns critical result
        assert result.severity == FreshnessSeverity.CRITICAL
        assert "network error" in result.error

    def test_naive_datetime_treated_as_utc(self):
        naive_ts = datetime.utcnow() - timedelta(seconds=60)
        result = probe_news_freshness(last_article_at=naive_ts)
        assert result.severity == FreshnessSeverity.HEALTHY

    def test_to_dict_shape(self):
        result = probe_news_freshness(last_article_at=_ts_ago(60))
        d = result.to_dict()
        for key in (
            "source", "metric_name", "last_seen_at", "age_seconds",
            "severity", "warning_threshold_seconds", "critical_threshold_seconds",
            "checked_at", "is_stale",
        ):
            assert key in d, f"Missing key: {key}"

    def test_to_lag_snapshot_bridge(self):
        result = probe_news_freshness(last_article_at=_ts_ago(60))
        snap = result.to_lag_snapshot()
        assert snap["metric_name"] == "news_freshness"
        assert snap["source"] == "news"
        assert snap["lag_seconds"] == pytest.approx(result.age_seconds, abs=1.0)
        assert snap["severity"] == "healthy"

    def test_severity_value_is_string(self):
        result = probe_news_freshness(last_article_at=_ts_ago(60))
        d = result.to_dict()
        assert isinstance(d["severity"], str)
        assert d["severity"] == "healthy"


# ---------------------------------------------------------------------------
# probe_price_freshness
# ---------------------------------------------------------------------------


class TestProbePriceFreshness:
    def test_healthy_when_recent(self):
        result = probe_price_freshness(last_price_at=_ts_ago(30))
        assert result.severity == FreshnessSeverity.HEALTHY
        assert result.source == "price"

    def test_warning_at_stale_threshold(self):
        result = probe_price_freshness(last_price_at=_ts_ago(400))
        assert result.severity == FreshnessSeverity.WARNING

    def test_critical_at_very_stale(self):
        result = probe_price_freshness(last_price_at=_ts_ago(1000))
        assert result.severity == FreshnessSeverity.CRITICAL

    def test_critical_when_no_timestamp(self):
        result = probe_price_freshness()
        assert result.severity == FreshnessSeverity.CRITICAL
        assert result.last_seen_at is None

    def test_non_blocking_on_fetcher_exception(self):
        def bad_fetcher():
            raise ConnectionError("api down")

        result = probe_price_freshness(fetcher_fn=bad_fetcher)
        assert result.severity == FreshnessSeverity.CRITICAL
        assert "api down" in result.error

    def test_uses_fetcher_fn_when_no_timestamp(self):
        ts = _ts_ago(10)
        result = probe_price_freshness(fetcher_fn=lambda: ts)
        assert result.severity == FreshnessSeverity.HEALTHY

    def test_age_matches_elapsed(self):
        ts = _ts_ago(50)
        result = probe_price_freshness(last_price_at=ts)
        assert result.age_seconds == pytest.approx(50.0, abs=2.0)


# ---------------------------------------------------------------------------
# probe_onchain_freshness
# ---------------------------------------------------------------------------


class TestProbeOnchainFreshness:
    def test_healthy_when_recent(self):
        result = probe_onchain_freshness(last_ledger_at=_ts_ago(10))
        assert result.severity == FreshnessSeverity.HEALTHY
        assert result.source == "onchain"

    def test_warning_between_thresholds(self):
        result = probe_onchain_freshness(last_ledger_at=_ts_ago(200))
        assert result.severity == FreshnessSeverity.WARNING

    def test_critical_when_very_old(self):
        result = probe_onchain_freshness(last_ledger_at=_ts_ago(700))
        assert result.severity == FreshnessSeverity.CRITICAL

    def test_critical_when_no_timestamp(self):
        result = probe_onchain_freshness()
        assert result.severity == FreshnessSeverity.CRITICAL

    def test_non_blocking_on_fetcher_exception(self):
        def bad_fn():
            raise TimeoutError("horizon timed out")

        result = probe_onchain_freshness(fetcher_fn=bad_fn)
        assert result.severity == FreshnessSeverity.CRITICAL
        assert result.error is not None

    def test_age_seconds_is_non_negative(self):
        # Even if the timestamp is ever so slightly in the future (clock skew),
        # age must be clamped to 0.
        future_ts = datetime.now(timezone.utc) + timedelta(seconds=5)
        result = probe_onchain_freshness(last_ledger_at=future_ts)
        assert result.age_seconds >= 0.0

    def test_metric_name_is_onchain_freshness(self):
        result = probe_onchain_freshness(last_ledger_at=_ts_ago(10))
        assert result.metric_name == "onchain_freshness"


# ---------------------------------------------------------------------------
# evaluate_freshness_results
# ---------------------------------------------------------------------------


class TestEvaluateFreshnessResults:
    def test_all_healthy_returns_empty_reports(self):
        results = [
            probe_news_freshness(last_article_at=_ts_ago(10)),
            probe_price_freshness(last_price_at=_ts_ago(10)),
            probe_onchain_freshness(last_ledger_at=_ts_ago(10)),
        ]
        reports = evaluate_freshness_results(results)
        assert reports == []

    def test_stale_source_generates_report(self):
        results = [probe_news_freshness(last_article_at=_ts_ago(5000))]
        reports = evaluate_freshness_results(results)
        assert len(reports) == 1
        r = reports[0]
        assert isinstance(r, StaleSourceReport)
        assert r.recommended_action
        assert r.runbook_hint

    def test_report_dict_shape(self):
        results = [probe_price_freshness(last_price_at=_ts_ago(2000))]
        reports = evaluate_freshness_results(results)
        d = reports[0].to_dict()
        assert "recommended_action" in d
        assert "runbook_hint" in d
        assert "severity" in d

    def test_multiple_stale_sources_all_reported(self):
        results = [
            probe_news_freshness(last_article_at=_ts_ago(5000)),
            probe_price_freshness(last_price_at=_ts_ago(2000)),
        ]
        reports = evaluate_freshness_results(results)
        assert len(reports) == 2

    def test_healthy_sources_not_included_in_reports(self):
        results = [
            probe_news_freshness(last_article_at=_ts_ago(10)),
            probe_price_freshness(last_price_at=_ts_ago(5000)),
        ]
        reports = evaluate_freshness_results(results)
        assert len(reports) == 1
        assert reports[0].result.source == "price"


# ---------------------------------------------------------------------------
# run_freshness_check — orchestration
# ---------------------------------------------------------------------------


class TestRunFreshnessCheck:
    def test_all_healthy_returns_healthy_true(self):
        report = run_freshness_check(
            news_last_seen_at=_ts_ago(60),
            price_last_seen_at=_ts_ago(30),
            onchain_last_seen_at=_ts_ago(10),
        )
        assert report["healthy"] is True
        assert report["stale_sources"] == []
        assert len(report["results"]) == 3

    def test_stale_news_sets_healthy_false(self):
        report = run_freshness_check(
            news_last_seen_at=_ts_ago(5000),
            price_last_seen_at=_ts_ago(30),
            onchain_last_seen_at=_ts_ago(10),
        )
        assert report["healthy"] is False
        sources = {r["source"] for r in report["stale_sources"]}
        assert "news" in sources

    def test_all_missing_timestamps_returns_all_stale(self):
        report = run_freshness_check()
        assert report["healthy"] is False
        assert len(report["stale_sources"]) == 3

    def test_checked_at_is_present(self):
        report = run_freshness_check(
            news_last_seen_at=_ts_ago(10),
            price_last_seen_at=_ts_ago(10),
            onchain_last_seen_at=_ts_ago(10),
        )
        assert "checked_at" in report

    def test_non_blocking_when_all_fetchers_raise(self):
        """Even when every fetcher_fn raises, the orchestrator must return a dict."""
        def boom():
            raise RuntimeError("boom")

        report = run_freshness_check(
            news_fetcher_fn=boom,
            price_fetcher_fn=boom,
            onchain_fetcher_fn=boom,
        )
        assert isinstance(report, dict)
        assert "results" in report
        assert len(report["results"]) == 3
        for r in report["results"]:
            assert r["severity"] == "critical"

    def test_price_source_stale_included_in_stale_sources(self):
        report = run_freshness_check(
            news_last_seen_at=_ts_ago(10),
            price_last_seen_at=_ts_ago(2000),
            onchain_last_seen_at=_ts_ago(10),
        )
        assert report["healthy"] is False
        stale_names = [r["source"] for r in report["stale_sources"]]
        assert "price" in stale_names

    def test_onchain_stale_warning(self):
        report = run_freshness_check(
            news_last_seen_at=_ts_ago(10),
            price_last_seen_at=_ts_ago(10),
            onchain_last_seen_at=_ts_ago(200),
        )
        assert report["healthy"] is False
        stale_names = [r["source"] for r in report["stale_sources"]]
        assert "onchain" in stale_names

    def test_uses_fetcher_fns_when_timestamps_absent(self):
        news_ts = _ts_ago(10)
        price_ts = _ts_ago(10)
        onchain_ts = _ts_ago(10)
        report = run_freshness_check(
            news_fetcher_fn=lambda: news_ts,
            price_fetcher_fn=lambda: price_ts,
            onchain_fetcher_fn=lambda: onchain_ts,
        )
        assert report["healthy"] is True

    def test_partial_failure_does_not_block_healthy_sources(self):
        """One bad fetcher must not prevent healthy probes from completing."""
        def bad_news():
            raise RuntimeError("news API down")

        report = run_freshness_check(
            news_fetcher_fn=bad_news,
            price_last_seen_at=_ts_ago(10),
            onchain_last_seen_at=_ts_ago(10),
        )
        results_by_source = {r["source"]: r for r in report["results"]}
        assert results_by_source["price"]["severity"] == "healthy"
        assert results_by_source["onchain"]["severity"] == "healthy"
        assert results_by_source["news"]["severity"] == "critical"

    def test_results_list_always_has_three_entries(self):
        report = run_freshness_check()
        assert len(report["results"]) == 3

    def test_result_sources_are_news_price_onchain(self):
        report = run_freshness_check(
            news_last_seen_at=_ts_ago(10),
            price_last_seen_at=_ts_ago(10),
            onchain_last_seen_at=_ts_ago(10),
        )
        sources = {r["source"] for r in report["results"]}
        assert sources == {"news", "price", "onchain"}


# ---------------------------------------------------------------------------
# StaleSourceReport actionable content
# ---------------------------------------------------------------------------


class TestStaleSourceReport:
    def test_recommended_action_contains_api_hint_for_news(self):
        report = run_freshness_check(news_last_seen_at=_ts_ago(5000))
        stale = {r["source"]: r for r in report["stale_sources"]}
        assert "news" in stale
        action = stale["news"]["recommended_action"]
        assert "API" in action or "api" in action.lower()

    def test_runbook_hint_contains_runbook_reference_for_price(self):
        report = run_freshness_check(price_last_seen_at=_ts_ago(2000))
        stale = {r["source"]: r for r in report["stale_sources"]}
        hint = stale["price"]["runbook_hint"]
        assert "RUNBOOK" in hint.upper() or "runbook" in hint.lower()

    def test_runbook_hint_present_for_onchain(self):
        report = run_freshness_check(onchain_last_seen_at=_ts_ago(700))
        stale = {r["source"]: r for r in report["stale_sources"]}
        assert stale["onchain"]["runbook_hint"]

    def test_stale_report_includes_age_seconds(self):
        report = run_freshness_check(news_last_seen_at=_ts_ago(5000))
        stale = {r["source"]: r for r in report["stale_sources"]}
        assert stale["news"]["age_seconds"] == pytest.approx(5000.0, abs=5.0)

    def test_stale_report_includes_last_seen_at(self):
        ts = _ts_ago(5000)
        report = run_freshness_check(news_last_seen_at=ts)
        stale = {r["source"]: r for r in report["stale_sources"]}
        assert stale["news"]["last_seen_at"] is not None
