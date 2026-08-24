"""
Sentiment analyzer module - analyzes sentiment of news articles

Language is detected before scoring and recorded on every result. Content in a
detected-but-unsupported language is marked as unscored instead of being fed
to the English scorer, which would otherwise produce confidently wrong scores.
"""

import os
import logging
from typing import List, Dict, Any, Optional, Tuple
from concurrent.futures import ProcessPoolExecutor
from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer
from dataclasses import dataclass

# Import keyword extractor for asset filtering
from src.analytics.keywords import KeywordExtractor

# Shared language detection + keyword lexicons from the analytics module.
from src.analytics.sentiment import (
    NEGATIVE_KEYWORDS,
    POSITIVE_KEYWORDS,
    SUPPORTED_LANGUAGES,
    SentimentAnalyzer as _MultilingualSentimentAnalyzer,
    score_to_label,
)

logger = logging.getLogger(__name__)

# Minimum batch size to justify spawning worker processes.
_PARALLEL_THRESHOLD = 20


def _language_metadata(language: str) -> Dict[str, Any]:
    """Metadata for an intentionally-unscored result (empty/unsupported/filtered)."""
    supported = language in SUPPORTED_LANGUAGES
    return {
        "language": language,
        "language_supported": supported,
        "language_unsupported": language != "unknown" and not supported,
        "score_reliable": False,
        "unscored": True,
    }


def _score_text(
    vader_analyzer: SentimentIntensityAnalyzer,
    multilingual: "_MultilingualSentimentAnalyzer",
    text: str,
    lang_hint: Optional[str],
) -> Dict[str, Any]:
    """
    Score ``text`` with language detection applied first.

    English is scored with VADER exactly as before; supported non-English
    languages (es/pt/zh) use keyword lexicons; anything else is marked
    unscored. Returns a dict of SentimentResult-compatible fields.
    """
    language = multilingual.detect_language(text, lang_hint)
    if language not in SUPPORTED_LANGUAGES:
        return {
            **_language_metadata(language),
            "compound_score": 0.0,
            "positive": 0.0,
            "negative": 0.0,
            "neutral": 1.0,
            "sentiment_label": "neutral",
        }

    if language == "en":
        scores = vader_analyzer.polarity_scores(text)
        compound = float(scores.get("compound", 0.0))
        if compound == 0.0:
            # Crypto-slang boost for English (mirrors the analytics analyzer):
            # when VADER is neutral, let slang like "crash"/"moon" decide.
            cleaned = text.lower()
            if any(word in cleaned for word in NEGATIVE_KEYWORDS["en"]):
                compound = -0.4
            elif any(word in cleaned for word in POSITIVE_KEYWORDS["en"]):
                compound = 0.4
        return {
            "language": language,
            "language_supported": True,
            "language_unsupported": False,
            "score_reliable": True,
            "unscored": False,
            "compound_score": compound,
            "positive": float(scores.get("pos", 0.0)),
            "negative": float(scores.get("neg", 0.0)),
            "neutral": float(scores.get("neu", 1.0)),
            "sentiment_label": score_to_label(compound),
        }

    compound = multilingual.keyword_score(text, language)
    if compound > 0:
        positive, negative, neutral = compound, 0.0, 1.0 - compound
    elif compound < 0:
        positive, negative, neutral = 0.0, -compound, 1.0 + compound
    else:
        positive, negative, neutral = 0.0, 0.0, 1.0

    return {
        "language": language,
        "language_supported": True,
        "language_unsupported": False,
        "score_reliable": True,
        "unscored": False,
        "compound_score": compound,
        "positive": positive,
        "negative": negative,
        "neutral": neutral,
        "sentiment_label": score_to_label(compound),
    }


