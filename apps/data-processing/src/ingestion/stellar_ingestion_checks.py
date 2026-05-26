"""Stellar ingestion quality checks for testnet.

MVP goals (idempotent + low-noise):
- Detect missing ledger ranges / ingestion lag (best-effort via Horizon ledger + pipeline lag)
- Detect duplicate events (best-effort; this pipeline currently ingests aggregates, not raw ops)
- Detect drift between raw events and materialized views (best-effort; currently only aggregates exist)
- Produce a clear report to stdout + persisted JSON file

This repository's current ingestion pipeline stores *aggregated* on-chain metrics (e.g. XLM volume windows)
rather than per-transaction/per-operation raw events. Therefore, checks are implemented against
what we actually persist:
- network/ledger freshness via Horizon latest ledger close time
- analytics drift between raw fetched volume vs stored recent analytics/materializations (analytics_records)

If/when raw event tables are added, these checks can be extended without changing the report schema.
"""

from __future__ import annotations

import argparse
import json
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from src.db import PostgresService
from src.ingestion.stellar_fetcher import StellarDataFetcher


REPORT_DIR_DEFAULT = "./data/ingestion_reports"


@dataclass
class CheckFinding:
    check_id: str
    severity: str  # "warning" | "error"
    passed: bool
    metric: Optional[str] = None
    details: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "check_id": self.check_id,
            "severity": self.severity,
            "passed": self.passed,
            "metric": self.metric,
            "details": self.details or {},
        }


def _parse_iso_datetime(s: str) -> Optional[datetime]:
    if not s:
        return None
    try:
        # Stellar Horizon uses RFC3339, often ends with Z
        if s.endswith("Z"):
            return datetime.fromisoformat(s.replace("Z", "+00:00"))
        return datetime.fromisoformat(s)
    except Exception:
        return None


def _horizon_latest_ledger(fetcher: StellarDataFetcher) -> Dict[str, Any]:
    """Return latest ledger sequence + close time via Horizon.

    Best-effort: uses existing StellarDataFetcher.get_network_stats().
    """
    stats = fetcher.get_network_stats() or {}
    seq = stats.get("latest_ledger") or stats.get("latest_ledger_sequence")
    closed_at = stats.get("ledger_close_time") or stats.get("closed_at")
    dt = _parse_iso_datetime(closed_at) if isinstance(closed_at, str) else None
    return {
        "latest_ledger_sequence": seq,
        "ledger_close_time": closed_at,
        "ledger_close_time_dt": dt.isoformat() if dt else None,
    }


def check_ingestion_lag(
    *,
    fetcher: StellarDataFetcher,
    allowed_lag_seconds: int,
) -> CheckFinding:
    """Detect ingestion lag.

    We can only reliably measure *network freshness* (latest ledger close time).
    The current codebase does not persist per-ledger ingestion cursors.

    Heuristic: ingestion is considered stale if Horizon's latest ledger closed_at is
    older than allowed_lag_seconds.
    """
    latest = _horizon_latest_ledger(fetcher)
    dt = _parse_iso_datetime(latest.get("ledger_close_time") or "")
    if dt is None:
        return CheckFinding(
            check_id="missing_ledger_ranges_or_ingestion_lag",
            severity="error",
            passed=False,
            metric="horizon_latest_ledger_close_time",
            details={"reason": "Could not parse ledger_close_time from Horizon" , "latest": latest},
        )

    now = datetime.now(timezone.utc)
    lag = (now - dt).total_seconds()

    passed = lag <= allowed_lag_seconds
    return CheckFinding(
        check_id="missing_ledger_ranges_or_ingestion_lag",
        severity="warning" if not passed else "warning",
        passed=passed,
        metric="ingestion_lag_seconds",
        details={
            "now_utc": now.isoformat(),
            "latest_ledger_close_time": dt.isoformat(),
            "lag_seconds": lag,
            "allowed_lag_seconds": allowed_lag_seconds,
            "latest_ledger_sequence": latest.get("latest_ledger_sequence"),
        },
    )


