from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

from src.alert_engine.rule import (
    AlertTypeRule,
    NoisyConditionRule,
    RepeatAlertRule,
    SeverityThresholdRule,
    SuppressionRule,
    build_rules_from_config,
)

DEFAULT_RULES_YAML = """
suppression_rules:
  - type: repeat_alert
    name: "dedup_indexer_lag"
    window_seconds: 300
    key_fields: ["metric_name", "source", "severity"]

  - type: repeat_alert
    name: "dedup_source_failures"
    window_seconds: 60
    key_fields: ["source", "failure_type"]

  - type: noisy_condition
    name: "rate_limit_source_failures"
    window_seconds: 300
    key_fields: ["source", "alert_type"]
    rate_limit: 10
    max_suppressions: 50

  - type: severity_threshold
    name: "suppress_healthy_alerts"
    window_seconds: 0
    key_fields: ["alert_type"]
    min_severity: "warning"

  - type: alert_type
    name: "dedup_contract_lag"
    window_seconds: 300
    key_fields: ["domain", "severity"]
    alert_types: ["contract_lag"]
"""


def load_rules_from_yaml(filepath: Optional[str] = None) -> List[SuppressionRule]:
    try:
        import yaml
    except ImportError:
        return load_rules_from_env()

    filepath = filepath or os.getenv(
        "ALERT_RULES_PATH",
        os.path.join(os.path.dirname(__file__), "..", "..", "config", "alert_rules.yaml"),
    )

    if filepath and os.path.exists(filepath):
        with open(filepath, "r") as f:
            data = yaml.safe_load(f)
        if data and "suppression_rules" in data:
            return build_rules_from_config(data["suppression_rules"])

    import json
    env_rules = os.getenv("ALERT_RULES_JSON")
    if env_rules:
        try:
            data = json.loads(env_rules)
            if isinstance(data, list):
                return build_rules_from_config(data)
        except (json.JSONDecodeError, TypeError):
            pass

    return _default_rules()


def load_rules_from_env() -> List[SuppressionRule]:
    rules: List[SuppressionRule] = []

    window = float(os.getenv("ALERT_DEDUP_WINDOW_SECONDS", "300"))
    rules.append(RepeatAlertRule(
        name="dedup_all",
        window_seconds=window,
        key_fields=["alert_type", "metric_name", "severity"],
    ))

    return rules


def _default_rules() -> List[SuppressionRule]:
    return [
        RepeatAlertRule(
            name="dedup_indexer_lag",
            window_seconds=300,
            key_fields=["metric_name", "source", "severity"],
        ),
        RepeatAlertRule(
            name="dedup_source_failures",
            window_seconds=60,
            key_fields=["source", "failure_type"],
        ),
        NoisyConditionRule(
            name="rate_limit_source_failures",
            window_seconds=300,
            key_fields=["source", "alert_type"],
            rate_limit=10,
            max_suppressions=50,
        ),
        SeverityThresholdRule(
            name="suppress_healthy_alerts",
            window_seconds=0,
            key_fields=["alert_type"],
            min_severity="warning",
        ),
        AlertTypeRule(
            name="dedup_contract_lag",
            window_seconds=300,
            key_fields=["domain", "severity"],
            alert_types=["contract_lag"],
        ),
    ]
