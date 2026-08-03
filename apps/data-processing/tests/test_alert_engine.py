"""Tests for the alert suppression and dedup rules engine (#1058)."""

from __future__ import annotations

import json
import os
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

import pytest

from src.alert_engine.engine import AlertSuppressionEngine, SuppressionDecision
from src.alert_engine.rule import (
    AlertTypeRule,
    NoisyConditionRule,
    RepeatAlertRule,
    SeverityThresholdRule,
    SuppressionRule,
    build_rules_from_config,
)
from src.alert_engine.storage import SuppressionRecord, SuppressionStore


# ── Rule Tests ───────────────────────────────────────────────────────


class TestRepeatAlertRule:
    def test_matches_anything(self):
        rule = RepeatAlertRule(name="test", window_seconds=300)
        assert rule.matches({"alert_type": "foo"}) is True
        assert rule.matches({}) is True

    def test_compute_key_uses_key_fields(self):
        rule = RepeatAlertRule(
            name="test",
            window_seconds=300,
            key_fields=["alert_type", "source"],
        )
        key1 = rule.compute_key({"alert_type": "lag", "source": "horizon"})
        key2 = rule.compute_key({"alert_type": "lag", "source": "horizon"})
        key3 = rule.compute_key({"alert_type": "lag", "source": "other"})
        assert key1 == key2
        assert key1 != key3

    def test_compute_key_deterministic(self):
        rule = RepeatAlertRule(name="test", window_seconds=300)
        a = rule.compute_key({"alert_type": "x", "severity": "critical"})
        b = rule.compute_key({"severity": "critical", "alert_type": "x"})
        assert a == b


class TestNoisyConditionRule:
    def test_matches_anything(self):
        rule = NoisyConditionRule(name="test", window_seconds=300, rate_limit=5)
        assert rule.matches({"x": 1}) is True

    def test_to_dict_includes_rate_limit(self):
        rule = NoisyConditionRule(name="test", window_seconds=300, rate_limit=5)
        d = rule.to_dict()
        assert d["rate_limit"] == 5


class TestSeverityThresholdRule:
    def test_suppresses_low_severity(self):
        rule = SeverityThresholdRule(
            name="test", window_seconds=0, min_severity="warning"
        )
        assert rule.matches({"severity": "healthy"}) is True
        assert rule.matches({"severity": "info"}) is True
        assert rule.matches({"severity": "warning"}) is False
        assert rule.matches({"severity": "critical"}) is False

    def test_default_min_severity(self):
        rule = SeverityThresholdRule(name="test", window_seconds=0)
        assert rule.min_severity == "warning"


class TestAlertTypeRule:
    def test_matches_specific_types(self):
        rule = AlertTypeRule(
            name="test",
            window_seconds=300,
            alert_types=["indexer_lag", "contract_lag"],
        )
        assert rule.matches({"alert_type": "indexer_lag"}) is True
        assert rule.matches({"alert_type": "contract_lag"}) is True
        assert rule.matches({"alert_type": "source_failure"}) is False


class TestBuildRulesFromConfig:
    def test_builds_all_rule_types(self):
        configs = [
            {"type": "repeat_alert", "name": "r1", "window_seconds": 60},
            {
                "type": "noisy_condition",
                "name": "r2",
                "window_seconds": 300,
                "rate_limit": 10,
            },
            {
                "type": "severity_threshold",
                "name": "r3",
                "window_seconds": 0,
                "min_severity": "warning",
            },
            {
                "type": "alert_type",
                "name": "r4",
                "window_seconds": 60,
                "alert_types": ["foo"],
            },
        ]
        rules = build_rules_from_config(configs)
        assert len(rules) == 4
        assert isinstance(rules[0], RepeatAlertRule)
        assert isinstance(rules[1], NoisyConditionRule)
        assert isinstance(rules[2], SeverityThresholdRule)
        assert isinstance(rules[3], AlertTypeRule)


# ── SuppressionStore Tests ───────────────────────────────────────────


