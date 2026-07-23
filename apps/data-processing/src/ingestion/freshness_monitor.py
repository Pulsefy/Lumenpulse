"""Source Freshness SLA Monitor for the data-processing pipeline.

Tracks freshness and delay budgets across news, price, and on-chain (Stellar)
feeds so maintainers know when a feed is stale before the product surfaces drift.

Design principles
-----------------
* One ``FreshnessThreshold`` per feed, all values configurable via environment
  variables so SREs can tune without code changes.
* Each probe runs inside its own try/except block — a failure in one source
  never blocks the others or the main pipeline.
* Results are emitted as structured log records **and** as Prometheus metrics so
  they can be observed from any monitoring stack.
* ``StaleSourceReport`` objects carry enough context to be actionable on their
  own (last_seen, age, thresholds, recommended actions).
* This module is intentionally self-contained at import time — it does not pull
  in the database layer or heavy fetcher modules so it can be imported in
  lightweight test environments without full dependency installation.

Usage
-----
Run a full freshness scan from the pipeline::

    from src.ingestion.freshness_monitor import run_freshness_check

    report = run_freshness_check()
    if not report["healthy"]:
        for stale in report["stale_sources"]:
            print(stale["recommended_action"])

Environment variables (all optional, defaults shown)
-----------------------------------------------------
NEWS_FRESHNESS_WARNING_SECONDS   = 1800   (30 min)
NEWS_FRESHNESS_CRITICAL_SECONDS  = 3600   (60 min)
PRICE_FRESHNESS_WARNING_SECONDS  = 300    (5 min)
PRICE_FRESHNESS_CRITICAL_SECONDS = 900    (15 min)
ONCHAIN_FRESHNESS_WARNING_SECONDS  = 120  (2 min)
ONCHAIN_FRESHNESS_CRITICAL_SECONDS = 600  (10 min)
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional

from src.utils.logger import setup_logger
from src.utils.metrics import INDEXER_LAG_SECONDS, SOURCE_FAILURES_TOTAL, SOURCE_HEALTH

logger = setup_logger("lumenpulse.freshness_monitor")

# ---------------------------------------------------------------------------
# Severity enum — mirrors AlertSeverity in ingestion_alerting without importing
# that module (which has heavy DB dependencies).
# ---------------------------------------------------------------------------


class FreshnessSeverity(str, Enum):
    """Severity classification for a freshness measurement."""

    HEALTHY = "healthy"
    WARNING = "warning"
    CRITICAL = "critical"


# ---------------------------------------------------------------------------
# Thresholds
# ---------------------------------------------------------------------------

_FRESHNESS_DEFAULTS: Dict[str, Dict[str, float]] = {
    "news_freshness": {"warning": 1800.0, "critical": 3600.0},
    "price_freshness": {"warning": 300.0, "critical": 900.0},
    "onchain_freshness": {"warning": 120.0, "critical": 600.0},
}


def _freshness_thresholds(metric_name: str) -> Dict[str, float]:
    """Return warning/critical thresholds for *metric_name*.

    Values can be overridden via environment variables of the form
    ``<METRIC_NAME_UPPER>_WARNING_SECONDS`` and
    ``<METRIC_NAME_UPPER>_CRITICAL_SECONDS``.
    """
    base = _FRESHNESS_DEFAULTS.get(metric_name, {"warning": 600.0, "critical": 1800.0})
    prefix = metric_name.upper()
    warning = float(os.getenv(f"{prefix}_WARNING_SECONDS", str(base["warning"])))
    critical = float(os.getenv(f"{prefix}_CRITICAL_SECONDS", str(base["critical"])))
    return {"warning": warning, "critical": critical}


def _severity_for_freshness(lag_seconds: float, metric_name: str) -> FreshnessSeverity:
    """Classify *lag_seconds* against the metric's threshold ladder."""
    t = _freshness_thresholds(metric_name)
    if lag_seconds >= t["critical"]:
        return FreshnessSeverity.CRITICAL
    if lag_seconds >= t["warning"]:
        return FreshnessSeverity.WARNING
    return FreshnessSeverity.HEALTHY


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------


