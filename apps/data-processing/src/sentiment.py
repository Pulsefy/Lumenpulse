"""
Sentiment analyzer module - analyzes sentiment of news articles
"""

import os
import logging
from typing import List, Dict, Any, Optional, Tuple
from concurrent.futures import ProcessPoolExecutor
from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer
from dataclasses import dataclass

# Import keyword extractor for asset filtering
from src.analytics.keywords import KeywordExtractor

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

    extractor = KeywordExtractor()
    asset_codes = extractor.extract_tickers_only(text)

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
            }

    analyzer = SentimentIntensityAnalyzer()
    scores = analyzer.polarity_scores(text)
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
                )
        
        cache_key = f"{text}:{asset_filter}" if asset_filter else text
        if self.cache:
            cached = self.cache.get(cache_key)
            if cached:
                return SentimentResult(**cached)

        scores = self.analyzer.polarity_scores(text)
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