def check_duplicate_events_best_effort(
    *,
    postgres: Optional[PostgresService],
    window_hours: int,
) -> CheckFinding:
    """Detect duplicates.

    The current ingestion pipeline persists analytics_records (aggregates) and
    legacy tables (articles, social posts, insights).

    There is no canonical raw event table (tx hash + event index) to dedupe.
    Therefore we detect likely duplicates by looking for repeated analytics_records
    with same (record_type, metric_name, asset, window, timestamp bucket).

    Idempotent + safe: read-only.
    """
    if postgres is None:
        return CheckFinding(
            check_id="duplicate_events",
            severity="warning",
            passed=True,
            details={"note": "PostgreSQL unavailable; skipping duplicate event checks"},
        )

    cutoff = datetime.utcnow() - timedelta(hours=window_hours)

    # PostgresService only exposes get_analytics_records(...)
    # We'll fetch recent records and compute duplicates in-memory.
    records = postgres.get_analytics_records(hours=window_hours, limit=5000)
    if not records:
        return CheckFinding(
            check_id="duplicate_events",
            severity="warning",
            passed=True,
            details={"note": "No analytics_records found in window"},
        )

    # Bucket timestamp to the minute to keep noise low.
    def bucket(ts: datetime) -> str:
        return ts.replace(second=0, microsecond=0).isoformat()

    seen: Dict[Tuple[Any, ...], int] = {}
    for r in records:
        key = (r.record_type, r.asset, r.metric_name, r.window, bucket(r.timestamp))
        seen[key] = seen.get(key, 0) + 1

    dupes = [{"key": list(k), "count": c} for k, c in seen.items() if c > 1]

    passed = len(dupes) == 0
    return CheckFinding(
        check_id="duplicate_events",
        severity="warning" if not passed else "warning",
        passed=passed,
        metric="duplicate_analytics_record_groups",
        details={
            "window_hours": window_hours,
            "records_fetched": len(records),
            "duplicate_groups": len(dupes),
            "examples": dupes[:10],
            "cutoff_utc": cutoff.isoformat(),
        },
    )


def _compute_expected_volume_windows(asset: str, hours_list: List[int], network: str) -> Dict[str, float]:
    """Fetch current on-chain volume for multiple horizons."""
    fetcher = StellarDataFetcher(network=network)
    out: Dict[str, float] = {}
    try:
        for h in hours_list:
            v = fetcher.get_asset_volume(asset, hours=h)
            out[f"{h}h"] = float(v.total_volume)
        return out
    finally:
        fetcher.clear_cache()


