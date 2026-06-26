"""
Project Verification Trend Analyzer (#885)

Tracks and analyzes trends in Soroban/Stellar project verification
statuses over time, surfacing approval rates, rejection spikes, and
momentum shifts across verification windows.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Domain types
# ---------------------------------------------------------------------------

VerificationStatus = str  # "approved" | "rejected" | "pending"


@dataclass
class VerificationRecord:
    """A single project-verification event."""

    project_id: str
    status: VerificationStatus
    timestamp: datetime

    def to_dict(self) -> Dict:
        return {
            "project_id": self.project_id,
            "status": self.status,
            "timestamp": self.timestamp.isoformat(),
        }


@dataclass
class VerificationTrendResult:
    """Aggregated trend output for one analysis window."""

    window_start: datetime
    window_end: datetime
    total: int
    approved: int
    rejected: int
    pending: int
    approval_rate: float  # 0.0–1.0
    rejection_rate: float  # 0.0–1.0
    trend_direction: str   # "improving" | "declining" | "stable"
    previous_approval_rate: Optional[float] = None
    delta: Optional[float] = None  # current – previous approval_rate

    def to_dict(self) -> Dict:
        return {
            "window_start": self.window_start.isoformat(),
            "window_end": self.window_end.isoformat(),
            "total": self.total,
            "approved": self.approved,
            "rejected": self.rejected,
            "pending": self.pending,
            "approval_rate": round(self.approval_rate, 4),
            "rejection_rate": round(self.rejection_rate, 4),
            "trend_direction": self.trend_direction,
            "previous_approval_rate": (
                round(self.previous_approval_rate, 4)
                if self.previous_approval_rate is not None
                else None
            ),
            "delta": round(self.delta, 4) if self.delta is not None else None,
        }


# ---------------------------------------------------------------------------
# Analyzer
# ---------------------------------------------------------------------------


class ProjectVerificationTrendAnalyzer:
    """
    Analyzes trends in project-verification outcomes.

    Usage
    -----
    analyzer = ProjectVerificationTrendAnalyzer()
    analyzer.ingest(records)          # add VerificationRecord objects
    result = analyzer.analyze()       # VerificationTrendResult
    """

    # Threshold (absolute change in approval_rate) for direction classification
    STABILITY_THRESHOLD: float = 0.02

    def __init__(self) -> None:
        self._records: List[VerificationRecord] = []
        self._previous_result: Optional[VerificationTrendResult] = None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def ingest(self, records: List[VerificationRecord]) -> None:
        """Add verification records to the analyzer."""
        self._records.extend(records)
        logger.debug("Ingested %d records (total=%d)", len(records), len(self._records))

    def clear(self) -> None:
        """Reset all buffered records (call between windows if needed)."""
        self._records = []

    def analyze(self) -> VerificationTrendResult:
        """
        Compute trend metrics over the current record buffer.

        Returns
        -------
        VerificationTrendResult
        """
        if not self._records:
            now = datetime.now(timezone.utc)
            return VerificationTrendResult(
                window_start=now,
                window_end=now,
                total=0,
                approved=0,
                rejected=0,
                pending=0,
                approval_rate=0.0,
                rejection_rate=0.0,
                trend_direction="stable",
            )

        timestamps = [r.timestamp for r in self._records]
        window_start = min(timestamps)
        window_end = max(timestamps)

        counts: Dict[str, int] = {"approved": 0, "rejected": 0, "pending": 0}
        for r in self._records:
            status = r.status.lower()
            if status in counts:
                counts[status] += 1
            else:
                counts["pending"] += 1  # treat unknown as pending

        total = len(self._records)
        approval_rate = counts["approved"] / total
        rejection_rate = counts["rejected"] / total

        # Compare to the previous window
        prev_rate = (
            self._previous_result.approval_rate
            if self._previous_result is not None
            else None
        )
        delta = (approval_rate - prev_rate) if prev_rate is not None else None
        direction = self._classify_direction(delta)

        result = VerificationTrendResult(
            window_start=window_start,
            window_end=window_end,
            total=total,
            approved=counts["approved"],
            rejected=counts["rejected"],
            pending=counts["pending"],
            approval_rate=approval_rate,
            rejection_rate=rejection_rate,
            trend_direction=direction,
            previous_approval_rate=prev_rate,
            delta=delta,
        )

        logger.info(
            "Verification trend: %s | approval=%.1f%% | total=%d",
            direction,
            approval_rate * 100,
            total,
        )

        self._previous_result = result
        return result

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _classify_direction(self, delta: Optional[float]) -> str:
        if delta is None:
            return "stable"
        if delta > self.STABILITY_THRESHOLD:
            return "improving"
        if delta < -self.STABILITY_THRESHOLD:
            return "declining"
        return "stable"
