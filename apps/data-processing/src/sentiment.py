"""
Sentiment analyzer module - analyzes sentiment of news articles
"""

import logging
import os
import re
import unicodedata
from typing import List, Dict, Any, Optional, Tuple
from concurrent.futures import ProcessPoolExecutor
from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer
from dataclasses import dataclass

# Import keyword extractor for asset filtering
from src.analytics.keywords import KeywordExtractor

try:
    from langdetect import DetectorFactory, LangDetectException, detect
    DetectorFactory.seed = 0
    LANGDETECT_AVAILABLE = True
except ImportError:
    LANGDETECT_AVAILABLE = False

    class LangDetectException(Exception):
        """Fallback exception when langdetect is unavailable."""

_DEFAULT_TRANSLATION_MODEL = "Helsinki-NLP/opus-mt-mul-en"


def _normalize_text(text: str) -> str:
    normalized = unicodedata.normalize("NFKC", text or "")
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return normalized


def _normalize_language_code(language: str) -> str:
    if not language or not isinstance(language, str):
        return "unknown"
    normalized = language.strip().lower().replace("_", "-")
    return normalized.split("-")[0]


def _detect_script_language(text: str) -> Optional[str]:
    if re.search(r"[\u4e00-\u9fff]", text):
        return "zh"
    if re.search(r"[\u3040-\u30ff]", text):
        return "ja"
    if re.search(r"[\uac00-\ud7af]", text):
        return "ko"
    if re.search(r"[\u0400-\u04ff]", text):
        return "ru"
    if re.search(r"[\u0600-\u06ff]", text):
        return "ar"
    return None


def _detect_language(text: str, hint: Optional[str] = None) -> str:
    if hint:
        return _normalize_language_code(hint)

    script_language = _detect_script_language(text or "")
    if script_language:
        return script_language

    if LANGDETECT_AVAILABLE and text:
        try:
            detected = detect(text)
            return _normalize_language_code(detected)
        except LangDetectException:
            pass

    return "en"


class TranslationService:
    """Translate non-English text to English before sentiment analysis."""

    def __init__(self):
        self._translation_disabled = os.environ.get(
            "TRANSLATION_DISABLE_MODEL", ""
        ).strip().lower() in ("1", "true", "yes", "on")
        self._model_name = os.environ.get(
            "TRANSLATION_MODEL_NAME", _DEFAULT_TRANSLATION_MODEL
        ).strip() or _DEFAULT_TRANSLATION_MODEL
        self._tokenizer = None
        self._model = None
        self._load_failed = False

    def _load(self) -> bool:
        if self._translation_disabled or self._load_failed:
            return False
        if self._model is not None and self._tokenizer is not None:
            return True

        try:
            from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

            self._tokenizer = AutoTokenizer.from_pretrained(self._model_name)
            self._model = AutoModelForSeq2SeqLM.from_pretrained(self._model_name)
            self._model.eval()
            return True
        except Exception as exc:
            logging.getLogger(__name__).warning(
                "Translation model unavailable or failed to load: %s",
                exc,
            )
            self._load_failed = True
            return False

    def translate(self, text: str) -> Optional[str]:
        if not text or self._translation_disabled:
            return None
        if not self._load():
            return None

        try:
            inputs = self._tokenizer(
                text,
                return_tensors="pt",
                truncation=True,
                max_length=512,
                padding=True,
            )
            outputs = self._model.generate(**inputs, max_length=512, num_beams=2)
            return self._tokenizer.batch_decode(outputs, skip_special_tokens=True)[0]
        except Exception as exc:
            logging.getLogger(__name__).warning(
                "Translation inference failed: %s", exc
            )
            self._load_failed = True
            return None


_translation_service = TranslationService()


def _translate_if_needed(text: str, language_hint: Optional[str] = None) -> tuple[str, str, bool]:
    source_language = _detect_language(text, hint=language_hint)
    if source_language == "en":
        return text, source_language, False

    translated = _translation_service.translate(text)
    if translated:
        return translated, source_language, True

    return text, source_language, False

logger = logging.getLogger(__name__)

# Minimum batch size to justify spawning worker processes.
_PARALLEL_THRESHOLD = 20


