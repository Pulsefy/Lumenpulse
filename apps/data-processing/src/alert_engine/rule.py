from __future__ import annotations

import hashlib
import json
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class SuppressionRule(ABC):
    name: str
    window_seconds: float
    key_fields: List[str] = field(default_factory=lambda: ["alert_type", "metric_name"])
    max_suppressions: Optional[int] = None

    @abstractmethod
    def matches(self, alert: Dict[str, Any]) -> bool:
        ...

    def compute_key(self, alert: Dict[str, Any]) -> str:
        parts = [alert.get(f, "") for f in self.key_fields]
        raw = json.dumps(parts, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "window_seconds": self.window_seconds,
            "key_fields": list(self.key_fields),
            "max_suppressions": self.max_suppressions,
        }


@dataclass
class RepeatAlertRule(SuppressionRule):
    def matches(self, alert: Dict[str, Any]) -> bool:
        return True


@dataclass
class NoisyConditionRule(SuppressionRule):
    rate_limit: int = 5

    def matches(self, alert: Dict[str, Any]) -> bool:
        return True

    def to_dict(self) -> Dict[str, Any]:
        base = super().to_dict()
        base["rate_limit"] = self.rate_limit
        return base


@dataclass
class SeverityThresholdRule(SuppressionRule):
    min_severity: str = "warning"

    def matches(self, alert: Dict[str, Any]) -> bool:
        severity = alert.get("severity", "").lower()
        order = {"healthy": 0, "info": 1, "warning": 2, "critical": 3}
        min_order = order.get(self.min_severity, 2)
        return order.get(severity, 0) < min_order

    def to_dict(self) -> Dict[str, Any]:
        base = super().to_dict()
        base["min_severity"] = self.min_severity
        return base


@dataclass
class AlertTypeRule(SuppressionRule):
    alert_types: List[str] = field(default_factory=list)

    def matches(self, alert: Dict[str, Any]) -> bool:
        return alert.get("alert_type", "") in self.alert_types

    def to_dict(self) -> Dict[str, Any]:
        base = super().to_dict()
        base["alert_types"] = list(self.alert_types)
        return base


def build_rules_from_config(configs: List[Dict[str, Any]]) -> List[SuppressionRule]:
    rules: List[SuppressionRule] = []
    for cfg in configs:
        rule_type = cfg.get("type", "repeat_alert")
        params = {k: v for k, v in cfg.items() if k != "type"}
        if rule_type == "repeat_alert":
            rules.append(RepeatAlertRule(**params))
        elif rule_type == "noisy_condition":
            rules.append(NoisyConditionRule(**params))
        elif rule_type == "severity_threshold":
            rules.append(SeverityThresholdRule(**params))
        elif rule_type == "alert_type":
            rules.append(AlertTypeRule(**params))
    return rules
