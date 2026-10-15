"""Per-contract ingestion lag metrics for the data-processing pipeline.

Tracks the lag between the latest on-chain event timestamp and the latest
processed event timestamp for each of the five core contract domains:
  registry, vault, matching_pool, treasury, vesting

Lag is computed from the ``contract_events`` table (processed events) against
the ``raw_soroban_events`` table (on-chain events as ingested from the RPC).

Metrics are published to the existing Prometheus infrastructure via
``CONTRACT_INGESTION_LAG_SECONDS`` and alerts are emitted as structured log
records (mirroring the pattern in ``ingestion_alerting.py``).

Environment variables
---------------------
Contract IDs (fall back to the canonical testnet addresses):
  CONTRACT_ID_REGISTRY          – project registry contract
  CONTRACT_ID_VAULT             – crowdfund vault contract
  CONTRACT_ID_MATCHING_POOL     – matching pool contract
  CONTRACT_ID_TREASURY          – treasury contract
  CONTRACT_ID_VESTING           – vesting contract  (no default – treated as
                                   missing when absent)

Per-domain lag thresholds (seconds):
  CONTRACT_LAG_WARNING_SECONDS_{DOMAIN}   – default 300  (5 min)
  CONTRACT_LAG_CRITICAL_SECONDS_{DOMAIN}  – default 900  (15 min)
  (DOMAIN is the upper-cased domain name, e.g. CONTRACT_LAG_WARNING_SECONDS_VAULT)
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import func, select

from src.db.models import ContractEvent, RawSorobanEvent
from src.db.postgres_service import PostgresService
from src.utils.logger import setup_logger
from src.utils.metrics import CONTRACT_INGESTION_LAG_SECONDS

lag_logger = setup_logger("lumenpulse.contract_lag")

# ---------------------------------------------------------------------------
# Default canonical testnet contract IDs (sourced from backend .env.example)
# ---------------------------------------------------------------------------
_DOMAIN_CONTRACT_DEFAULTS: Dict[str, Optional[str]] = {
    "registry": "CBYFZU7C5TV2J56PEOXI5Q53HNFYFOW4USEBG4M6BCV7RUIMJI7JISLC",
    "vault": "CBBQW7T65XBDPIPXEIIPJVJEEIBSPC566HMEU2LTBAULLKCNUFRFBKRO",
    "matching_pool": "CBQJ2E2MPYRCQDHZZYJXHRKUTCTIJFO55AVGHB2WDZSLS2OOENUDC6HH",
    "treasury": "CB6FRSAWOGVLH5GD4ITATNZNLVTQ3TKDOWAXJVGUG77AKCO5UKHH5H3O",
    "vesting": None,  # no canonical default – must be set via env var
}

_DOMAIN_ENV_KEYS: Dict[str, str] = {
    "registry": "CONTRACT_ID_REGISTRY",
    "vault": "CONTRACT_ID_VAULT",
    "matching_pool": "CONTRACT_ID_MATCHING_POOL",
    "treasury": "CONTRACT_ID_TREASURY",
    "vesting": "CONTRACT_ID_VESTING",
}

_DEFAULT_WARNING_SECONDS = 300.0   # 5 minutes
_DEFAULT_CRITICAL_SECONDS = 900.0  # 15 minutes


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class ContractLagSnapshot:
    """Lag measurement for a single contract domain."""

    domain: str
    contract_id: Optional[str]
    lag_seconds: Optional[float]     # None when data is entirely absent
    latest_onchain_ts: Optional[datetime]
    latest_processed_ts: Optional[datetime]
    severity: str                    # "healthy" | "warning" | "critical" | "missing"
    warning_threshold_seconds: float
    critical_threshold_seconds: float
    details: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "domain": self.domain,
            "contract_id": self.contract_id,
            "lag_seconds": self.lag_seconds,
            "latest_onchain_ts": self.latest_onchain_ts.isoformat() if self.latest_onchain_ts else None,
            "latest_processed_ts": self.latest_processed_ts.isoformat() if self.latest_processed_ts else None,
            "severity": self.severity,
            "warning_threshold_seconds": self.warning_threshold_seconds,
            "critical_threshold_seconds": self.critical_threshold_seconds,
            "details": self.details,
        }


# ---------------------------------------------------------------------------
# Threshold helpers
# ---------------------------------------------------------------------------

def _get_thresholds(domain: str) -> Dict[str, float]:
    """Return (warning, critical) lag thresholds for *domain* in seconds."""
    key = domain.upper()
    warning = float(
        os.getenv(f"CONTRACT_LAG_WARNING_SECONDS_{key}", _DEFAULT_WARNING_SECONDS)
    )
    critical = float(
        os.getenv(f"CONTRACT_LAG_CRITICAL_SECONDS_{key}", _DEFAULT_CRITICAL_SECONDS)
    )
    return {"warning": warning, "critical": critical}


def _severity(lag_seconds: float, domain: str) -> str:
    t = _get_thresholds(domain)
    if lag_seconds >= t["critical"]:
        return "critical"
    if lag_seconds >= t["warning"]:
        return "warning"
    return "healthy"


def _contract_id_for(domain: str) -> Optional[str]:
    """Resolve the contract ID for *domain* from env vars or defaults."""
    env_key = _DOMAIN_ENV_KEYS.get(domain)
    if env_key:
        from_env = os.getenv(env_key)
        if from_env:
            return from_env
    return _DOMAIN_CONTRACT_DEFAULTS.get(domain)


# ---------------------------------------------------------------------------
# Core measurement
# ---------------------------------------------------------------------------

def measure_contract_lag(
    domain: str,
    postgres: PostgresService,
) -> ContractLagSnapshot:
    """Compute the ingestion lag for one contract domain.

    Lag = latest ``raw_soroban_events.created_at`` (proxy for on-chain event
    arrival time) minus latest ``contract_events.timestamp`` (processed event
    time) for the given contract ID.

    Both tables are filtered by ``contract_id``.  When a domain has no
    contract ID configured, the snapshot is returned with severity "missing".
    """
    thresholds = _get_thresholds(domain)
    contract_id = _contract_id_for(domain)

    if not contract_id:
        return ContractLagSnapshot(
            domain=domain,
            contract_id=None,
            lag_seconds=None,
            latest_onchain_ts=None,
            latest_processed_ts=None,
            severity="missing",
            warning_threshold_seconds=thresholds["warning"],
            critical_threshold_seconds=thresholds["critical"],
            details={"reason": f"No contract ID configured for domain '{domain}'"},
        )

    try:
        with postgres.get_session() as session:
            # Latest on-chain event timestamp (raw ingestion)
            raw_ts: Optional[datetime] = session.execute(
                select(func.max(RawSorobanEvent.created_at)).where(
                    RawSorobanEvent.contract_id == contract_id
                )
            ).scalar_one_or_none()

            # Latest processed event timestamp
            processed_ts: Optional[datetime] = session.execute(
                select(func.max(ContractEvent.timestamp)).where(
                    ContractEvent.contract_id == contract_id
                )
            ).scalar_one_or_none()

    except Exception as exc:
        lag_logger.warning(
            "contract_lag_query_failed domain=%s contract_id=%s error=%s",
            domain,
            contract_id,
            exc,
        )
        return ContractLagSnapshot(
            domain=domain,
            contract_id=contract_id,
            lag_seconds=None,
            latest_onchain_ts=None,
            latest_processed_ts=None,
            severity="missing",
            warning_threshold_seconds=thresholds["warning"],
            critical_threshold_seconds=thresholds["critical"],
            details={"reason": f"DB query failed: {exc}"},
        )

    now = datetime.now(timezone.utc)

    # Normalise naive timestamps to UTC
    def _utc(ts: Optional[datetime]) -> Optional[datetime]:
        if ts is None:
            return None
        return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)

    raw_ts = _utc(raw_ts)
    processed_ts = _utc(processed_ts)

    # No on-chain data at all – domain is completely untracked
    if raw_ts is None:
        return ContractLagSnapshot(
            domain=domain,
            contract_id=contract_id,
            lag_seconds=None,
            latest_onchain_ts=None,
            latest_processed_ts=processed_ts,
            severity="missing",
            warning_threshold_seconds=thresholds["warning"],
            critical_threshold_seconds=thresholds["critical"],
            details={"reason": "No raw_soroban_events rows for contract"},
        )

    # No processed events yet – lag equals full span since first raw event arrived
    if processed_ts is None:
        lag = max(0.0, (now - raw_ts).total_seconds())
        sev = _severity(lag, domain)
        return ContractLagSnapshot(
            domain=domain,
            contract_id=contract_id,
            lag_seconds=lag,
            latest_onchain_ts=raw_ts,
            latest_processed_ts=None,
            severity=sev,
            warning_threshold_seconds=thresholds["warning"],
            critical_threshold_seconds=thresholds["critical"],
            details={"reason": "No contract_events rows for contract (never processed)"},
        )

    lag = max(0.0, (raw_ts - processed_ts).total_seconds())
    sev = _severity(lag, domain)

    return ContractLagSnapshot(
        domain=domain,
        contract_id=contract_id,
        lag_seconds=lag,
        latest_onchain_ts=raw_ts,
        latest_processed_ts=processed_ts,
        severity=sev,
        warning_threshold_seconds=thresholds["warning"],
        critical_threshold_seconds=thresholds["critical"],
        details={
            "checked_at": now.isoformat(),
        },
    )


# ---------------------------------------------------------------------------
# Publish + alert
# ---------------------------------------------------------------------------

def _publish_snapshot(snapshot: ContractLagSnapshot) -> None:
    """Push lag value to the Prometheus gauge."""
    if snapshot.lag_seconds is not None:
        CONTRACT_INGESTION_LAG_SECONDS.labels(domain=snapshot.domain).set(
            snapshot.lag_seconds
        )


def _emit_alert(snapshot: ContractLagSnapshot) -> None:
    """Emit a structured log alert when lag exceeds a threshold."""
    if snapshot.severity in ("healthy", "missing"):
        if snapshot.severity == "missing":
            lag_logger.warning(
                "CONTRACT_LAG_MISSING domain=%s contract_id=%s details=%s",
                snapshot.domain,
                snapshot.contract_id,
                snapshot.details,
            )
        return

    record = {
        "alert_type": "contract_ingestion_lag",
        "domain": snapshot.domain,
        "contract_id": snapshot.contract_id,
        "lag_seconds": snapshot.lag_seconds,
        "severity": snapshot.severity,
        "warning_threshold_seconds": snapshot.warning_threshold_seconds,
        "critical_threshold_seconds": snapshot.critical_threshold_seconds,
        **snapshot.details,
    }
    if snapshot.severity == "critical":
        lag_logger.error("CONTRACT_LAG_ALERT %s", record)
    else:
        lag_logger.warning("CONTRACT_LAG_ALERT %s", record)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

DOMAINS = list(_DOMAIN_CONTRACT_DEFAULTS.keys())


def run_contract_lag_cycle(
    postgres: Optional[PostgresService] = None,
    domains: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Measure lag for all (or selected) contract domains.

    Creates its own ``PostgresService`` when none is supplied so the function
    works in both the scheduler context and standalone calls.

    Returns a summary dict that mirrors the shape of
    ``run_ingestion_alerting_cycle`` for consistency.
    """
    owns_service = False
    service = postgres
    if service is None:
        try:
            service = PostgresService()
            owns_service = True
        except Exception as exc:
            lag_logger.warning("contract_lag_cycle: cannot connect to DB: %s", exc)
            return {
                "checked_at": datetime.now(timezone.utc).isoformat(),
                "snapshots": [],
                "lag_alerts": [],
                "healthy": False,
                "error": str(exc),
            }

    target_domains = domains if domains is not None else DOMAINS
    snapshots: List[ContractLagSnapshot] = []
    lag_alerts: List[Dict[str, Any]] = []

    try:
        for domain in target_domains:
            snap = measure_contract_lag(domain, service)
            snapshots.append(snap)
            _publish_snapshot(snap)
            _emit_alert(snap)
            if snap.severity in ("warning", "critical"):
                lag_alerts.append(snap.to_dict())
    finally:
        if owns_service:
            service.engine.dispose()

    return {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "snapshots": [s.to_dict() for s in snapshots],
        "lag_alerts": lag_alerts,
        "healthy": len(lag_alerts) == 0,
    }
