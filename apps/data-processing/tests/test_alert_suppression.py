"""Tests for AlertSuppressionEngine – dedup and suppression window rules engine."""

from __future__ import annotations

import time
import threading
from unittest.mock import patch

import pytest

from src.alert_suppression import (
    AlertRecord,
    AlertSuppressionConfig,
    AlertSuppressionEngine,
    SuppressionDecision,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_config(**overrides) -> AlertSuppressionConfig:
    defaults = dict(
        enabled=True,
        default_window_seconds=10,
        max_history=100,
        key_overrides={},
    )
    defaults.update(overrides)
    return AlertSuppressionConfig(**defaults)


# ---------------------------------------------------------------------------
# Config tests
# ---------------------------------------------------------------------------

class TestAlertSuppressionConfig:

    def test_defaults(self):
        cfg = AlertSuppressionConfig()
        assert cfg.enabled is True
        assert cfg.default_window_seconds == 300
        assert cfg.max_history == 10_000
        assert cfg.key_overrides == {}

    @patch.dict(
        "os.environ",
        {
            "ALERT_SUPPRESSION_ENABLED": "false",
            "ALERT_SUPPRESSION_DEFAULT_WINDOW": "60",
            "ALERT_SUPPRESSION_MAX_HISTORY": "500",
            "ALERT_SUPPRESSION_KEY_OVERRIDES": '{"anomaly:volume": 120}',
        },
    )
    def test_from_env(self):
        cfg = AlertSuppressionConfig.from_env()
        assert cfg.enabled is False
        assert cfg.default_window_seconds == 60
        assert cfg.max_history == 500
        assert cfg.key_overrides == {"anomaly:volume": 120}

    @patch.dict("os.environ", {"ALERT_SUPPRESSION_KEY_OVERRIDES": "not-json"})
    def test_from_env_bad_json_falls_back(self):
        cfg = AlertSuppressionConfig.from_env()
        assert cfg.key_overrides == {}


# ---------------------------------------------------------------------------
# First-occurrence tests
# ---------------------------------------------------------------------------

class TestFirstOccurrence:

    def test_first_occurrence_always_emitted(self):
        engine = AlertSuppressionEngine(_make_config())
        decision = engine.evaluate("test:alert")
        assert decision.emitted is True
        assert decision.reason == "first_occurrence"
        assert decision.record is not None
        assert decision.record.emit_count == 1

    def test_first_occurrence_different_keys(self):
        engine = AlertSuppressionEngine(_make_config())
        d1 = engine.evaluate("key:a")
        d2 = engine.evaluate("key:b")
        assert d1.emitted is True
        assert d2.emitted is True
        assert len(engine.get_all_records()) == 2


# ---------------------------------------------------------------------------
# Suppression window tests
# ---------------------------------------------------------------------------

class TestSuppressionWindow:

    def test_second_call_within_window_suppressed(self):
        engine = AlertSuppressionEngine(_make_config(default_window_seconds=60))
        d1 = engine.evaluate("x")
        assert d1.emitted is True

        d2 = engine.evaluate("x")
        assert d2.emitted is False
        assert "suppressed" in d2.reason

    def test_call_after_window_emits(self):
        engine = AlertSuppressionEngine(_make_config(default_window_seconds=0))
        engine.evaluate("y")
        decision = engine.evaluate("y")
        assert decision.emitted is True
        assert "window_elapsed" in decision.reason

    def test_suppress_count_increments(self):
        engine = AlertSuppressionEngine(_make_config(default_window_seconds=60))
        engine.evaluate("z")
        engine.evaluate("z")
        engine.evaluate("z")
        record = engine.get_record("z")
        assert record is not None
        assert record.emit_count == 1
        assert record.suppress_count == 2


# ---------------------------------------------------------------------------
# Per-key override tests
# ---------------------------------------------------------------------------

class TestKeyOverrides:

    def test_per_key_override(self):
        engine = AlertSuppressionEngine(
            _make_config(default_window_seconds=60, key_overrides={"fast": 0})
        )
        engine.evaluate("fast")
        d = engine.evaluate("fast")
        assert d.emitted is True

    def test_non_overridden_key_uses_default(self):
        engine = AlertSuppressionEngine(
            _make_config(default_window_seconds=60, key_overrides={"fast": 0})
        )
        engine.evaluate("slow")
        d = engine.evaluate("slow")
        assert d.emitted is False


# ---------------------------------------------------------------------------
# Disabled engine tests
# ---------------------------------------------------------------------------

class TestDisabled:

    def test_disabled_always_emits(self):
        engine = AlertSuppressionEngine(_make_config(enabled=False))
        for _ in range(5):
            d = engine.evaluate("anything")
            assert d.emitted is True
            assert d.reason == "suppression_disabled"


# ---------------------------------------------------------------------------
# Eviction tests
# ---------------------------------------------------------------------------

class TestEviction:

    def test_evicts_oldest_when_exceeding_max_history(self):
        engine = AlertSuppressionEngine(_make_config(max_history=5))
        for i in range(7):
            engine.evaluate(f"key:{i}")

        records = engine.get_all_records()
        assert len(records) == 5
        # Oldest keys (key:0, key:1) should be evicted
        assert "key:0" not in records
        assert "key:1" not in records
        assert "key:6" in records


# ---------------------------------------------------------------------------
# Reset tests
# ---------------------------------------------------------------------------

class TestReset:

    def test_reset_key(self):
        engine = AlertSuppressionEngine(_make_config())
        engine.evaluate("r")
        assert engine.reset_key("r") is True
        assert engine.get_record("r") is None

    def test_reset_nonexistent_key(self):
        engine = AlertSuppressionEngine(_make_config())
        assert engine.reset_key("nope") is False

    def test_reset_all(self):
        engine = AlertSuppressionEngine(_make_config())
        engine.evaluate("a")
        engine.evaluate("b")
        count = engine.reset_all()
        assert count == 2
        assert engine.get_all_records() == {}


# ---------------------------------------------------------------------------
# Stats tests
# ---------------------------------------------------------------------------

class TestStats:

    def test_get_stats(self):
        engine = AlertSuppressionEngine(_make_config())
        engine.evaluate("s1")
        engine.evaluate("s1")  # suppressed
        stats = engine.get_stats()
        assert stats["tracked_keys"] == 1
        assert stats["total_emitted"] == 1
        assert stats["total_suppressed"] == 1
        assert stats["enabled"] is True


# ---------------------------------------------------------------------------
# Thread safety tests
# ---------------------------------------------------------------------------

class TestThreadSafety:

    def test_concurrent_evaluates(self):
        engine = AlertSuppressionEngine(_make_config(default_window_seconds=60))
        results: list[SuppressionDecision] = []
        barrier = threading.Barrier(10)

        def worker():
            barrier.wait()
            d = engine.evaluate("concurrent:key")
            results.append(d)

        threads = [threading.Thread(target=worker) for _ in range(10)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        emitted = [r for r in results if r.emitted]
        suppressed = [r for r in results if not r.emitted]
        # Exactly one thread should win the first-occurrence emit
        assert len(emitted) >= 1
        assert len(emitted) + len(suppressed) == 10


# ---------------------------------------------------------------------------
# Decision to_dict tests
# ---------------------------------------------------------------------------

class TestDecisionSerialization:

    def test_to_dict_with_record(self):
        engine = AlertSuppressionEngine(_make_config())
        d = engine.evaluate("serial")
        d_dict = d.to_dict()
        assert d_dict["emitted"] is True
        assert d_dict["alert_key"] == "serial"
        assert "record" in d_dict
        assert d_dict["record"]["key"] == "serial"

    def test_to_dict_without_record(self):
        d = SuppressionDecision(
            emitted=True,
            alert_key="test",
            reason="disabled",
            record=None,
        )
        d_dict = d.to_dict()
        assert "record" not in d_dict


# ---------------------------------------------------------------------------
# Record to_dict tests
# ---------------------------------------------------------------------------

class TestRecordSerialization:

    def test_to_dict(self):
        now = time.time()
        rec = AlertRecord(key="k", first_seen=now, last_emitted=now)
        d = rec.to_dict()
        assert d["key"] == "k"
        assert "first_seen_iso" in d
        assert "last_emitted_iso" in d


# ---------------------------------------------------------------------------
# Integration: AlertNotifier uses suppression
# ---------------------------------------------------------------------------

class TestAlertNotifierIntegration:

    def test_suppressed_anomaly_not_sent(self):
        from unittest.mock import MagicMock, patch
        from src.anomaly_detector import AnomalyResult
        from src.alert_notifier import AlertNotifier

        engine = AlertSuppressionEngine(_make_config(default_window_seconds=60))
        notifier = AlertNotifier(suppression_engine=engine)
        notifier.session = MagicMock()

        result = AnomalyResult(
            is_anomaly=True,
            severity_score=0.9,
            metric_name="volume",
            current_value=150000.0,
            baseline_mean=50000.0,
            baseline_std=10000.0,
            z_score=10.0,
            timestamp=__import__("datetime").datetime.now(),
        )

        # First call – should send
        notifier.notify_anomaly(result)
        assert notifier.session.post.call_count > 0

        notifier.session.reset_mock()

        # Second call within window – suppressed
        notifier.notify_anomaly(result)
        notifier.session.post.assert_not_called()


# ---------------------------------------------------------------------------
# Integration: AlertBot uses suppression
# ---------------------------------------------------------------------------

class TestAlertBotIntegration:

    def test_suppressed_sentiment_not_sent(self):
        from src.alertbot import AlertBot

        engine = AlertSuppressionEngine(_make_config(default_window_seconds=60))
        bot = AlertBot(
            telegram_bot_token="tok",
            telegram_channel_id="@ch",
            suppression_engine=engine,
        )

        data = {
            "average_compound_score": 0.75,
            "sentiment_distribution": {"positive": 0.6, "negative": 0.2, "neutral": 0.2},
            "trend_direction": "bullish",
            "total_analyzed": 30,
        }

        with patch.object(bot, "send_alert", return_value=True) as mock_send:
            # First call – should send
            bot.check_and_alert(0.85, data)
            mock_send.assert_called_once()
            mock_send.reset_mock()

            # Second call within window – suppressed
            bot.check_and_alert(0.85, data)
            mock_send.assert_not_called()