@dataclass
class FreshnessThreshold:
    """Configurable SLA thresholds for a single data source."""

    source: str
    metric_name: str
    warning_seconds: float
    critical_seconds: float

    @classmethod
    def for_source(cls, source: str, metric_name: str) -> "FreshnessThreshold":
        t = _freshness_thresholds(metric_name)
        return cls(
            source=source,
            metric_name=metric_name,
            warning_seconds=t["warning"],
            critical_seconds=t["critical"],
        )


@dataclass
class FreshnessResult:
    """Freshness measurement for one data source at a point in time."""

    source: str
    metric_name: str
    last_seen_at: Optional[datetime]
    age_seconds: float
    severity: FreshnessSeverity
    warning_threshold_seconds: float
    critical_threshold_seconds: float
    checked_at: datetime
    details: Dict[str, Any] = field(default_factory=dict)
    error: Optional[str] = None

    def is_stale(self) -> bool:
        return self.severity in (FreshnessSeverity.WARNING, FreshnessSeverity.CRITICAL)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "source": self.source,
            "metric_name": self.metric_name,
            "last_seen_at": self.last_seen_at.isoformat() if self.last_seen_at else None,
            "age_seconds": self.age_seconds,
            "severity": self.severity.value,
            "warning_threshold_seconds": self.warning_threshold_seconds,
            "critical_threshold_seconds": self.critical_threshold_seconds,
            "checked_at": self.checked_at.isoformat(),
            "details": self.details,
            "error": self.error,
            "is_stale": self.is_stale(),
        }

    def to_lag_snapshot(self) -> Dict[str, Any]:
        """Return a dict compatible with LagMetricSnapshot.to_dict().

        Provides a bridge to the existing ingestion_alerting layer without
        requiring a direct import of that module at load time.
        """
        return {
            "metric_name": self.metric_name,
            "source": self.source,
            "lag_seconds": self.age_seconds,
            "severity": self.severity.value,
            "warning_threshold_seconds": self.warning_threshold_seconds,
            "critical_threshold_seconds": self.critical_threshold_seconds,
            "details": self.details,
        }


@dataclass
class StaleSourceReport:
    """Actionable report for a source that has exceeded its freshness SLA."""

    result: FreshnessResult
    recommended_action: str
    runbook_hint: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            **self.result.to_dict(),
            "recommended_action": self.recommended_action,
            "runbook_hint": self.runbook_hint,
        }


# ---------------------------------------------------------------------------
# Prometheus helpers (thin wrappers so probes don't import metrics directly)
# ---------------------------------------------------------------------------


def _publish_freshness_metric(result: FreshnessResult) -> None:
    """Set the INDEXER_LAG_SECONDS gauge for this freshness result."""
    try:
        INDEXER_LAG_SECONDS.labels(
            metric_name=result.metric_name,
            source=result.source,
        ).set(result.age_seconds if result.age_seconds != float("inf") else -1.0)
    except Exception:
        pass  # Never let metrics emission crash the pipeline


def _record_source_failure_metric(source: str, failure_type: str) -> None:
    try:
        SOURCE_FAILURES_TOTAL.labels(source=source, failure_type=failure_type).inc()
        SOURCE_HEALTH.labels(source=source).set(0)
    except Exception:
        pass


def _record_source_success_metric(source: str) -> None:
    try:
        SOURCE_HEALTH.labels(source=source).set(1)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Per-source probe functions
# ---------------------------------------------------------------------------

_RECOMMENDED_ACTIONS: Dict[str, str] = {
    "news": (
        "Verify CRYPTOCOMPARE_API_KEY and NEWSAPI_API_KEY env vars. "
        "Check for upstream API outages or rate-limit exhaustion."
    ),
    "price": (
        "Verify network access to CoinGecko/CoinCap. "
        "Check PRICE_FETCHER_TIMEOUT. Trigger a manual price refresh."
    ),
    "onchain": (
        "Verify STELLAR_NETWORK and Horizon RPC connectivity. "
        "Check for ledger consensus halts on stellarchain.io."
    ),
}

