"""Contract-specific ingestion lag tracking and metrics.

This module tracks ingestion lag for specific Soroban contract domains,
enabling maintainers to identify which ingestion paths are behind schedule.

Supported contract domains:
- registry: Project registry contract
- vault: Treasury vault contract
- matching_pool: Grant matching pool contract
- treasury: Treasury management contract
- vesting: Vesting wallet contract

Metrics are exposed in Prometheus format and can be queried via /metrics endpoint.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, Optional

from sqlalchemy import func, select
from prometheus_client import Gauge, Counter

from src.db.models import ContractEvent
from src.db.postgres_service import PostgresService
from src.utils.logger import setup_logger
from src.utils.metrics import INDEXER_LAG_SECONDS

logger = setup_logger(__name__)

# Contract domain types
CONTRACT_DOMAINS = ("registry", "vault", "matching_pool", "treasury", "vesting")

# Prometheus metrics for contract-specific lag
CONTRACT_LAG_SECONDS = Gauge(
    "lumenpulse_contract_lag_seconds",
    "Ingestion lag in seconds per contract domain",
    ["contract_domain", "environment"],
)

CONTRACT_EVENTS_PROCESSED_TOTAL = Counter(
    "lumenpulse_contract_events_processed_total",
    "Total contract events processed by domain",
    ["contract_domain", "status"],
)

CONTRACT_INGESTION_FAILURES_TOTAL = Counter(
    "lumenpulse_contract_ingestion_failures_total",
    "Total contract ingestion failures by domain",
    ["contract_domain", "failure_type"],
)

CONTRACT_LEDGER_HEIGHT = Gauge(
    "lumenpulse_contract_last_ledger",
    "Last processed ledger height per contract domain",
    ["contract_domain"],
)


class AlertSeverity(str, Enum):
    """Alert severity levels for contract lag."""
    HEALTHY = "healthy"
    WARNING = "warning"
    CRITICAL = "critical"


@dataclass
class ContractLagSnapshot:
    """Snapshot of lag metrics for a single contract domain."""
    
    contract_domain: str
    lag_seconds: float
    severity: AlertSeverity
    warning_threshold_seconds: float
    critical_threshold_seconds: float
    last_processed_ledger: int
    last_processed_timestamp: Optional[datetime]
    event_count: int
    details: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization."""
        return {
            "contract_domain": self.contract_domain,
            "lag_seconds": self.lag_seconds,
            "severity": self.severity.value,
            "warning_threshold_seconds": self.warning_threshold_seconds,
            "critical_threshold_seconds": self.critical_threshold_seconds,
            "last_processed_ledger": self.last_processed_ledger,
            "last_processed_timestamp": (
                self.last_processed_timestamp.isoformat()
                if self.last_processed_timestamp else None
            ),
            "event_count": self.event_count,
            "details": self.details,
        }


def _contract_to_domain_mapping() -> Dict[str, str]:
    """Map contract addresses to domain types from environment."""
    return {
        os.getenv("CONTRACT_REGISTRY", ""): "registry",
        os.getenv("CONTRACT_VAULT", ""): "vault",
        os.getenv("CONTRACT_MATCHING_POOL", ""): "matching_pool",
        os.getenv("CONTRACT_TREASURY", ""): "treasury",
        os.getenv("CONTRACT_VESTING", ""): "vesting",
    }


def _get_domain_for_contract(contract_id: str) -> Optional[str]:
    """Identify contract domain from contract ID."""
    mapping = _contract_to_domain_mapping()
    return mapping.get(contract_id)


def _get_default_thresholds(domain: str) -> Dict[str, float]:
    """Get default alert thresholds for a contract domain.
    
    Default thresholds (seconds):
    - Registry: 5 minutes warning, 15 minutes critical
    - Vault: 10 minutes warning, 30 minutes critical
    - Matching Pool: 5 minutes warning, 20 minutes critical
    - Treasury: 10 minutes warning, 30 minutes critical
    - Vesting: 15 minutes warning, 45 minutes critical
    """
    defaults = {
        "registry": {"warning": 300.0, "critical": 900.0},
        "vault": {"warning": 600.0, "critical": 1800.0},
        "matching_pool": {"warning": 300.0, "critical": 1200.0},
        "treasury": {"warning": 600.0, "critical": 1800.0},
        "vesting": {"warning": 900.0, "critical": 2700.0},
    }
    return defaults.get(domain, {"warning": 600.0, "critical": 1800.0})


