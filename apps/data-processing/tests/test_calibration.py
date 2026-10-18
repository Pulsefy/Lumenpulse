"""Confidence calibration: metrics, calibrators, committed curves, serving."""

import json

import pytest

from src.ml import calibration as cal
from src.ml.calibration_data import build_all, sentiment_raw_confidence


def test_reliability_curve_and_ece_on_hand_computed_input():
    # Bin [0.9,1.0): conf 0.9 x4, right 2/4 -> gap 0.4.  Bin [0.1,0.2): conf 0.1 x2, right 0/2 -> gap 0.1
    conf = [0.9, 0.9, 0.9, 0.9, 0.1, 0.1]
    out = [1, 1, 0, 0, 0, 0]
    curve = cal.reliability_curve(conf, out)
    assert [b["count"] for b in curve] == [2, 4]
    assert cal.expected_calibration_error(conf, out) == pytest.approx(
        (4 * 0.4 + 2 * 0.1) / 6, abs=1e-3
    )
    assert cal.brier_score([1.0, 0.0], [1, 0]) == 0.0


def test_isotonic_is_monotone_and_fixes_overconfidence():
    conf = [0.9] * 10 + [0.5] * 10
    out = [1] * 6 + [0] * 4 + [1] * 5 + [0] * 5
    knots = cal.fit_isotonic(conf, out)
    assert knots["y"] == sorted(knots["y"])
    assert cal.apply_knots(knots, 0.9) == pytest.approx(0.6, abs=0.01)
    assert cal.apply_knots(knots, 0.5) == pytest.approx(0.5, abs=0.01)


def test_base_rate_never_claims_certainty():
    assert cal.base_rate([1, 1, 1]) == pytest.approx(0.8)
    assert 0 < cal.base_rate([0, 0]) < 0.5


def test_gap_not_material_means_identity():
    conf = [0.8] * 10
    out = [1] * 8 + [0] * 2
    report = cal.fit_calibration("m", conf, out, dataset="d", raw_field="r")
    assert report["method"] == "none"
    assert cal.Calibrator(report).calibrate(0.8) == 0.8


def test_small_sample_uses_base_rate_and_is_flagged_unreliable():
    report = cal.fit_calibration(
        "m", [0.95] * 6, [1, 0, 0, 1, 0, 0], dataset="d", raw_field="r"
    )
    assert report["method"] == "base_rate"
    assert report["reliable"] is False


def test_large_sample_uses_isotonic_and_reduces_held_out_error():
    conf = [0.9] * 40
    out = [1] * 24 + [0] * 16  # right 60% of the time at "0.9"
    report = cal.fit_calibration("m", conf, out, dataset="d", raw_field="r")
    assert report["method"] == "isotonic"
    assert report["after"]["ece_held_out"] < report["before"]["ece"]
    assert cal.Calibrator(report).calibrate(0.9) == pytest.approx(0.6, abs=0.02)


def test_fitted_output_is_clamped():
    report = cal.fit_calibration(
        "m", [0.5] * 20 + [0.9] * 20, [0] * 20 + [1] * 20, dataset="d", raw_field="r"
    )
    calibrator = cal.Calibrator(report)
    assert calibrator.calibrate(0.9) <= cal.CALIBRATED_CEILING
    assert calibrator.calibrate(0.5) >= cal.CALIBRATED_FLOOR


def test_missing_calibrator_is_identity(tmp_path, monkeypatch):
    monkeypatch.setenv("CALIBRATION_DIR", str(tmp_path))
    cal.clear_calibrator_cache()
    result = cal.calibrated_confidence("ghost", 0.73)
    assert result["calibrated_confidence"] == 0.73
    assert result["calibration"]["method"] == "uncalibrated"
    cal.clear_calibrator_cache()


def test_sentiment_raw_confidence_ranges():
    assert sentiment_raw_confidence(0.0, "neutral") == 1.0
    assert sentiment_raw_confidence(0.05, "neutral") == 0.5
    assert sentiment_raw_confidence(0.9, "positive") == pytest.approx(0.95)


def test_committed_curves_exist_and_match_a_fresh_build():
    """The committed curves must be reproducible from the committed ground truth."""
    cal.clear_calibrator_cache()
    for model, spec in build_all().items():
        path = cal.CALIBRATION_DIR / f"{model}.json"
        assert path.exists(), f"models/calibration/{model}.json is not committed"
        committed = json.loads(path.read_text(encoding="utf-8"))
        confidences, outcomes = spec["data"]
        fresh = cal.fit_calibration(
            model,
            confidences,
            outcomes,
            dataset=spec["dataset"],
            raw_field=spec["raw_field"],
            notes=spec["notes"],
        )
        stale = f"{model} calibration is stale; run scripts/build_calibration.py --write"
        if model == "forecast":
            # Depends on sklearn training output, which can differ slightly
            # across Python / library versions: compare the decision, not bits.
            assert committed["method"] == fresh["method"], stale
            assert committed["n_samples"] == fresh["n_samples"], stale
            assert abs(committed["before"]["ece"] - fresh["before"]["ece"]) < 0.05, stale
        else:
            assert committed == fresh, stale
        assert committed["before"]["curve"], "reliability curve must be committed"


def test_anomaly_result_exposes_calibrated_confidence():
    from src.anomaly_detector import AnomalyDetector

    detector = AnomalyDetector(z_threshold=2.5, use_ml=False)
    for value in (1000, 1010, 990, 1005, 995, 1002, 998, 1001, 999, 1003, 997, 1000):
        detector.add_data_point(volume=value, sentiment_score=0.0)
    flagged = detector.detect_volume_anomaly(8000.0).to_dict()
    assert flagged["is_anomaly"] is True
    assert "calibrated_confidence" in flagged
    normal = detector.detect_volume_anomaly(1001.0).to_dict()
    assert "calibrated_confidence" not in normal
