"""
Sentiment analyzer module - analyzes sentiment of news articles
"""
import logging
from typing import List, Dict, Any
from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class SentimentResult:
    """Sentiment analysis result"""
    text: str
    compound_score: float  # -1 to 1
    positive: float  # 0 to 1
    negative: float  # 0 to 1
    neutral: float  # 0 to 1
    sentiment_label: str  # 'positive', 'negative', 'neutral'

    def to_dict(self) -> Dict[str, Any]:
        return {
            "compound_score": self.compound_score,
            "positive": self.positive,
            "negative": self.negative,
            "neutral": self.neutral,
            "sentiment_label": self.sentiment_label
        }


class SentimentAnalyzer:
    """Analyzes sentiment of text using VADER sentiment analysis"""

    def __init__(self):
        self.analyzer = SentimentIntensityAnalyzer()

    def analyze(self, text: str) -> SentimentResult:
        """
        Analyze sentiment of a single text
        
        Args:
            text: Text to analyze
            
        Returns:
            SentimentResult object
        """
        try:
            scores = self.analyzer.polarity_scores(text)
            
            # Determine sentiment label based on compound score
            compound = scores['compound']
            if compound >= 0.05:
                label = 'positive'
            elif compound <= -0.05:
                label = 'negative'
            else:
                label = 'neutral'
            
            result = SentimentResult(
                text=text[:100],  # Store first 100 chars for reference
                compound_score=compound,
                positive=scores['pos'],
                negative=scores['neg'],
                neutral=scores['neu'],
                sentiment_label=label
            )
            
            return result
        except Exception as e:
            logger.error(f"Error analyzing sentiment: {e}")
            # Return neutral sentiment on error
            return SentimentResult(
                text=text[:100],
                compound_score=0,
                positive=0,
                negative=0,
                neutral=1,
                sentiment_label='neutral'
            )

    def analyze_batch(self, texts: List[str]) -> List[SentimentResult]:
        """
        Analyze sentiment of multiple texts
        
        Args:
            texts: List of texts to analyze
            
        Returns:
            List of SentimentResult objects
        """
        results = []
        for text in texts:
            results.append(self.analyze(text))
        
        logger.info(f"Analyzed {len(results)} texts for sentiment")
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
                "sentiment_distribution": {
                    "positive": 0,
                    "negative": 0,
                    "neutral": 0
                }
            }

        positive_count = sum(1 for r in results if r.sentiment_label == 'positive')
        negative_count = sum(1 for r in results if r.sentiment_label == 'negative')
        neutral_count = sum(1 for r in results if r.sentiment_label == 'neutral')
        avg_compound = sum(r.compound_score for r in results) / len(results)

        return {
            "total_items": len(results),
            "average_compound_score": round(avg_compound, 4),
            "positive_count": positive_count,
            "negative_count": negative_count,
            "neutral_count": neutral_count,
            "sentiment_distribution": {
                "positive": round(positive_count / len(results), 4),
                "negative": round(negative_count / len(results), 4),
                "neutral": round(neutral_count / len(results), 4)
            }
        }
