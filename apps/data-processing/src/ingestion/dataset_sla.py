"""Dataset-level ingestion SLA targets, metrics, and breach evaluation.

The freshness monitor measures source age, but operations need a stable SLA
contract per ingested dataset so alerts can judge whether the current value is
acceptable.  This module owns that contract and publishes both targets and
current measurements as Prometheus metrics.
"""

from __future__ import annotations

import math
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional

from src.utils.metrics import (
    DATASET_COMPLETENESS_RATIO,
    DATASET_COMPLETENESS_TARGET_RATIO,
    DATASET_FRESHNESS_SECONDS,
    DATASET_FRESHNESS_TARGET_SECONDS,
    DATASET_SLA_BREACH,
)


@dataclass(frozen=True)
class DatasetSLATarget:
    """Freshness and completeness target for one ingested dataset."""

    dataset: str
    owner: str
    description: str
    freshness_target_seconds: float
    completeness_target_ratio: float
    runbook_hint: str

    @property
    def env_prefix(self) -> str:
        return f"INGESTION_SLA_{self.dataset.upper()}"

    def resolved(self) -> "DatasetSLATarget":
        freshness = float(
            os.getenv(
                f"{self.env_prefix}_FRESHNESS_SECONDS",
                str(self.freshness_target_seconds),
            )
        )
        completeness = float(
            os.getenv(
                f"{self.env_prefix}_COMPLETENESS_RATIO",
                str(self.completeness_target_ratio),
            )
        )
        return DatasetSLATarget(
            dataset=self.dataset,
            owner=self.owner,
            description=self.description,
            freshness_target_seconds=freshness,
            completeness_target_ratio=completeness,
            runbook_hint=self.runbook_hint,
        )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "dataset": self.dataset,
            "owner": self.owner,
            "description": self.description,
            "freshness_target_seconds": self.freshness_target_seconds,
            "completeness_target_ratio": self.completeness_target_ratio,
            "runbook_hint": self.runbook_hint,
            "freshness_env": f"{self.env_prefix}_FRESHNESS_SECONDS",
            "completeness_env": f"{self.env_prefix}_COMPLETENESS_RATIO",
        }


DATASET_SLA_TARGETS: List[DatasetSLATarget] = [
    DatasetSLATarget(
        dataset="news_articles",
        owner="data-processing",
        description="Fetched and analyzed crypto news article records",
        freshness_target_seconds=3600.0,
        completeness_target_ratio=0.95,
        runbook_hint="INGESTION_ALERTING_RUNBOOK.md § Alert: News feed SLA breach",
    ),
    DatasetSLATarget(
        dataset="price_ticks",
        owner="data-processing",
        description="Latest asset price observations used by analytics",
        freshness_target_seconds=900.0,
        completeness_target_ratio=0.99,
        runbook_hint="INGESTION_ALERTING_RUNBOOK.md § Alert: Price feed SLA breach",
    ),
    DatasetSLATarget(
        dataset="social_posts",
        owner="data-processing",
        description="Social sentiment posts fetched from configured platforms",
        freshness_target_seconds=7200.0,
        completeness_target_ratio=0.90,
        runbook_hint="INGESTION_ALERTING_RUNBOOK.md § Alert: Social feed SLA breach",
    ),
    DatasetSLATarget(
        dataset="stellar_ledger_events",
        owner="data-processing",
        description="Latest Stellar ledger/event ingestion signal",
        freshness_target_seconds=300.0,
        completeness_target_ratio=0.999,
        runbook_hint="INGESTION_ALERTING_RUNBOOK.md § Alert: Stellar ledger SLA breach",
    ),
    DatasetSLATarget(
        dataset="contract_events",
        owner="data-processing",
        description="Raw and materialized Soroban contract event records",
        freshness_target_seconds=600.0,
        completeness_target_ratio=0.999,
        runbook_hint="INGESTION_ALERTING_RUNBOOK.md § Alert: Contract event SLA breach",
    ),
    DatasetSLATarget(
        dataset="analytics_records",
        owner="data-processing",
        description="Derived analytics records consumed by API and dashboards",
        freshness_target_seconds=7200.0,
        completeness_target_ratio=0.95,
        runbook_hint="INGESTION_ALERTING_RUNBOOK.md § Alert: Analytics dataset SLA breach",
    ),
]


@dataclass
class DatasetSLAMeasurement:
    """Current freshness and completeness for one dataset."""

    dataset: str
    freshness_seconds: Optional[float]
    completeness_ratio: Optional[float]
    checked_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    details: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "dataset": self.dataset,
            "freshness_seconds": self.freshness_seconds,
            "completeness_ratio": self.completeness_ratio,
            "checked_at": self.checked_at.isoformat(),
            "details": self.details,
        }


