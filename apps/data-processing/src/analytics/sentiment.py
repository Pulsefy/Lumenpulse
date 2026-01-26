from typing import Optional
from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer


class SentimentAnalyzer:
    """
    Analyze sentiment of a given text using VADER.
    Returns a compound sentiment score between -1.0 and 1.0.
    """

    def __init__(self) -> None:
        self.analyzer = SentimentIntensityAnalyzer()

    def analyze_text(self, text: Optional[str]) -> float:
        """
        Analyze the sentiment of the given text.

        Args:
            text (str): Input text (headline or article)

        Returns:
            float: Sentiment score between -1.0 (very negative) and 1.0 (very positive)
        """
        if not text or not isinstance(text, str):
            return 0.0

        cleaned = text.strip().lower()
        if not cleaned:
            return 0.0

        scores = self.analyzer.polarity_scores(cleaned)
        compound = float(scores.get("compound", 0.0))

        # --- Domain-specific crypto boost ---
        NEGATIVE_KEYWORDS = ["crash", "crashing", "dump", "bear", "plunge", "collapse"]
        POSITIVE_KEYWORDS = ["moon", "bull", "surge", "rally", "all time high", "ath"]

        if compound == 0.0:
            if any(word in cleaned for word in NEGATIVE_KEYWORDS):
                return -0.4
            if any(word in cleaned for word in POSITIVE_KEYWORDS):
                return 0.4

        return compound
