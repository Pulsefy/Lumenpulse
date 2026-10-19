from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from src.alert_engine.config import load_rules_from_yaml
from src.alert_engine.rule import SuppressionRule
from src.alert_engine.storage import SuppressionStore
from src.utils.logger import setup_logger

engine_logger = setup_logger("lumenpulse.alert_engine")


@dataclass
class SuppressionDecision:
    emit: bool
    rule_name: str
    dedup_key: str
    reason: str
    since_first_seen: Optional[float] = None
    suppress_count: int = 0
    emit_count: int = 0


class AlertSuppressionEngine:
    def __init__(
        self,
        rules: Optional[List[SuppressionRule]] = None,
        storage_path: Optional[str] = None,
        dry_run: bool = False,
    ):
        self._rules = rules if rules is not None else load_rules_from_yaml()
        # Use in‑memory store when dry_run is True
        store_path = None if dry_run else (storage_path or os.getenv(
            "ALERT_SUPPRESSION_STORE_PATH",
            "./data/alert_suppression.json",
        ))
        self._store = SuppressionStore(storage_path=store_path)
        self._suppressions_total = 0
        self._emissions_total = 0
        self._dry_run = dry_run

    def evaluate_dry_run(self, alerts: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Run a dry‑run evaluation against historical alerts.

        Returns the list of alerts that would be emitted, applying suppression
        and deduplication logic. The internal store is in‑memory only and not
        persisted.
        """
        # Create a temporary engine with the same rules but in‑memory store
        temp_engine = AlertSuppressionEngine(rules=self._rules, dry_run=True)
        return temp_engine.evaluate_batch(alerts)


    def evaluate(self, alert: Dict[str, Any]) -> SuppressionDecision:
        now = datetime.now(timezone.utc)
        for rule in self._rules:
            if not rule.matches(alert):
                continue

            dedup_key = rule.compute_key(alert)
            record = self._store.get(dedup_key)

            if rule.max_suppressions is not None:
                if record and record.suppress_count >= rule.max_suppressions:
                    self._emissions_total += 1
                    self._store.record_emitted(dedup_key, rule.name, alert)
                    engine_logger.info(
                        "ALERT_ENGINE emit(forced) key=%s rule=%s suppress_count=%d max=%d",
                        dedup_key, rule.name, record.suppress_count, rule.max_suppressions,
                    )
                    return SuppressionDecision(
                        emit=True,
                        rule_name=rule.name,
                        dedup_key=dedup_key,
                        reason=f"forced_emit_after_{rule.max_suppressions}_suppressions",
                        emit_count=record.emit_count + 1,
                        suppress_count=record.suppress_count,
                    )

            if record is None:
                self._emissions_total += 1
                self._store.record_emitted(dedup_key, rule.name, alert)
                engine_logger.info(
                    "ALERT_ENGINE emit(first) key=%s rule=%s",
                    dedup_key, rule.name,
                )
                return SuppressionDecision(
                    emit=True,
                    rule_name=rule.name,
                    dedup_key=dedup_key,
                    reason="first_occurrence",
                    emit_count=1,
                    suppress_count=0,
                )

            elapsed = (now - datetime.fromisoformat(record.last_attempt)).total_seconds()

            if elapsed >= rule.window_seconds:
                self._emissions_total += 1
                self._store.record_emitted(dedup_key, rule.name, alert)
                engine_logger.info(
                    "ALERT_ENGINE emit(repeat,window_expired) key=%s rule=%s elapsed=%.1fs window=%.1fs",
                    dedup_key, rule.name, elapsed, rule.window_seconds,
                )
                return SuppressionDecision(
                    emit=True,
                    rule_name=rule.name,
                    dedup_key=dedup_key,
                    reason="window_expired",
                    since_first_seen=elapsed,
                    emit_count=record.emit_count + 1,
                    suppress_count=record.suppress_count,
                )

            self._suppressions_total += 1
            self._store.record_suppressed(dedup_key, rule.name, alert)
            engine_logger.info(
                "ALERT_ENGINE suppress key=%s rule=%s elapsed=%.1fs window=%.1fs suppress_count=%d",
                dedup_key, rule.name, elapsed, rule.window_seconds, record.suppress_count + 1,
            )
            return SuppressionDecision(
                emit=False,
                rule_name=rule.name,
                dedup_key=dedup_key,
                reason="suppressed_within_window",
                since_first_seen=elapsed,
                emit_count=record.emit_count,
                suppress_count=record.suppress_count + 1,
            )

        self._emissions_total += 1
        return SuppressionDecision(
            emit=True,
            rule_name="no_rule_match",
            dedup_key="",
            reason="no_matching_rule",
        )

    def evaluate_batch(
        self, alerts: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        emitted: List[Dict[str, Any]] = []
        suppressed: List[Dict[str, Any]] = []

        for alert in alerts:
            decision = self.evaluate(alert)
            enriched = dict(alert)
            enriched["_suppression"] = {
                "dedup_key": decision.dedup_key,
                "rule_name": decision.rule_name,
                "reason": decision.reason,
            }
            if decision.emit:
                emitted.append(enriched)
            else:
                suppressed.append(enriched)

        if suppressed:
            engine_logger.warning(
                "ALERT_ENGINE batch: %d emitted, %d suppressed",
                len(emitted), len(suppressed),
            )

        return emitted

    @property
    def stats(self) -> Dict[str, Any]:
        return {
            "rules": [r.to_dict() for r in self._rules],
            "suppressions_total": self._suppressions_total,
            "emissions_total": self._emissions_total,
            "store_records": len(self._store.records),
        }

    @property
    def suppression_records(self) -> Dict[str, Any]:
        return {k: v.to_dict() for k, v in self._store.records.items()}

    def reload_rules(self, rules: Optional[List[SuppressionRule]] = None) -> None:
        self._rules = rules or load_rules_from_yaml()
        engine_logger.info("ALERT_ENGINE reloaded %d rules", len(self._rules))
