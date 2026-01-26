import pytest
from src.analytics.sentiment import SentimentAnalyzer


def test_negative_sentiment():
    analyzer = SentimentAnalyzer()
    text = "Bitcoin is crashing"
    score = analyzer.analyze_text(text)

    assert isinstance(score, float)
    assert score < 0.0


def test_positive_sentiment():
    analyzer = SentimentAnalyzer()
    text = "Stellar hits all time high"
    score = analyzer.analyze_text(text)

    assert isinstance(score, float)
    assert score > 0.0


def test_empty_string_returns_zero():
    analyzer = SentimentAnalyzer()
    score = analyzer.analyze_text("")

    assert score == 0.0


def test_none_returns_zero():
    analyzer = SentimentAnalyzer()
    score = analyzer.analyze_text(None)

    assert score == 0.0


def test_non_english_text_graceful():
    analyzer = SentimentAnalyzer()
    text = "这是一个测试"
    score = analyzer.analyze_text(text)

    assert isinstance(score, float)