def _get_thresholds(domain: str) -> Dict[str, float]:
    """Get alert thresholds for a contract domain with environment override.
    
    Thresholds can be overridden via environment variables:
    - {DOMAIN_UPPERCASE}_LAG_WARNING_SECONDS
    - {DOMAIN_UPPERCASE}_LAG_CRITICAL_SECONDS
    """
    defaults = _get_default_thresholds(domain)
    prefix = domain.upper()
    
    return {
        "warning": float(
            os.getenv(f"{prefix}_LAG_WARNING_SECONDS", defaults["warning"])
        ),
        "critical": float(
            os.getenv(f"{prefix}_LAG_CRITICAL_SECONDS", defaults["critical"])
        ),
    }


def _severity_for_lag(lag_seconds: float, domain: str) -> AlertSeverity:
    """Determine alert severity based on lag and thresholds."""
    thresholds = _get_thresholds(domain)
    
    if lag_seconds >= thresholds["critical"]:
        return AlertSeverity.CRITICAL
    if lag_seconds >= thresholds["warning"]:
        return AlertSeverity.WARNING
    return AlertSeverity.HEALTHY


def _publish_lag_metric(snapshot: ContractLagSnapshot, environment: str = "local") -> None:
    """Publish lag metrics to Prometheus."""
    CONTRACT_LAG_SECONDS.labels(
        contract_domain=snapshot.contract_domain,
        environment=environment,
    ).set(snapshot.lag_seconds)
    
    CONTRACT_LEDGER_HEIGHT.labels(
        contract_domain=snapshot.contract_domain,
    ).set(snapshot.last_processed_ledger)


async def measure_contract_lag(
    db_service: PostgresService,
    domain: str,
) -> Optional[ContractLagSnapshot]:
    """Measure ingestion lag for a specific contract domain.
    
    Args:
        db_service: Database service for querying events
        domain: Contract domain name (registry, vault, etc.)
    
    Returns:
        ContractLagSnapshot with lag metrics, or None if no events found
    """
    try:
        # Get the contract ID from environment
        contract_env_key = f"CONTRACT_{domain.upper()}"
        contract_id = os.getenv(contract_env_key)
        
        if not contract_id:
            logger.warning(
                f"Contract ID not configured for domain {domain} "
                f"(env var: {contract_env_key})"
            )
            return None
        
        # Query the latest event for this contract
        async with db_service.async_session() as session:
            stmt = (
                select(ContractEvent)
                .where(ContractEvent.contract_id == contract_id)
                .order_by(ContractEvent.ledger.desc())
                .limit(1)
            )
            
            result = await session.execute(stmt)
            latest_event = result.scalar_one_or_none()
            
            if not latest_event:
                logger.warning(
                    f"No events found for contract domain {domain} "
                    f"(contract_id: {contract_id})"
                )
                return None
            
            # Calculate lag
            now = datetime.now(timezone.utc)
            event_time = (
                latest_event.timestamp.replace(tzinfo=timezone.utc)
                if latest_event.timestamp else now
            )
            lag_seconds = (now - event_time).total_seconds()
            
            # Count total events
            stmt_count = select(func.count()).select_from(ContractEvent).where(
                ContractEvent.contract_id == contract_id
            )
            result_count = await session.execute(stmt_count)
            event_count = result_count.scalar() or 0
            
            # Create snapshot
            thresholds = _get_thresholds(domain)
            severity = _severity_for_lag(lag_seconds, domain)
            
            snapshot = ContractLagSnapshot(
                contract_domain=domain,
                lag_seconds=lag_seconds,
                severity=severity,
                warning_threshold_seconds=thresholds["warning"],
                critical_threshold_seconds=thresholds["critical"],
                last_processed_ledger=latest_event.ledger or 0,
                last_processed_timestamp=latest_event.timestamp,
                event_count=event_count,
                details={
                    "contract_id": contract_id,
                    "latest_event_id": latest_event.event_id,
                    "latest_event_type": latest_event.event_type,
                },
            )
            
            return snapshot
            
    except Exception as e:
        logger.error(f"Error measuring lag for domain {domain}: {e}")
        CONTRACT_INGESTION_FAILURES_TOTAL.labels(
            contract_domain=domain,
            failure_type=type(e).__name__,
        ).inc()
        return None


