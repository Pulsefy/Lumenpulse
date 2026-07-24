"""
Alert suppression and dedup rules engine.

Prevents alert spam by deduplicating repeated triggers and applying
suppression windows for noisy conditions.

Design:
- Every alert carries an *alert_key* (e.g. "anomaly:volume", "sentiment:high").
- The engine tracks the first-occurrence timestamp and last-emitted timestamp
  for each key.
- First-occurrence alerts are always emitted.
- Subsequent alerts are suppressed until the configurable window elapses.
- Every decision (emit / suppress) is logged with full metadata so the
  behaviour is fully explainable after the fact.

Configuration is loaded from environment variables so rules can be tuned
without code changes.  Per-key overrides are supported via a JSON mapping.

Environment variables
---------------------
ALERT_SUPPRESSION_ENABLED        – master switch (default: true)
ALERT_SUPPRESSION_DEFAULT_WINDOW – default suppression window in seconds (default: 300)
ALERT_SUPPRESSION_MAX_HISTORY    – max entries kept in memory (default: 10 000)
ALERT_SUPPRESSION_KEY_OVERRIDES  – JSON dict mapping key -> window_seconds,
                                   e.g. '{"anomaly:volume": 600}'
"""

from __future__ import annotations

import json
import os
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from src.utils.logger import setup_logger

logger = setup_logger(__name__)


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

@dataclass
class AlertSuppressionConfig:
    """Tunable suppression rules.  All values are in seconds unless noted."""

    enabled: bool = True
    default_window_seconds: int = 300
    max_history: int = 10_000
    key_overrides: Dict[str, int] = field(default_factory=dict)

    @classmethod
    def from_env(cls) -> AlertSuppressionConfig:
        """Build configuration from environment variables."""
        raw_overrides: Dict[str, int] = {}
        raw_json = os.getenv("ALERT_SUPPRESSION_KEY_OVERRIDES", "")
        if raw_json:
            try:
                parsed = json.loads(raw_json)
                raw_overrides = {k: int(v) for k, v in parsed.items()}
            except (json.JSONDecodeError, ValueError, TypeError):
                logger.warning(
                    "Failed to parse ALERT_SUPPRESSION_KEY_OVERRIDES – ignoring"
                )

        return cls(
            enabled=os.getenv("ALERT_SUPPRESSION_ENABLED", "true").lower() in ("1", "true", "yes"),
            default_window_seconds=int(os.getenv("ALERT_SUPPRESSION_DEFAULT_WINDOW", "300")),
            max_history=int(os.getenv("ALERT_SUPPRESSION_MAX_HISTORY", "10000")),
            key_overrides=raw_overrides,
        )


# ---------------------------------------------------------------------------
# Per-alert tracking record
# ---------------------------------------------------------------------------

@dataclass
class AlertRecord:
    """Tracks state for a single alert key."""

    key: str
    first_seen: float  # epoch seconds
    last_emitted: float  # epoch seconds
    last_suppressed: float = 0.0  # epoch seconds of most recent suppression
    emit_count: int = 1
    suppress_count: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "key": self.key,
            "first_seen": self.first_seen,
            "last_emitted": self.last_emitted,
            "last_suppressed": self.last_suppressed,
            "emit_count": self.emit_count,
            "suppress_count": self.suppress_count,
            "first_seen_iso": datetime.fromtimestamp(self.first_seen, tz=timezone.utc).isoformat(),
            "last_emitted_iso": datetime.fromtimestamp(self.last_emitted, tz=timezone.utc).isoformat(),
        }


# ---------------------------------------------------------------------------
# Decision result returned to callers
# ---------------------------------------------------------------------------

@dataclass
class SuppressionDecision:
    """Result of an should_emit() evaluation."""

    emitted: bool
    alert_key: str
    reason: str
    record: Optional[AlertRecord] = None

    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {
            "emitted": self.emitted,
            "alert_key": self.alert_key,
            "reason": self.reason,
        }
        if self.record:
            d["record"] = self.record.to_dict()
        return d


# ---------------------------------------------------------------------------
# Core engine
# ---------------------------------------------------------------------------

