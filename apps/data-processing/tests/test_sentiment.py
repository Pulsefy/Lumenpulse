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


def test_supported_chinese_text_sentiment_positive():
    analyzer = SentimentAnalyzer()
    text = "比特币价格大幅上涨，市场看涨"
    score = analyzer.analyze_text(text)

    assert isinstance(score, float)
    assert score > 0.0
    assert score.language == "zh"
    assert score.language_supported is True
    assert score.language_unsupported is False
    assert score.score_reliable is True
    assert score.unscored is False


def test_supported_chinese_text_sentiment_negative():
    analyzer = SentimentAnalyzer()
    text = "市场崩盘，投资者抛售"
    score = analyzer.analyze_text(text)

    assert isinstance(score, float)
    assert score < 0.0
    assert score.language == "zh"
    assert score.language_supported is True
    assert score.score_reliable is True


def test_unsupported_language_is_unscored_not_mis_scored():
    analyzer = SentimentAnalyzer()
    text = "\u3053\u308c\u306f\u30c6\u30b9\u30c8\u3067\u3059"  # Japanese
    score = analyzer.analyze_text(text)

    assert score == 0.0
    assert score.language == "ja"
    assert score.language_supported is False
    assert score.language_unsupported is True
    assert score.score_reliable is False
    assert score.unscored is True


def test_lang_hint_overrides_detection():
    analyzer = SentimentAnalyzer()
    text = "Bitcoin is crashing hard"
    score = analyzer.analyze_text(text, lang_hint="fr")

    assert score == 0.0
    assert score.language == "fr"
    assert score.language_supported is False
    assert score.language_unsupported is True
    assert score.score_reliable is False
    assert score.unscored is True


def test_score_to_dict_includes_language_metadata():
    analyzer = SentimentAnalyzer()
    score = analyzer.analyze_text("Bitcoin is crashing")
    data = score.to_dict()

    assert data["score"] == float(score)
    assert data["language"] == "en"
    assert data["language_supported"] is True
    assert data["score_reliable"] is True
    assert data["unscored"] is False


def test_detect_language_public_method():
    analyzer = SentimentAnalyzer()

    assert analyzer.detect_language("Bitcoin sube en el mercado") == "es"
    assert analyzer.detect_language("比特币价格大涨") == "zh"
    assert analyzer.detect_language("") == "unknown"
    assert analyzer.detect_language(None) == "unknown"