_RUNBOOK_HINTS: Dict[str, str] = {
    "news": "See INGESTION_ALERTING_RUNBOOK.md § News Feed Outage",
    "price": "See INGESTION_ALERTING_RUNBOOK.md § Price Feed Outage",
    "onchain": "See INGESTION_ALERTING_RUNBOOK.md § Stellar/Horizon Outage",
}


def _make_stale_report(result: FreshnessResult, feed_key: str) -> StaleSourceReport:
    return StaleSourceReport(
        result=result,
        recommended_action=_RECOMMENDED_ACTIONS.get(feed_key, "Investigate the source."),
        runbook_hint=_RUNBOOK_HINTS.get(feed_key, "See ingestion runbook."),
    )


def _unknown_freshness(
    source: str,
    metric_name: str,
    error: str,
    checked_at: datetime,
) -> FreshnessResult:
    """Return a CRITICAL result when we cannot determine the last-seen timestamp."""
    t = _freshness_thresholds(metric_name)
    return FreshnessResult(
        source=source,
        metric_name=metric_name,
        last_seen_at=None,
        age_seconds=float("inf"),
        severity=FreshnessSeverity.CRITICAL,
        warning_threshold_seconds=t["warning"],
        critical_threshold_seconds=t["critical"],
        checked_at=checked_at,
        error=error,
        details={"reason": "Probe raised an exception; age unknown"},
    )


def probe_news_freshness(
    *,
    last_article_at: Optional[datetime] = None,
    fetcher_fn: Optional[Any] = None,
) -> FreshnessResult:
    """Probe how fresh the latest ingested news article is.

    Parameters
    ----------
    last_article_at:
        Caller can supply the timestamp of the most recently ingested article
        (e.g. read from cache/DB).  When ``None``, the probe attempts to call
        *fetcher_fn* to retrieve the latest article timestamp.
    fetcher_fn:
        Callable returning the latest article timestamp as a ``datetime``.
        Used only when *last_article_at* is ``None``.  Kept injectable for
        easy unit-testing without network calls.
    """
    metric_name = "news_freshness"
    source = "news"
    checked_at = datetime.now(timezone.utc)
    t = _freshness_thresholds(metric_name)

    try:
        ts: Optional[datetime] = last_article_at

        if ts is None and fetcher_fn is not None:
            ts = fetcher_fn()

        if ts is None:
            result = FreshnessResult(
                source=source,
                metric_name=metric_name,
                last_seen_at=None,
                age_seconds=float("inf"),
                severity=FreshnessSeverity.CRITICAL,
                warning_threshold_seconds=t["warning"],
                critical_threshold_seconds=t["critical"],
                checked_at=checked_at,
                error="No article timestamp available",
                details={"reason": "last_article_at is None and fetcher returned None"},
            )
            _record_source_failure_metric(source, "no_data")
            logger.warning(
                "news_freshness: no article timestamp available",
                extra={"source": source, "metric_name": metric_name},
            )
            return result

        # Normalise to UTC
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)

        age = max(0.0, (checked_at - ts).total_seconds())
        severity = _severity_for_freshness(age, metric_name)

        result = FreshnessResult(
            source=source,
            metric_name=metric_name,
            last_seen_at=ts,
            age_seconds=age,
            severity=severity,
            warning_threshold_seconds=t["warning"],
            critical_threshold_seconds=t["critical"],
            checked_at=checked_at,
            details={"last_article_at": ts.isoformat()},
        )

        if severity == FreshnessSeverity.HEALTHY:
            _record_source_success_metric(source)
        else:
            _record_source_failure_metric(source, "stale")
            logger.warning(
                "news_freshness SLA breach: feed is %.0fs old",
                age,
                extra={"source": source, "severity": severity.value, "age_seconds": age},
            )

        return result

    except Exception as exc:  # non-blocking: catch all
        logger.warning("News freshness probe failed: %s", exc, exc_info=True)
        _record_source_failure_metric(source, type(exc).__name__)
        return _unknown_freshness(source, metric_name, str(exc), checked_at)


