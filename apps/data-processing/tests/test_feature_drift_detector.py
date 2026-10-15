# -*- coding: utf-8 -*-
"""Tests for training-vs-serving feature drift detection (#1239)."""

import numpy as np
import pandas as pd
import pytest

from src.ml.feature_drift_detector import (
    FeatureDriftDetector,
    compute_distribution_baseline,
    population_stability_index,
)
from src.ml.feature_schema import current_feature_schema

FEATURES = ["sentiment_score", "volume", "volatility"]


def _training_frame(seed: int = 42, n: int = 500) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    return pd.DataFrame(
        {
            "sentiment_score": rng.uniform(-1, 1, n),
            "volume": rng.uniform(1_000, 100_000, n),
            "volatility": rng.uniform(0, 0.5, n),
        }
    )


def _metadata_from(frame: pd.DataFrame) -> dict:
    schema = current_feature_schema()
    return {
        "schema_version": schema.version,
        "schema_fingerprint": schema.fingerprint,
        "feature_names": FEATURES,
        "feature_baseline": compute_distribution_baseline(frame, FEATURES),
    }


class _RecordingNotifier:
    def __init__(self):
        self.calls = []

    def notify_feature_drift(self, report):
        self.calls.append(report)


# ── pure stats ─────────────────────────────────────────────────────────────

def test_compute_baseline_shape():
    baseline = compute_distribution_baseline(_training_frame(), FEATURES)
    assert set(baseline) == set(FEATURES)
    for spec in baseline.values():
        assert spec["count"] == 500
        assert "bin_edges" in spec and "bin_props" in spec
        # proportions sum to ~1
        assert abs(sum(spec["bin_props"]) - 1.0) < 1e-6


def test_psi_zero_for_identical_distribution():
    frame = _training_frame()
    baseline = compute_distribution_baseline(frame, FEATURES)
    for feature in FEATURES:
        psi = population_stability_index(baseline[feature], frame[feature].to_numpy())
        assert psi == pytest.approx(0.0, abs=1e-9)


def test_psi_positive_for_shifted_distribution():
    frame = _training_frame()
    baseline = compute_distribution_baseline(frame, FEATURES)
    # shift sentiment strongly positive -> large PSI
    shifted = frame["sentiment_score"].to_numpy() + 5.0
    psi = population_stability_index(baseline["sentiment_score"], shifted)
    assert psi > 0.25


def test_psi_empty_serving_is_zero():
    baseline = compute_distribution_baseline(_training_frame(), FEATURES)
    assert population_stability_index(baseline["volume"], np.array([])) == 0.0


# ── detector orchestration ──────────────────────────────────────────────────

def test_no_baseline_reports_and_does_not_alert():
    notifier = _RecordingNotifier()
    detector = FeatureDriftDetector(
        metadata_loader=lambda *_: None,
        serving_frame_provider=lambda: _training_frame(),
        notifier=notifier,
    )
    report = detector.detect()
    assert report.status == "no_baseline"
    assert report.alerted is False
    assert notifier.calls == []


def test_no_drift_when_serving_matches_training():
    frame = _training_frame()
    metadata = _metadata_from(frame)
    notifier = _RecordingNotifier()
    detector = FeatureDriftDetector(
        metadata_loader=lambda *_: metadata,
        serving_frame_provider=lambda: _training_frame(seed=42),
        notifier=notifier,
    )
    report = detector.detect()
    assert report.status == "ok"
    assert report.drift_detected is False
    assert report.drifted_features == []
    assert notifier.calls == []


def test_drift_detected_raises_alert_through_notifier():
    frame = _training_frame()
    metadata = _metadata_from(frame)

    serving = _training_frame(seed=7)
    serving["sentiment_score"] = serving["sentiment_score"] + 5.0  # hard shift

    notifier = _RecordingNotifier()
    detector = FeatureDriftDetector(
        metadata_loader=lambda *_: metadata,
        serving_frame_provider=lambda: serving,
        notifier=notifier,
    )
    report = detector.detect()

    assert report.status == "drift_detected"
    assert "sentiment_score" in report.drifted_features
    assert report.alerted is True
    assert len(notifier.calls) == 1
    payload = notifier.calls[0]
    assert payload["feature_set"] == current_feature_schema().feature_set
    assert "sentiment_score" in payload["drifted_features"]


def test_schema_fingerprint_mismatch_alerts_even_without_distribution_drift():
    frame = _training_frame()
    metadata = _metadata_from(frame)
    metadata["schema_fingerprint"] = "deadbeef0000"  # stale fingerprint

    notifier = _RecordingNotifier()
    detector = FeatureDriftDetector(
        metadata_loader=lambda *_: metadata,
        serving_frame_provider=lambda: _training_frame(seed=42),
        notifier=notifier,
    )
    report = detector.detect()

    assert report.schema_mismatch is True
    assert report.drift_detected is True
    assert report.status == "drift_detected"
    assert report.alerted is True
    assert notifier.calls[0]["schema_mismatch"] is True


def test_insufficient_serving_data_reports_without_distribution_alert():
    frame = _training_frame()
    metadata = _metadata_from(frame)
    notifier = _RecordingNotifier()
    detector = FeatureDriftDetector(
        metadata_loader=lambda *_: metadata,
        serving_frame_provider=lambda: pd.DataFrame(),
        notifier=notifier,
    )
    report = detector.detect()
    assert report.status == "insufficient_serving_data"
    assert notifier.calls == []


def test_serving_provider_failure_is_handled():
    frame = _training_frame()
    metadata = _metadata_from(frame)

    def _boom():
        raise RuntimeError("db down")

    detector = FeatureDriftDetector(
        metadata_loader=lambda *_: metadata,
        serving_frame_provider=_boom,
        notifier=_RecordingNotifier(),
    )
    report = detector.detect()
    assert report.status == "insufficient_serving_data"


def test_threshold_is_configurable_via_param():
    frame = _training_frame()
    metadata = _metadata_from(frame)
    serving = _training_frame(seed=7)
    serving["volume"] = serving["volume"] * 3.0 + 200_000  # moderate shift

    # A very high threshold suppresses the alert...
    high = FeatureDriftDetector(
        metadata_loader=lambda *_: metadata,
        serving_frame_provider=lambda: serving.copy(),
        notifier=_RecordingNotifier(),
        psi_threshold=100.0,
    )
    assert high.detect().drift_detected is False

    # ...while a tiny threshold surfaces it.
    low = FeatureDriftDetector(
        metadata_loader=lambda *_: metadata,
        serving_frame_provider=lambda: serving.copy(),
        notifier=_RecordingNotifier(),
        psi_threshold=0.001,
    )
    assert low.detect().drift_detected is True


def test_threshold_from_env(monkeypatch):
    monkeypatch.setenv("FEATURE_DRIFT_PSI_THRESHOLD", "0.42")
    detector = FeatureDriftDetector(
        metadata_loader=lambda *_: None,
        serving_frame_provider=lambda: _training_frame(),
    )
    assert detector.psi_threshold == 0.42