class TestSuppressionStore:
    @pytest.fixture
    def store(self, tmp_path: Path):
        path = str(tmp_path / "test_suppression.json")
        return SuppressionStore(storage_path=path)

    def test_record_emitted_creates_entry(self, store: SuppressionStore):
        rec = store.record_emitted("key1", "rule1", {"alert_type": "test"})
        assert rec.dedup_key == "key1"
        assert rec.rule_name == "rule1"
        assert rec.emit_count == 1
        assert rec.suppress_count == 0

    def test_record_suppressed_increments_count(self, store: SuppressionStore):
        store.record_emitted("key1", "rule1", {"alert_type": "test"})
        rec = store.record_suppressed("key1", "rule1", {"alert_type": "test"})
        assert rec.emit_count == 1
        assert rec.suppress_count == 1

    def test_get_returns_none_for_unknown(self, store: SuppressionStore):
        assert store.get("nonexistent") is None

    def test_get_returns_record(self, store: SuppressionStore):
        store.record_emitted("key1", "rule1", {"alert_type": "test"})
        rec = store.get("key1")
        assert rec is not None
        assert rec.emit_count == 1

    def test_clear_removes_all(self, store: SuppressionStore):
        store.record_emitted("key1", "rule1", {"alert_type": "test"})
        store.clear()
        assert store.get("key1") is None

    def test_persistence_across_reload(self, tmp_path: Path):
        path = str(tmp_path / "persist.json")
        store1 = SuppressionStore(storage_path=path)
        store1.record_emitted("k", "r", {"a": 1})
        del store1

        store2 = SuppressionStore(storage_path=path)
        rec = store2.get("k")
        assert rec is not None
        assert rec.emit_count == 1
        assert rec.rule_name == "r"


# ── AlertSuppressionEngine Tests ─────────────────────────────────────


class TestAlertSuppressionEngine:
    @pytest.fixture
    def engine(self, tmp_path: Path):
        path = str(tmp_path / "engine_store.json")
        rules = [
            RepeatAlertRule(
                name="dedup_test",
                window_seconds=300,
                key_fields=["alert_type", "metric_name", "severity"],
            ),
        ]
        return AlertSuppressionEngine(rules=rules, storage_path=path)

    def test_first_occurrence_is_emitted(self, engine: AlertSuppressionEngine):
        decision = engine.evaluate({
            "alert_type": "indexer_lag",
            "metric_name": "stellar_ledger_lag",
            "severity": "critical",
        })
        assert decision.emit is True
        assert decision.reason == "first_occurrence"

    def test_repeat_within_window_is_suppressed(self, engine: AlertSuppressionEngine):
        alert = {
            "alert_type": "indexer_lag",
            "metric_name": "stellar_ledger_lag",
            "severity": "critical",
        }
        first = engine.evaluate(alert)
        assert first.emit is True

        second = engine.evaluate(alert)
        assert second.emit is False
        assert second.reason == "suppressed_within_window"

    def test_repeat_after_window_expired_is_emitted(self, engine: AlertSuppressionEngine):
        alert = {
            "alert_type": "indexer_lag",
            "metric_name": "stellar_ledger_lag",
            "severity": "critical",
        }
        engine.evaluate(alert)

        import time
        time.sleep(0.01)
        engine._store._records.clear()
        engine._store.record_emitted(
            engine._rules[0].compute_key(alert),
            engine._rules[0].name,
            alert,
        )
        record = engine._store.get(engine._rules[0].compute_key(alert))
        record.last_attempt = (
            datetime.now(timezone.utc) - timedelta(seconds=301)
        ).isoformat()

        decision = engine.evaluate(alert)

        assert decision.emit is True
        assert decision.reason == "window_expired"

    def test_no_matching_rule_always_emits(self, tmp_path: Path):
        engine = AlertSuppressionEngine(rules=[], storage_path=str(tmp_path / "no_rules.json"))
        decision = engine.evaluate({"alert_type": "anything"})
        assert decision.emit is True
        assert decision.reason == "no_matching_rule"

    def test_max_suppressions_forces_emit(self, tmp_path: Path):
        path = str(tmp_path / "max_supp.json")
        rules = [
            RepeatAlertRule(
                name="dedup_test",
                window_seconds=3600,
                key_fields=["alert_type"],
                max_suppressions=2,
            ),
        ]
        engine = AlertSuppressionEngine(rules=rules, storage_path=path)
        alert = {"alert_type": "test"}

        first = engine.evaluate(alert)
        assert first.emit is True
        assert first.reason == "first_occurrence"

        second = engine.evaluate(alert)
        assert second.emit is False
        assert second.reason == "suppressed_within_window"

        third = engine.evaluate(alert)
        assert third.emit is False
        assert third.reason == "suppressed_within_window"

        fourth = engine.evaluate(alert)
        assert fourth.emit is True
        assert fourth.reason.startswith("forced_emit")

    def test_evaluate_batch_returns_only_emitted(self, engine: AlertSuppressionEngine):
        alerts = [
            {"alert_type": "lag", "metric_name": "m1", "severity": "critical"},
            {"alert_type": "lag", "metric_name": "m1", "severity": "critical"},
            {"alert_type": "lag", "metric_name": "m2", "severity": "warning"},
        ]
        emitted = engine.evaluate_batch(alerts)
        assert len(emitted) == 2
        for e in emitted:
            assert e["_suppression"]["reason"] in ("first_occurrence", "no_matching_rule")

    def test_stats(self, engine: AlertSuppressionEngine):
        engine.evaluate({"alert_type": "x", "severity": "critical"})
        engine.evaluate({"alert_type": "x", "severity": "critical"})
        stats = engine.stats
        assert stats["emissions_total"] >= 1
        assert stats["suppressions_total"] >= 1
        assert len(stats["rules"]) == 1

    def test_suppression_records(self, engine: AlertSuppressionEngine):
        engine.evaluate({"alert_type": "x", "metric_name": "m", "severity": "critical"})
        recs = engine.suppression_records
        assert len(recs) == 1
        key = list(recs.keys())[0]
        assert recs[key]["emit_count"] == 1

    def test_reload_rules(self, engine: AlertSuppressionEngine):
        new_rules = [
            RepeatAlertRule(name="new_rule", window_seconds=600, key_fields=["alert_type"]),
        ]
        engine.reload_rules(new_rules)
        assert len(engine._rules) == 1
        assert engine._rules[0].name == "new_rule"