def probe_price_freshness(
    *,
    last_price_at: Optional[datetime] = None,
    fetcher_fn: Optional[Any] = None,
) -> FreshnessResult:
    """Probe how fresh the latest ingested price tick is.

    Parameters
    ----------
    last_price_at:
        Timestamp of the most recently recorded price payload.
    fetcher_fn:
        Callable returning the latest price timestamp as a ``datetime``.
    """
    metric_name = "price_freshness"
    source = "price"
    checked_at = datetime.now(timezone.utc)
    t = _freshness_thresholds(metric_name)

    try:
        ts: Optional[datetime] = last_price_at

        if ts is None and fetcher_fn is not None:
            ts = fetcher_fn()

        if ts is None:
            result = FreshnessResult(
                source=source,
                metric_name=metric_name,
                last_seen_at=None,
                age_seconds=float("inf"),
                severity=FreshnessSeverity.CRITICAL,
                warning_threshold_seconds=t["warning"],
                critical_threshold_seconds=t["critical"],
                checked_at=checked_at,
                error="No price timestamp available",
                details={"reason": "last_price_at is None and fetcher returned None"},
            )
            _record_source_failure_metric(source, "no_data")
            logger.warning(
                "price_freshness: no price timestamp available",
                extra={"source": source, "metric_name": metric_name},
            )
            return result

        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)

        age = max(0.0, (checked_at - ts).total_seconds())
        severity = _severity_for_freshness(age, metric_name)

        result = FreshnessResult(
            source=source,
            metric_name=metric_name,
            last_seen_at=ts,
            age_seconds=age,
            severity=severity,
            warning_threshold_seconds=t["warning"],
            critical_threshold_seconds=t["critical"],
            checked_at=checked_at,
            details={"last_price_at": ts.isoformat()},
        )

        if severity == FreshnessSeverity.HEALTHY:
            _record_source_success_metric(source)
        else:
            _record_source_failure_metric(source, "stale")
            logger.warning(
                "price_freshness SLA breach: feed is %.0fs old",
                age,
                extra={"source": source, "severity": severity.value, "age_seconds": age},
            )

        return result

    except Exception as exc:
        logger.warning("Price freshness probe failed: %s", exc, exc_info=True)
        _record_source_failure_metric(source, type(exc).__name__)
        return _unknown_freshness(source, metric_name, str(exc), checked_at)


def probe_onchain_freshness(
    *,
    last_ledger_at: Optional[datetime] = None,
    fetcher_fn: Optional[Any] = None,
) -> FreshnessResult:
    """Probe how fresh the latest on-chain (Stellar ledger) data is.

    Parameters
    ----------
    last_ledger_at:
        Timestamp of the most recently ingested ledger close.
    fetcher_fn:
        Callable returning the latest ledger close timestamp as a ``datetime``.
    """
    metric_name = "onchain_freshness"
    source = "onchain"
    checked_at = datetime.now(timezone.utc)
    t = _freshness_thresholds(metric_name)

    try:
        ts: Optional[datetime] = last_ledger_at

        if ts is None and fetcher_fn is not None:
            ts = fetcher_fn()

        if ts is None:
            result = FreshnessResult(
                source=source,
                metric_name=metric_name,
                last_seen_at=None,
                age_seconds=float("inf"),
                severity=FreshnessSeverity.CRITICAL,
                warning_threshold_seconds=t["warning"],
                critical_threshold_seconds=t["critical"],
                checked_at=checked_at,
                error="No ledger timestamp available",
                details={"reason": "last_ledger_at is None and fetcher returned None"},
            )
            _record_source_failure_metric(source, "no_data")
            logger.warning(
                "onchain_freshness: no ledger timestamp available",
                extra={"source": source, "metric_name": metric_name},
            )
            return result

        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)

        age = max(0.0, (checked_at - ts).total_seconds())
        severity = _severity_for_freshness(age, metric_name)

        result = FreshnessResult(
            source=source,
            metric_name=metric_name,
            last_seen_at=ts,
            age_seconds=age,
            severity=severity,
            warning_threshold_seconds=t["warning"],
            critical_threshold_seconds=t["critical"],
            checked_at=checked_at,
            details={"last_ledger_close": ts.isoformat()},
        )

        if severity == FreshnessSeverity.HEALTHY:
            _record_source_success_metric(source)
        else:
            _record_source_failure_metric(source, "stale")
            logger.warning(
                "onchain_freshness SLA breach: feed is %.0fs old",
                age,
                extra={"source": source, "severity": severity.value, "age_seconds": age},
            )

        return result

    except Exception as exc:
        logger.warning("On-chain freshness probe failed: %s", exc, exc_info=True)
        _record_source_failure_metric(source, type(exc).__name__)
        return _unknown_freshness(source, metric_name, str(exc), checked_at)


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------

