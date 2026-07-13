"""
Daily on-chain KPI snapshot – fetcher and scheduler job (#877).

Captures TVL, 24-h volume, active rounds, and contribution counts once per
UTC calendar day and persists them via PostgresService.  Duplicate snapshots
for the same period_date are silently skipped.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any, Dict

from src.utils.logger import setup_logger
from src.db.postgres_service import PostgresService

logger = setup_logger(__name__)


def _fetch_kpis(period_date: str) -> Dict[str, Any]:
    """Fetch on-chain KPIs for *period_date* (YYYY-MM-DD).

    Falls back to 0.0 / 0 for any metric that cannot be retrieved so the
    snapshot is always written (allows partial data rather than no data).
    """
    tvl_xlm = 0.0
    volume_xlm = 0.0
    active_rounds = 0
    contribution_count = 0
    extra: Dict[str, Any] = {}

    # ── Volume + network stats via Stellar Horizon ───────────────────────────
    try:
        from src.ingestion.stellar_fetcher import StellarDataFetcher

        horizon_url = os.getenv("HORIZON_URL")
        network = os.getenv("STELLAR_NETWORK", "public")
        fetcher = StellarDataFetcher(horizon_url=horizon_url, network=network)

        vol = fetcher.get_asset_volume("XLM", hours=24)
        volume_xlm = vol.total_volume if vol else 0.0

        stats = fetcher.get_network_stats()
        extra["latest_ledger"] = stats.get("latest_ledger", 0)
        extra["protocol_version"] = stats.get("protocol_version", "")
    except Exception as exc:
        logger.warning("Could not fetch Stellar volume/stats: %s", exc)

    # ── Active rounds + contribution count from contract events ─────────────
    try:
        service = PostgresService()
        with service.get_session() as session:
            from src.db.models import ProjectView, ContractEvent
            from sqlalchemy import func as sa_func

            active_rounds = (
                session.query(sa_func.count(ProjectView.id))
                .filter(ProjectView.status == "active")
                .scalar()
                or 0
            )

            # Contributions recorded for this calendar day
            from datetime import date
            day = date.fromisoformat(period_date)
            day_start = datetime(day.year, day.month, day.day, tzinfo=timezone.utc)
            day_end = datetime(day.year, day.month, day.day, 23, 59, 59, tzinfo=timezone.utc)

            contribution_count = (
                session.query(sa_func.count(ContractEvent.id))
                .filter(
                    ContractEvent.event_type == "Contribute",
                    ContractEvent.timestamp >= day_start,
                    ContractEvent.timestamp <= day_end,
                )
                .scalar()
                or 0
            )

            # TVL: sum of total_contributions across all projects
            tvl_xlm = (
                session.query(sa_func.coalesce(sa_func.sum(ProjectView.total_contributions), 0.0))
                .scalar()
                or 0.0
            )
    except Exception as exc:
        logger.warning("Could not fetch round/contribution KPIs: %s", exc)

    return {
        "tvl_xlm": tvl_xlm,
        "volume_xlm": volume_xlm,
        "active_rounds": int(active_rounds),
        "contribution_count": int(contribution_count),
        "extra_data": extra or None,
    }


def run_onchain_kpi_snapshot_job() -> None:
    """Fetch today's on-chain KPIs and persist a snapshot.

    Intended to be called by the scheduler once per day.  Safe to call
    multiple times – duplicate snapshots for the same period are skipped.
    """
    period_date = datetime.now(tz=timezone.utc).strftime("%Y-%m-%d")
    logger.info("Running on-chain KPI snapshot for %s", period_date)

    try:
        kpis = _fetch_kpis(period_date)
        service = PostgresService()
        snapshot = service.save_onchain_kpi_snapshot(
            period_date=period_date,
            tvl_xlm=kpis["tvl_xlm"],
            volume_xlm=kpis["volume_xlm"],
            active_rounds=kpis["active_rounds"],
            contribution_count=kpis["contribution_count"],
            extra_data=kpis["extra_data"],
            captured_at=datetime.now(tz=timezone.utc),
        )
        if snapshot:
            logger.info(
                "KPI snapshot persisted: period=%s tvl=%.2f volume=%.2f "
                "rounds=%d contributions=%d",
                period_date,
                kpis["tvl_xlm"],
                kpis["volume_xlm"],
                kpis["active_rounds"],
                kpis["contribution_count"],
            )
    except Exception as exc:
        logger.error("On-chain KPI snapshot job failed: %s", exc, exc_info=True)
