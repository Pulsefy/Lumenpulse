import pytest

from src.ml.ood_detector import (
    LexicalOODDetector,
    configured_unknown_token_ratio,
    false_positive_rate,
)


def test_detector_rejects_text_with_too_many_unknown_tokens():
    detector = LexicalOODDetector(
        vocabulary={"market", "rises", "today"},
        max_unknown_token_ratio=0.5,
    )

    assessment = detector.assess("xqzv blorf market")

    assert assessment.is_out_of_distribution is True
    assert assessment.unknown_token_ratio == pytest.approx(2 / 3)
    assert assessment.confidence == pytest.approx(1 / 3)


def test_detector_accepts_text_supported_by_vocabulary():
    detector = LexicalOODDetector(
        vocabulary={"market", "rises", "today"},
        max_unknown_token_ratio=0.5,
    )

    assessment = detector.assess("the market rises today")

    assert assessment.is_out_of_distribution is False
    assert assessment.confidence == 1.0


def test_detector_accepts_known_crypto_names():
    detector = LexicalOODDetector(vocabulary=set(), max_unknown_token_ratio=0.75)

    assessment = detector.assess("Stellar Lumens and Soroban")

    assert assessment.is_out_of_distribution is False


def test_false_positive_rate_measures_rejected_in_distribution_examples():
    detector = LexicalOODDetector(
        vocabulary={"market", "rises", "falls", "today"},
        max_unknown_token_ratio=0.2,
    )

    measured_rate = false_positive_rate(
        detector,
        [
            "the market rises today",
            "the market falls today",
            "the market lumenscope today",
            "market rises",
        ],
    )

    assert measured_rate == pytest.approx(0.25)


def test_false_positive_rate_requires_calibration_examples():
    detector = LexicalOODDetector(vocabulary=set(), max_unknown_token_ratio=0.75)

    with pytest.raises(ValueError, match="at least one example"):
        false_positive_rate(detector, [])


def test_threshold_is_configurable(monkeypatch):
    monkeypatch.setenv("ANALYZE_OOD_MAX_UNKNOWN_TOKEN_RATIO", "0.4")

    assert configured_unknown_token_ratio() == 0.4


@pytest.mark.parametrize("value", ["invalid", "-0.1", "1.1"])
def test_invalid_threshold_is_rejected(monkeypatch, value):
    monkeypatch.setenv("ANALYZE_OOD_MAX_UNKNOWN_TOKEN_RATIO", value)

    with pytest.raises(ValueError, match="must be a number between 0 and 1"):
        configured_unknown_token_ratio()


def test_detector_rejects_input_without_word_tokens():
    detector = LexicalOODDetector(vocabulary={"market"}, max_unknown_token_ratio=0.75)

    assessment = detector.assess("123 !!!")

    assert assessment.is_out_of_distribution is True
    assert assessment.confidence == 0.0
