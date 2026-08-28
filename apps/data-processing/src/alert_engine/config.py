from __future__ import annotations

import os
import logging
engine_logger = logging.getLogger("lumenpulse.alert_engine")
from typing import List, Optional, Dict, Any

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
  - type: alert_type
    name: "dedup_dataset_sla_breach"
    window_seconds: 300
    key_fields: ["dataset", "sla_type", "severity"]
    alert_types: ["dataset_sla_breach"]

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


def _validate_rule_config(cfg: Dict[str, Any]) -> bool:
    """Validate a single rule config dict.

    Returns ``True`` if the config contains the required fields for its type.
    Logs an error and returns ``False`` otherwise.
    """
    rule_type = cfg.get("type", "repeat_alert")
    required_fields = {
        "repeat_alert": ["name", "window_seconds", "key_fields"],
        "noisy_condition": ["name", "window_seconds", "key_fields", "rate_limit"],
        "severity_threshold": ["name", "window_seconds", "key_fields", "min_severity"],
        "alert_type": ["name", "window_seconds", "key_fields", "alert_types"],
    }
    fields = required_fields.get(rule_type, [])
    missing = [f for f in fields if f not in cfg]
    if missing:
        engine_logger.error(
            "Invalid rule configuration: missing %s fields for type %s (rule=%s)",
            ", ".join(missing),
            rule_type,
            cfg.get("name", "<unknown>"),
        )
        return False
    return True


def build_rules_from_config(configs: List[Dict[str, Any]]) -> List[SuppressionRule]:
    """Build suppression rules from a list of config dictionaries.

    Invalid rule configurations are logged and skipped, allowing valid rules to load.
    """
    rules: List[SuppressionRule] = []
    for cfg in configs:
        if not _validate_rule_config(cfg):
            continue
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
        AlertTypeRule(
            name="dedup_dataset_sla_breach",
            window_seconds=300,
            key_fields=["dataset", "sla_type", "severity"],
            alert_types=["dataset_sla_breach"],
        ),
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