def _analyze_in_worker(args: Tuple[str, Optional[str]]) -> dict:
    """Process-safe sentiment analysis for a single text.

    Each worker initialises its own VADER analyzer and KeywordExtractor
    because they cannot be pickled across process boundaries.  Redis cache
    is intentionally skipped in workers to avoid per-process connections.
    """
    text, asset_filter = args

    cleaned_text = _normalize_text(text)
    translated_text, language, translated = _translate_if_needed(cleaned_text)
    text_to_analyze = translated_text if translated_text else cleaned_text

    extractor = KeywordExtractor()
    asset_codes = extractor.extract_tickers_only(text_to_analyze)

    if asset_filter:
        asset_filter = asset_filter.upper()
        if asset_filter not in asset_codes:
            return {
                "text": text[:100],
                "compound_score": 0.0,
                "positive": 0.0,
                "negative": 0.0,
                "neutral": 1.0,
                "sentiment_label": "neutral",
                "asset_codes": [],
                "language": language,
                "translated": translated,
            }

    analyzer = SentimentIntensityAnalyzer()
    scores = analyzer.polarity_scores(text_to_analyze)
    compound = scores["compound"]

    if compound >= 0.05:
        label = "positive"
    elif compound <= -0.05:
        label = "negative"
    else:
        label = "neutral"

    return {
        "text": text[:100],
        "compound_score": compound,
        "positive": scores["pos"],
        "negative": scores["neg"],
        "neutral": scores["neu"],
        "sentiment_label": label,
        "asset_codes": asset_codes,
        "language": language,
        "translated": translated,
    }


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
    language: str = "unknown"
    translated: bool = False

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
            "translated": self.translated,
        }


class SentimentAnalyzer:
    """Analyzes sentiment of text using VADER sentiment analysis"""

    def __init__(self):
        self.analyzer = SentimentIntensityAnalyzer()
        self.keyword_extractor = KeywordExtractor()
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

    def analyze(self, text: str, asset_filter: Optional[str] = None) -> SentimentResult:
        """
        Analyze sentiment of a single text

        Args:
            text: Text to analyze
            asset_filter: Optional asset code to filter results (e.g., 'XLM', 'USDC')

        Returns:
            SentimentResult object
        """
        cleaned_text = _normalize_text(text or "")
        translated_text, language, translated = _translate_if_needed(cleaned_text)
        text_to_analyze = translated_text if translated_text else cleaned_text

        # Extract asset codes from text after translation/normalization
        asset_codes = self.keyword_extractor.extract_tickers_only(text_to_analyze)

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
                    language=language,
                    translated=translated,
                )

        cache_key = f"{text}:{asset_filter}" if asset_filter else text
        if self.cache:
            cached = self.cache.get(cache_key)
            if cached:
                return SentimentResult(**cached)

        scores = self.analyzer.polarity_scores(text_to_analyze)
        compound = scores["compound"]
        if compound >= 0.05:
            label = "positive"
        elif compound <= -0.05:
            label = "negative"
        else:
            label = "neutral"

        result = SentimentResult(
            text=text[:100],
            compound_score=compound,
            positive=scores["pos"],
            negative=scores["neg"],
            neutral=scores["neu"],
            sentiment_label=label,
            asset_codes=asset_codes,
            language=language,
            translated=translated,
        )

        if self.cache:
            self.cache.set(cache_key, result.to_dict())

        return result

    def analyze_batch(self, texts: List[str], asset_filter: Optional[str] = None) -> List[SentimentResult]:
        """
        Analyze sentiment of multiple texts

        Args:
            texts: List of texts to analyze
            asset_filter: Optional asset code to filter results (e.g., 'XLM', 'USDC')

        Returns:
            List of SentimentResult objects
        """
        results = [self.analyze(t, asset_filter) for t in texts]
        logger.info("Analyzed %d texts for sentiment", len(results))
        if asset_filter:
            logger.info("Filtered for asset: %s", asset_filter)
        return results

    def analyze_batch_parallel(
        self,
        texts: List[str],
        asset_filter: Optional[str] = None,
        max_workers: Optional[int] = None,
    ) -> List[SentimentResult]:
        """Analyze sentiment using ProcessPoolExecutor for large batches.

        Falls back to sequential processing when the batch is smaller than
        ``_PARALLEL_THRESHOLD`` or when running inside a child process.

        Args:
            texts: List of texts to analyze.
            asset_filter: Optional asset code to filter results.
            max_workers: Max worker processes (defaults to CPU count).

        Returns:
            List of SentimentResult objects.
        """
        if not texts:
            return []

        # Fall back to sequential for small batches (overhead > benefit).
        if len(texts) < _PARALLEL_THRESHOLD:
            return self.analyze_batch(texts, asset_filter)

        if max_workers is None:
            max_workers = min(os.cpu_count() or 2, 8)

        args = [(text, asset_filter) for text in texts]

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
            return self.analyze_batch(texts, asset_filter)

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
            }

        positive_count = sum(1 for r in results if r.sentiment_label == "positive")
        negative_count = sum(1 for r in results if r.sentiment_label == "negative")
        neutral_count = sum(1 for r in results if r.sentiment_label == "neutral")
        avg_compound = sum(r.compound_score for r in results) / len(results)

        # Calculate asset distribution
        asset_distribution = {}
        for result in results:
            for asset in result.asset_codes:
                asset_distribution[asset] = asset_distribution.get(asset, 0) + 1

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
        }