def check_drift_between_raw_and_materialized(
    *,
    postgres: Optional[PostgresService],
    asset: str,
    network: str,
    hours_list: List[int],
    compare_window_hours: int,
    drift_ratio_threshold: float,
) -> CheckFinding:
    """Detect drift between raw fetch results and materialized views.

    In this codebase, "materialized views" are approximated by analytics_records
    persisted in PostgreSQL. Since the ingestion pipeline does not write a dedicated
    view for raw volume, we look for analytics_records with metric_name == "volume"
    and record_type == "onchain_volume" (best-effort).

    If no matching records exist, we pass with note (low-noise).
    """
    if postgres is None:
        return CheckFinding(
            check_id="drift_between_raw_and_materialized_views",
            severity="warning",
            passed=True,
            details={"note": "PostgreSQL unavailable; skipping drift checks"},
        )

    # Fetch raw volume windows (fresh)
    raw = _compute_expected_volume_windows(asset, hours_list, network)

    # Load recent analytics records and attempt to match by metric_name/window.
    # get_analytics_records only supports record_type/asset/metric_name filters.
    # We'll fetch by time window and filter in-memory.
    recent = postgres.get_analytics_records(hours=compare_window_hours, limit=8000)

    # Best-effort matching:
    # metric_name "volume" and record_type "onchain_volume" and asset == asset.
    matches = [
        r
        for r in recent
        if (r.asset == asset)
        and (str(r.metric_name).lower() in {"volume", "onchain_volume", "xlm_volume"})
        and (r.window is not None)
        and (str(r.record_type).lower() in {"onchain_volume", "ingestion_onchain_volume", "stellar_volume"})
    ]

    if not matches:
        return CheckFinding(
            check_id="drift_between_raw_and_materialized_views",
            severity="warning",
            passed=True,
            details={
                "note": "No matching analytics_records for on-chain volume found; skipping drift check to avoid noise.",
                "raw": raw,
                "compare_window_hours": compare_window_hours,
            },
        )

    # Take the latest per window
    latest_by_window: Dict[str, Any] = {}
    for r in matches:
        latest_by_window[r.window] = max(
            latest_by_window.get(r.window, r),
            r,
            key=lambda x: x.timestamp,
        )

    drift_reports: List[Dict[str, Any]] = []
    passed_all = True
    for h in hours_list:
        window_key_candidates = [f"{h}h", f"{h}h_window", f"{h}h".upper()]
        found = None
        for w in window_key_candidates:
            if w in latest_by_window:
                found = latest_by_window[w]
                break
        if found is None:
            passed_all = False
            drift_reports.append({
                "window": f"{h}h",
                "status": "missing_materialization",
            })
            continue

        materialized = float(found.value)
        expected = float(raw[f"{h}h"])
        if expected == 0:
            ratio = None
            abs_diff = abs(materialized - expected)
            passed = abs_diff == 0
        else:
            ratio = abs(materialized - expected) / expected
            passed = ratio <= drift_ratio_threshold
        passed_all = passed_all and passed

        drift_reports.append({
            "window": f"{h}h",
            "expected_raw_volume": expected,
            "materialized_volume": materialized,
            "abs_diff": abs(materialized - expected),
            "drift_ratio": ratio,
            "threshold": drift_ratio_threshold,
            "passed": passed,
        })

    return CheckFinding(
        check_id="drift_between_raw_and_materialized_views",
        severity="warning" if not passed_all else "warning",
        passed=passed_all,
        metric="drift_ratio",
        details={
            "asset": asset,
            "network": network,
            "raw": raw,
            "compare_window_hours": compare_window_hours,
            "drift_ratio_threshold": drift_ratio_threshold,
            "drift_reports": drift_reports,
        },
    )