_FEED_KEY_MAP: Dict[str, str] = {
    "news_freshness": "news",
    "price_freshness": "price",
    "onchain_freshness": "onchain",
}


def evaluate_freshness_results(
    results: List[FreshnessResult],
) -> List[StaleSourceReport]:
    """Publish Prometheus metrics and emit log alerts; return stale-source reports."""
    reports: List[StaleSourceReport] = []

    for result in results:
        # Update Prometheus
        _publish_freshness_metric(result)

        # Emit structured log alert for non-healthy sources
        if result.severity != FreshnessSeverity.HEALTHY:
            feed_key = _FEED_KEY_MAP.get(result.metric_name, result.source)
            report = _make_stale_report(result, feed_key)
            reports.append(report)

            age_label = (
                f"{result.age_seconds:.0f}s"
                if result.age_seconds != float("inf")
                else "unknown"
            )
            threshold = (
                result.critical_threshold_seconds
                if result.severity == FreshnessSeverity.CRITICAL
                else result.warning_threshold_seconds
            )
            logger.error(
                "FRESHNESS_SLA_BREACH source=%s severity=%s age=%s threshold=%.0fs | %s",
                result.source,
                result.severity.value,
                age_label,
                threshold,
                report.recommended_action,
                extra={
                    "alert_type": "freshness_sla_breach",
                    "freshness_result": result.to_dict(),
                    "recommended_action": report.recommended_action,
                    "runbook_hint": report.runbook_hint,
                },
            )

    return reports


def run_freshness_check(
    *,
    news_last_seen_at: Optional[datetime] = None,
    price_last_seen_at: Optional[datetime] = None,
    onchain_last_seen_at: Optional[datetime] = None,
    news_fetcher_fn: Optional[Any] = None,
    price_fetcher_fn: Optional[Any] = None,
    onchain_fetcher_fn: Optional[Any] = None,
) -> Dict[str, Any]:
    """Run freshness probes for all three feeds and return a consolidated report.

    Each probe is independent — an exception in one source does not block the
    others.  The returned dict is always present and can be inspected
    programmatically.

    Parameters
    ----------
    *_last_seen_at:
        Pre-computed timestamps for each feed (e.g. read from an in-process
        cache).  Saves a network round-trip when the caller already knows the
        latest timestamp.
    *_fetcher_fn:
        Callables used to retrieve the latest timestamp when the ``*_last_seen_at``
        parameter is ``None``.

    Returns
    -------
    dict with keys:
        * ``checked_at``    – ISO-8601 timestamp of this run
        * ``results``       – list of :class:`FreshnessResult` dicts
        * ``stale_sources`` – list of :class:`StaleSourceReport` dicts
        * ``healthy``       – ``True`` when all sources are within SLA
    """
    results: List[FreshnessResult] = []

    # --- news (non-blocking) ---
    results.append(
        probe_news_freshness(
            last_article_at=news_last_seen_at,
            fetcher_fn=news_fetcher_fn,
        )
    )

    # --- price (non-blocking) ---
    results.append(
        probe_price_freshness(
            last_price_at=price_last_seen_at,
            fetcher_fn=price_fetcher_fn,
        )
    )

    # --- on-chain (non-blocking) ---
    results.append(
        probe_onchain_freshness(
            last_ledger_at=onchain_last_seen_at,
            fetcher_fn=onchain_fetcher_fn,
        )
    )

    stale_reports = evaluate_freshness_results(results)

    return {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "results": [r.to_dict() for r in results],
        "stale_sources": [r.to_dict() for r in stale_reports],
        "healthy": len(stale_reports) == 0,
    }