# ── Integration: suppression_engine with ingestion_alerting ──────────


class TestIngestionAlertingIntegration:
    def test_suppression_logged_in_cycle_result(self, tmp_path: Path):
        from src.ingestion.ingestion_alerting import (
            evaluate_lag_alerts,
            get_suppression_engine,
            reset_suppression_engine,
        )
        from src.ingestion.ingestion_alerting import LagMetricSnapshot, AlertSeverity

        reset_suppression_engine()
        path = str(tmp_path / "integration_store.json")

        import os
        with patch.dict(os.environ, {"ALERT_SUPPRESSION_STORE_PATH": path}):
            engine = get_suppression_engine()
            engine._store.clear()

            metrics = [
                LagMetricSnapshot(
                    metric_name="test_metric",
                    source="test_source",
                    lag_seconds=500.0,
                    severity=AlertSeverity.CRITICAL,
                    warning_threshold_seconds=60.0,
                    critical_threshold_seconds=300.0,
                    details={},
                ),
            ]

            first = evaluate_lag_alerts(metrics)
            assert len(first) == 1

            second = evaluate_lag_alerts(metrics)
            assert len(second) == 0

            engine = get_suppression_engine()
            recs = engine.suppression_records
            assert len(recs) > 0


# ── config loading tests ─────────────────────────────────────────────


class TestConfigLoading:
    def test_default_rules_loaded(self):
        from src.alert_engine.config import _default_rules

        rules = _default_rules()
        assert len(rules) == 5
        names = [r.name for r in rules]
        assert "dedup_indexer_lag" in names
        assert "dedup_source_failures" in names
        assert "rate_limit_source_failures" in names
        assert "suppress_healthy_alerts" in names
        assert "dedup_contract_lag" in names

    def test_load_rules_from_env(self):
        from src.alert_engine.config import load_rules_from_env

        with patch.dict(os.environ, {"ALERT_DEDUP_WINDOW_SECONDS": "600"}):
            rules = load_rules_from_env()
            assert len(rules) == 1
            assert rules[0].window_seconds == 600

    def test_load_rules_from_yaml_file(self, tmp_path: Path):
        from src.alert_engine.config import load_rules_from_yaml

        yaml_path = tmp_path / "test_rules.yaml"
        yaml_path.write_text("""
suppression_rules:
  - type: repeat_alert
    name: "custom_rule"
    window_seconds: 120
    key_fields: ["alert_type"]
""")
        rules = load_rules_from_yaml(str(yaml_path))
        assert len(rules) == 1
        assert rules[0].name == "custom_rule"
        assert rules[0].window_seconds == 120