def _analyze_in_worker(args: Tuple[str, Optional[str], Optional[str]]) -> dict:
    """Process-safe sentiment analysis for a single text.

    Each worker initialises its own VADER analyzer and KeywordExtractor
    because they cannot be pickled across process boundaries.  Redis cache
    is intentionally skipped in workers to avoid per-process connections.
    """
    text, asset_filter, lang_hint = args

    extractor = KeywordExtractor()
    asset_codes = extractor.extract_tickers_only(text)
    multilingual = _MultilingualSentimentAnalyzer(enable_transformer=False)

    if asset_filter:
        asset_filter = asset_filter.upper()
        if asset_filter not in asset_codes:
            return {
                "text": text[:100],
                **_language_metadata(multilingual.detect_language(text, lang_hint)),
                "compound_score": 0.0,
                "positive": 0.0,
                "negative": 0.0,
                "neutral": 1.0,
                "sentiment_label": "neutral",
                "asset_codes": [],
            }

    vader = SentimentIntensityAnalyzer()
    result_data = _score_text(vader, multilingual, text, lang_hint)
    result_data["text"] = text[:100]
    result_data["asset_codes"] = asset_codes
    return result_data


@dataclass
class SentimentResult:
    """Sentiment analysis result"""

    text: str
    compound_score: float  # -1 to 1
    positive: float  # 0 to 1
    negative: float  # 0 to 1
    neutral: float  # 0 to 1
    sentiment_label: str  # 'positive', 'negative', 'neutral'
    asset_codes: List[str] = None  # List of asset codes mentioned in text
    language: str = "unknown"  # Detected ISO-639-1 language code
    language_supported: bool = False  # True when the language can be scored
    language_unsupported: bool = False  # True when detected but unsupported
    score_reliable: bool = False  # True when scored with a language-appropriate method
    unscored: bool = True  # True when no score was produced (not a confident guess)

    def __post_init__(self):
        if self.asset_codes is None:
            self.asset_codes = []

    def to_dict(self) -> Dict[str, Any]:
        return {
            "text": self.text,
            "compound_score": self.compound_score,
            "positive": self.positive,
            "negative": self.negative,
            "neutral": self.neutral,
            "sentiment_label": self.sentiment_label,
            "asset_codes": self.asset_codes,
            "language": self.language,
            "language_supported": self.language_supported,
            "language_unsupported": self.language_unsupported,
            "score_reliable": self.score_reliable,
            "unscored": self.unscored,
        }