class AlertSuppressionEngine:
    """Thread-safe dedup and suppression window engine.

    Usage::

        engine = AlertSuppressionEngine()          # loads config from env
        decision = engine.evaluate("anomaly:volume")
        if decision.emitted:
            send_alert(...)
    """

    def __init__(self, config: Optional[AlertSuppressionConfig] = None):
        self._config = config or AlertSuppressionConfig.from_env()
        self._records: Dict[str, AlertRecord] = {}
        self._lock = threading.Lock()
        logger.info(
            "AlertSuppressionEngine initialised | enabled=%s default_window=%ds keys_overridden=%d",
            self._config.enabled,
            self._config.default_window_seconds,
            len(self._config.key_overrides),
        )

    # -- public API ---------------------------------------------------------

    def evaluate(self, alert_key: str) -> SuppressionDecision:
        """Decide whether *alert_key* should emit now.

        - First occurrence is always emitted.
        - Subsequent calls emit only after the suppression window elapses.
        - Every decision is logged with metadata for explainability.
        """
        if not self._config.enabled:
            return SuppressionDecision(
                emitted=True,
                alert_key=alert_key,
                reason="suppression_disabled",
            )

        now = time.time()
        window = self._window_for(alert_key)

        with self._lock:
            record = self._records.get(alert_key)

            if record is None:
                # First time we see this key – always emit.
                record = AlertRecord(
                    key=alert_key,
                    first_seen=now,
                    last_emitted=now,
                )
                self._records[alert_key] = record
                self._evict_if_needed()
                decision = SuppressionDecision(
                    emitted=True,
                    alert_key=alert_key,
                    reason="first_occurrence",
                    record=record,
                )
            else:
                elapsed = now - record.last_emitted
                if elapsed >= window:
                    record.last_emitted = now
                    record.emit_count += 1
                    decision = SuppressionDecision(
                        emitted=True,
                        alert_key=alert_key,
                        reason=f"window_elapsed ({elapsed:.0f}s >= {window}s)",
                        record=record,
                    )
                else:
                    record.last_suppressed = now
                    record.suppress_count += 1
                    remaining = window - elapsed
                    decision = SuppressionDecision(
                        emitted=False,
                        alert_key=alert_key,
                        reason=f"suppressed ({elapsed:.0f}s < {window}s, remaining {remaining:.0f}s)",
                        record=record,
                    )

        logger.info(
            "Alert suppression decision | key=%s emitted=%s reason=%s",
            decision.alert_key,
            decision.emitted,
            decision.reason,
        )
        return decision

    def get_record(self, alert_key: str) -> Optional[AlertRecord]:
        """Return the tracking record for *alert_key*, if any."""
        with self._lock:
            return self._records.get(alert_key)

    def get_all_records(self) -> Dict[str, AlertRecord]:
        """Return a snapshot of all tracked records (for API / debugging)."""
        with self._lock:
            return dict(self._records)

    def reset_key(self, alert_key: str) -> bool:
        """Remove tracking for *alert_key*. Returns True if it existed."""
        with self._lock:
            removed = self._records.pop(alert_key, None) is not None
            if removed:
                logger.info("Reset suppression record for key=%s", alert_key)
            return removed

    def reset_all(self) -> int:
        """Clear all records. Returns count of removed entries."""
        with self._lock:
            count = len(self._records)
            self._records.clear()
            logger.info("Reset all suppression records (%d removed)", count)
            return count

    def get_stats(self) -> Dict[str, Any]:
        """Aggregate statistics for monitoring."""
        with self._lock:
            total_emitted = sum(r.emit_count for r in self._records.values())
            total_suppressed = sum(r.suppress_count for r in self._records.values())
            return {
                "enabled": self._config.enabled,
                "default_window_seconds": self._config.default_window_seconds,
                "tracked_keys": len(self._records),
                "total_emitted": total_emitted,
                "total_suppressed": total_suppressed,
                "key_overrides": dict(self._config.key_overrides),
            }

    # -- private helpers ----------------------------------------------------

    def _window_for(self, alert_key: str) -> int:
        """Return the suppression window (seconds) for *alert_key*."""
        if alert_key in self._config.key_overrides:
            return self._config.key_overrides[alert_key]
        return self._config.default_window_seconds

    def _evict_if_needed(self) -> None:
        """Drop oldest entries when we exceed max_history (called under lock)."""
        if len(self._records) <= self._config.max_history:
            return
        # Sort by first_seen and drop the oldest entries
        sorted_keys = sorted(self._records, key=lambda k: self._records[k].first_seen)
        excess = len(self._records) - self._config.max_history
        for k in sorted_keys[:excess]:
            del self._records[k]
        logger.debug("Evicted %d oldest suppression records", excess)