def run_all_checks(
    *,
    network: str,
    asset: str,
    ingestion_lag_seconds: int,
    dup_window_hours: int,
    drift_compare_window_hours: int,
    drift_ratio_threshold: float,
    hours_list: List[int],
    report_dir: str,
    manual_run_id: Optional[str],
) -> Dict[str, Any]:
    """Run all checks and return report dict."""

    report_ts = datetime.now(timezone.utc).isoformat()

    report_path = Path(report_dir)
    report_path.mkdir(parents=True, exist_ok=True)

    out_file = report_path / f"stellar_ingestion_quality_{report_ts.replace(':','-')}.json"

    # Fetcher + postgres are created inside to keep this script safe.
    fetcher = StellarDataFetcher(network=network)

    postgres: Optional[PostgresService] = None
    try:
        postgres = PostgresService()
    except Exception:
        postgres = None

    findings: List[CheckFinding] = []

    findings.append(
        check_ingestion_lag(
            fetcher=fetcher,
            allowed_lag_seconds=ingestion_lag_seconds,
        )
    )

    findings.append(
        check_duplicate_events_best_effort(
            postgres=postgres,
            window_hours=dup_window_hours,
        )
    )

    findings.append(
        check_drift_between_raw_and_materialized(
            postgres=postgres,
            asset=asset,
            network=network,
            hours_list=hours_list,
            compare_window_hours=drift_compare_window_hours,
            drift_ratio_threshold=drift_ratio_threshold,
        )
    )

    passed = all(f.passed for f in findings)

    report: Dict[str, Any] = {
        "schema_version": 1,
        "generated_at": report_ts,
        "network": network,
        "asset": asset,
        "manual_run_id": manual_run_id,
        "thresholds": {
            "ingestion_lag_seconds": ingestion_lag_seconds,
            "duplicate_check_window_hours": dup_window_hours,
            "drift_compare_window_hours": drift_compare_window_hours,
            "drift_ratio_threshold": drift_ratio_threshold,
            "drift_hours_list": hours_list,
        },
        "summary": {
            "passed": passed,
            "findings_total": len(findings),
            "findings_failed": sum(1 for f in findings if not f.passed),
        },
        "findings": [f.to_dict() for f in findings],
    }

    # Persist
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)

    # Print MVP clear report
    print("\n=== Stellar Ingestion Quality Report ===")
    print(f"generated_at: {report_ts}")
    print(f"network: {network} | asset: {asset}")
    print(f"passed: {passed}")
    print(f"report_file: {str(out_file)}")
    for fi in findings:
        status = "PASS" if fi.passed else "FAIL"
        print(f"- [{status}] {fi.check_id} severity={fi.severity} metric={fi.metric}")

    # If we want low-noise: exit non-zero only when ingestion lag fails.
    # Drift/duplicates are warning-level (but can still be useful).
    # Keep this as MVP behavior.
    critical_fail = any((f.check_id == "missing_ledger_ranges_or_ingestion_lag") and (not f.passed) for f in findings)
    return {
        **report,
        "exit_code": 1 if critical_fail else 0,
    }


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Run Stellar ingestion quality checks (testnet-focused).")
    parser.add_argument("--network", default=os.getenv("STELLAR_NETWORK", "testnet"), choices=["testnet", "public"], help="Horizon network selector")
    parser.add_argument("--asset", default=os.getenv("ONCHAIN_ASSET", "XLM"), help="Asset code")

    parser.add_argument("--ingestion-lag-seconds", type=int, default=int(os.getenv("INGESTION_LAG_SECONDS", "300")), help="Max allowed lag between Horizon latest ledger close time and now")
    parser.add_argument("--duplicate-window-hours", type=int, default=int(os.getenv("DUPLICATE_WINDOW_HOURS", "24")), help="Lookback window for duplicate analytics record grouping")

    parser.add_argument("--drift-compare-window-hours", type=int, default=int(os.getenv("DRIFT_COMPARE_WINDOW_HOURS", "24")), help="Lookback for materialized view records")
    parser.add_argument("--drift-ratio-threshold", type=float, default=float(os.getenv("DRIFT_RATIO_THRESHOLD", "0.05")), help="Max allowed relative drift (abs(diff)/expected)")
    parser.add_argument("--drift-hours", default=os.getenv("DRIFT_HOURS_LIST", "24,48"), help="Comma-separated list of horizons to compare, e.g. 24,48")

    parser.add_argument("--report-dir", default=os.getenv("INGESTION_REPORT_DIR", REPORT_DIR_DEFAULT), help="Directory to persist reports")
    parser.add_argument("--manual-run-id", default=os.getenv("MANUAL_RUN_ID"), help="Optional run identifier")

    args = parser.parse_args(argv)

    hours_list = [int(x.strip()) for x in str(args.drift_hours).split(",") if x.strip()]
    if not hours_list:
        hours_list = [24, 48]

    result = run_all_checks(
        network=args.network,
        asset=str(args.asset).upper(),
        ingestion_lag_seconds=args.ingestion_lag_seconds,
        dup_window_hours=args.duplicate_window_hours,
        drift_compare_window_hours=args.drift_compare_window_hours,
        drift_ratio_threshold=args.drift_ratio_threshold,
        hours_list=hours_list,
        report_dir=args.report_dir,
        manual_run_id=args.manual_run_id,
    )

    return int(result.get("exit_code", 0))


if __name__ == "__main__":
    raise SystemExit(main())