class SentimentAnalyzer:
    """Analyzes sentiment of text, detecting language before scoring"""

    def __init__(self):
        self.analyzer = SentimentIntensityAnalyzer()
        self.keyword_extractor = KeywordExtractor()
        # Shared language detection + keyword scoring for non-English content.
        self._multilingual = _MultilingualSentimentAnalyzer(enable_transformer=False)
        self.cache: object | None = None
        try:
            from cache_manager import CacheManager
        except ImportError:
            logger.info("CacheManager unavailable - sentiment caching disabled")
        else:
            try:
                self.cache = CacheManager(namespace="sentiment")
            except Exception as e:
                logger.warning("Redis unavailable - sentiment caching disabled: %s", e)
            else:
                logger.info("Sentiment cache ready")

    def analyze(
        self,
        text: str,
        asset_filter: Optional[str] = None,
        lang_hint: Optional[str] = None,
    ) -> SentimentResult:
        """
        Analyze sentiment of a single text

        Args:
            text: Text to analyze
            asset_filter: Optional asset code to filter results (e.g., 'XLM', 'USDC')
            lang_hint: Optional ISO language hint (e.g. "en", "es", "zh")

        Returns:
            SentimentResult object
        """
        # Extract asset codes from text
        asset_codes = self.keyword_extractor.extract_tickers_only(text)

        # If asset_filter is specified, check if text mentions that asset
        if asset_filter:
            asset_filter = asset_filter.upper()
            if asset_filter not in asset_codes:
                # Return neutral result if asset not mentioned
                return SentimentResult(
                    text=text[:100],
                    compound_score=0.0,
                    positive=0.0,
                    negative=0.0,
                    neutral=1.0,
                    sentiment_label="neutral",
                    asset_codes=[],
                    **_language_metadata(
                        self._multilingual.detect_language(text, lang_hint)
                    ),
                )

        cache_key = (
            f"{text}:{asset_filter}:{lang_hint}"
            if (asset_filter or lang_hint)
            else text
        )
        if self.cache:
            cached = self.cache.get(cache_key)
            if cached:
                return SentimentResult(**cached)

        result_data = _score_text(self.analyzer, self._multilingual, text, lang_hint)
        result_data["text"] = text[:100]
        result_data["asset_codes"] = asset_codes
        result = SentimentResult(**result_data)

        if self.cache:
            self.cache.set(cache_key, result.to_dict())

        return result

    def analyze_batch(
        self,
        texts: List[str],
        asset_filter: Optional[str] = None,
        lang_hint: Optional[str] = None,
    ) -> List[SentimentResult]:
        """
        Analyze sentiment of multiple texts

        Args:
            texts: List of texts to analyze
            asset_filter: Optional asset code to filter results (e.g., 'XLM', 'USDC')
            lang_hint: Optional ISO language hint applied to every text

        Returns:
            List of SentimentResult objects
        """
        results = [self.analyze(t, asset_filter, lang_hint) for t in texts]
        logger.info("Analyzed %d texts for sentiment", len(results))
        if asset_filter:
            logger.info("Filtered for asset: %s", asset_filter)
        return results

    def analyze_batch_parallel(
        self,
        texts: List[str],
        asset_filter: Optional[str] = None,
        lang_hint: Optional[str] = None,
        max_workers: Optional[int] = None,
    ) -> List[SentimentResult]:
        """Analyze sentiment using ProcessPoolExecutor for large batches.

        Falls back to sequential processing when the batch is smaller than
        ``_PARALLEL_THRESHOLD`` or when running inside a child process.

        Args:
            texts: List of texts to analyze.
            asset_filter: Optional asset code to filter results.
            lang_hint: Optional ISO language hint applied to every text.
            max_workers: Max worker processes (defaults to CPU count).

        Returns:
            List of SentimentResult objects.
        """
        if not texts:
            return []

        # Fall back to sequential for small batches (overhead > benefit).
        if len(texts) < _PARALLEL_THRESHOLD:
            return self.analyze_batch(texts, asset_filter, lang_hint)

        if max_workers is None:
            max_workers = min(os.cpu_count() or 2, 8)

        args = [(text, asset_filter, lang_hint) for text in texts]

        results: List[SentimentResult] = []
        try:
            with ProcessPoolExecutor(max_workers=max_workers) as pool:
                for result_dict in pool.map(_analyze_in_worker, args):
                    results.append(SentimentResult(**result_dict))
        except Exception:
            logger.warning(
                "ProcessPoolExecutor failed, falling back to sequential",
                exc_info=True,
            )
            return self.analyze_batch(texts, asset_filter, lang_hint)

        logger.info(
            "Analyzed %d texts in parallel (%d workers)", len(results), max_workers
        )
        return results

    def get_sentiment_summary(self, results: List[SentimentResult]) -> Dict[str, Any]:
        """
        Get summary statistics from sentiment analysis results

        Args:
            results: List of SentimentResult objects

        Returns:
            Summary statistics
        """
        if not results:
            return {
                "total_items": 0,
                "average_compound_score": 0,
                "positive_count": 0,
                "negative_count": 0,
                "neutral_count": 0,
                "sentiment_distribution": {"positive": 0, "negative": 0, "neutral": 0},
                "asset_distribution": {},
                "language_distribution": {},
                "unscored_count": 0,
            }

        positive_count = sum(1 for r in results if r.sentiment_label == "positive")
        negative_count = sum(1 for r in results if r.sentiment_label == "negative")
        neutral_count = sum(1 for r in results if r.sentiment_label == "neutral")
        unscored_count = sum(1 for r in results if r.unscored)
        avg_compound = sum(r.compound_score for r in results) / len(results)

        # Calculate asset distribution
        asset_distribution = {}
        for result in results:
            for asset in result.asset_codes:
                asset_distribution[asset] = asset_distribution.get(asset, 0) + 1

        # Calculate language distribution
        language_distribution = {}
        for result in results:
            lang = result.language or "unknown"
            language_distribution[lang] = language_distribution.get(lang, 0) + 1

        return {
            "total_items": len(results),
            "average_compound_score": round(avg_compound, 4),
            "positive_count": positive_count,
            "negative_count": negative_count,
            "neutral_count": neutral_count,
            "sentiment_distribution": {
                "positive": round(positive_count / len(results), 4),
                "negative": round(negative_count / len(results), 4),
                "neutral": round(neutral_count / len(results), 4),
            },
            "asset_distribution": asset_distribution,
            "language_distribution": language_distribution,
            "unscored_count": unscored_count,
        }
