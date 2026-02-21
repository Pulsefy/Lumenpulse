from src.analytics.sentiment import SentimentAnalyzer


def test_negative_sentiment():
    analyzer = SentimentAnalyzer()
    text = "Bitcoin is crashing"
    score = analyzer.analyze_text(text)

    assert isinstance(score, float)
    assert score < 0.0
    assert score.language == "en"
    assert score.language_supported is True
    assert score.language_unsupported is False


def test_positive_sentiment():
    analyzer = SentimentAnalyzer()
    text = "Stellar hits all time high"
    score = analyzer.analyze_text(text)

    assert isinstance(score, float)
    assert score > 0.0
    assert score.language == "en"
    assert score.language_supported is True
    assert score.language_unsupported is False


def test_empty_string_returns_zero():
    analyzer = SentimentAnalyzer()
    score = analyzer.analyze_text("")

    assert score == 0.0
    assert score.language_supported is False
    assert score.language_unsupported is False


def test_none_returns_zero():
    analyzer = SentimentAnalyzer()
    score = analyzer.analyze_text(None)

    assert score == 0.0
    assert score.language_supported is False
    assert score.language_unsupported is False


def test_supported_spanish_text_sentiment():
    analyzer = SentimentAnalyzer()
    text = "Bitcoin sube con fuerte rally en el mercado"
    score = analyzer.analyze_text(text)

    assert isinstance(score, float)
    assert score > 0.0
    assert score.language == "es"
    assert score.language_supported is True
    assert score.language_unsupported is False


def test_supported_portuguese_text_sentiment():
    analyzer = SentimentAnalyzer()
    text = "Bitcoin sobe em alta no mercado com rali"
    score = analyzer.analyze_text(text)

    assert isinstance(score, float)
    assert score > 0.0
    assert score.language == "pt"
    assert score.language_supported is True
    assert score.language_unsupported is False


def test_unsupported_language_fallback_to_neutral():
    analyzer = SentimentAnalyzer()
    text = "\u8fd9\u662f\u4e00\u4e2a\u6d4b\u8bd5"
    score = analyzer.analyze_text(text)

    assert score == 0.0
    assert score.language == "zh"
    assert score.language_supported is False
    assert score.language_unsupported is True


def test_lang_hint_overrides_detection():
    analyzer = SentimentAnalyzer()
    text = "Bitcoin is crashing hard"
    score = analyzer.analyze_text(text, lang_hint="fr")

    assert score == 0.0
    assert score.language == "fr"
    assert score.language_supported is False
    assert score.language_unsupported is True