@dataclass
class DatasetSLABreach:
    """A judged SLA breach for one dataset and SLA dimension."""

    dataset: str
    sla_type: str
    severity: str
    current_value: Optional[float]
    target_value: float
    checked_at: datetime
    runbook_hint: str
    details: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "dataset": self.dataset,
            "sla_type": self.sla_type,
            "severity": self.severity,
            "current_value": self.current_value,
            "target_value": self.target_value,
            "checked_at": self.checked_at.isoformat(),
            "runbook_hint": self.runbook_hint,
            "details": self.details,
        }


def get_dataset_sla_targets() -> List[DatasetSLATarget]:
    """Return resolved SLA targets with environment overrides applied."""

    return [target.resolved() for target in DATASET_SLA_TARGETS]


def get_dataset_sla_target(dataset: str) -> DatasetSLATarget:
    """Return the resolved target for *dataset*."""

    for target in get_dataset_sla_targets():
        if target.dataset == dataset:
            return target
    raise KeyError(f"Unknown ingestion dataset SLA target: {dataset}")


def _finite(value: Optional[float]) -> bool:
    return value is not None and math.isfinite(value)


def publish_dataset_sla_metrics(
    measurements: Iterable[DatasetSLAMeasurement],
) -> None:
    """Publish SLA targets and current measurements to Prometheus."""

    targets = {target.dataset: target for target in get_dataset_sla_targets()}
    for target in targets.values():
        DATASET_FRESHNESS_TARGET_SECONDS.labels(dataset=target.dataset).set(
            target.freshness_target_seconds
        )
        DATASET_COMPLETENESS_TARGET_RATIO.labels(dataset=target.dataset).set(
            target.completeness_target_ratio
        )

    for measurement in measurements:
        target = targets.get(measurement.dataset)
        if target is None:
            continue

        freshness_value = (
            measurement.freshness_seconds
            if _finite(measurement.freshness_seconds)
            else -1.0
        )
        completeness_value = (
            measurement.completeness_ratio
            if _finite(measurement.completeness_ratio)
            else -1.0
        )

        DATASET_FRESHNESS_SECONDS.labels(dataset=measurement.dataset).set(
            freshness_value
        )
        DATASET_COMPLETENESS_RATIO.labels(dataset=measurement.dataset).set(
            completeness_value
        )

        freshness_breached = (
            not _finite(measurement.freshness_seconds)
            or float(measurement.freshness_seconds) > target.freshness_target_seconds
        )
        completeness_breached = (
            not _finite(measurement.completeness_ratio)
            or float(measurement.completeness_ratio) < target.completeness_target_ratio
        )

        DATASET_SLA_BREACH.labels(
            dataset=measurement.dataset,
            sla_type="freshness",
            severity="critical",
        ).set(1.0 if freshness_breached else 0.0)
        DATASET_SLA_BREACH.labels(
            dataset=measurement.dataset,
            sla_type="completeness",
            severity="critical",
        ).set(1.0 if completeness_breached else 0.0)


def evaluate_dataset_slas(
    measurements: Iterable[DatasetSLAMeasurement],
) -> List[DatasetSLABreach]:
    """Judge current dataset measurements against their SLA targets."""

    targets = {target.dataset: target for target in get_dataset_sla_targets()}
    breaches: List[DatasetSLABreach] = []
    measured = list(measurements)
    publish_dataset_sla_metrics(measured)

    for measurement in measured:
        target = targets.get(measurement.dataset)
        if target is None:
            continue

        if (
            not _finite(measurement.freshness_seconds)
            or float(measurement.freshness_seconds) > target.freshness_target_seconds
        ):
            breaches.append(
                DatasetSLABreach(
                    dataset=measurement.dataset,
                    sla_type="freshness",
                    severity="critical",
                    current_value=measurement.freshness_seconds,
                    target_value=target.freshness_target_seconds,
                    checked_at=measurement.checked_at,
                    runbook_hint=target.runbook_hint,
                    details=measurement.details,
                )
            )

        if (
            not _finite(measurement.completeness_ratio)
            or float(measurement.completeness_ratio) < target.completeness_target_ratio
        ):
            breaches.append(
                DatasetSLABreach(
                    dataset=measurement.dataset,
                    sla_type="completeness",
                    severity="critical",
                    current_value=measurement.completeness_ratio,
                    target_value=target.completeness_target_ratio,
                    checked_at=measurement.checked_at,
                    runbook_hint=target.runbook_hint,
                    details=measurement.details,
                )
            )

    return breaches
