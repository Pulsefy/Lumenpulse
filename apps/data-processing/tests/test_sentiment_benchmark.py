import os

from src.analytics.sentiment import SentimentAnalyzer, benchmark_vader_vs_transformer


def test_benchmark_with_transformer_disabled_by_env():
    assert os.environ.get("SENTIMENT_DISABLE_TRANSFORMER") == "1"
    rows, summary = benchmark_vader_vs_transformer(
        ("Bitcoin is crashing", "Stellar hits all time high")
    )
    assert len(rows) == 2
    for _text, (_v, tf) in rows.items():
        assert tf is None
    assert summary["samples"] == 2
    assert summary["transformer_inferences_ok"] == 0


def test_explicit_disable_transformer_uses_vader(monkeypatch):
    monkeypatch.delenv("SENTIMENT_DISABLE_TRANSFORMER", raising=False)
    analyzer = SentimentAnalyzer(enable_transformer=False)
    neg = analyzer.analyze_text("Bitcoin is crashing")
    pos = analyzer.analyze_text("Stellar hits all time high")
    assert neg < 0
    assert pos > 0