async def measure_all_contract_lags(
    db_service: PostgresService,
) -> Dict[str, Optional[ContractLagSnapshot]]:
    """Measure ingestion lag for all supported contract domains.
    
    Args:
        db_service: Database service for querying events
    
    Returns:
        Dictionary mapping domain names to lag snapshots
    """
    results = {}
    
    for domain in CONTRACT_DOMAINS:
        snapshot = await measure_contract_lag(db_service, domain)
        results[domain] = snapshot
        
        if snapshot:
            _publish_lag_metric(snapshot)
            
            log_message = (
                f"Contract lag: domain={snapshot.contract_domain}, "
                f"lag={snapshot.lag_seconds:.1f}s, "
                f"severity={snapshot.severity.value}, "
                f"ledger={snapshot.last_processed_ledger}, "
                f"events={snapshot.event_count}"
            )
            
            if snapshot.severity == AlertSeverity.CRITICAL:
                logger.error(log_message)
            elif snapshot.severity == AlertSeverity.WARNING:
                logger.warning(log_message)
            else:
                logger.debug(log_message)
    
    return results


async def run_contract_lag_cycle(
    db_service: PostgresService,
) -> None:
    """Run a full contract lag measurement cycle.
    
    This should be called periodically (e.g., every 30-60 seconds) by a scheduler.
    
    Args:
        db_service: Database service for querying events
    """
    logger.info("Starting contract lag measurement cycle")
    
    try:
        results = await measure_all_contract_lags(db_service)
        
        # Log summary
        critical_domains = [
            d for d, s in results.items()
            if s and s.severity == AlertSeverity.CRITICAL
        ]
        warning_domains = [
            d for d, s in results.items()
            if s and s.severity == AlertSeverity.WARNING
        ]
        
        if critical_domains:
            logger.error(
                f"Contract ingestion alerts - CRITICAL domains: {critical_domains}"
            )
        if warning_domains:
            logger.warning(
                f"Contract ingestion alerts - WARNING domains: {warning_domains}"
            )
        
        logger.info("Contract lag measurement cycle completed")
        
    except Exception as e:
        logger.error(f"Error in contract lag cycle: {e}", exc_info=True)


def record_contract_event_processed(
    domain: str,
    status: str = "success",
) -> None:
    """Record that a contract event was processed.
    
    Args:
        domain: Contract domain name
        status: Processing status (success, failure, skipped, etc.)
    """
    CONTRACT_EVENTS_PROCESSED_TOTAL.labels(
        contract_domain=domain,
        status=status,
    ).inc()


def get_all_contract_domains() -> tuple:
    """Get list of all supported contract domains."""
    return CONTRACT_DOMAINS


def get_contract_domain_config() -> Dict[str, Dict[str, Any]]:
    """Get configuration for all contract domains.
    
    Useful for local and hosted environments to understand what's configured.
    
    Returns:
        Dictionary with domain config including thresholds and contract IDs
    """
    config = {}
    
    for domain in CONTRACT_DOMAINS:
        contract_env_key = f"CONTRACT_{domain.upper()}"
        contract_id = os.getenv(contract_env_key)
        thresholds = _get_thresholds(domain)
        
        config[domain] = {
            "contract_id": contract_id,
            "configured": bool(contract_id),
            "warning_threshold_seconds": thresholds["warning"],
            "critical_threshold_seconds": thresholds["critical"],
        }
    
    return config
