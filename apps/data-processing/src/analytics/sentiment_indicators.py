"""
sentiment_indicators.py

Maps numeric sentiment scores (-1 to 1) to color-coded visual indicators for
use in news feed and asset detail views.

Color scheme
------------
* Bullish  (score >=  0.05) → Green  #00C853
* Bearish  (score <= -0.05) → Red    #D50000
* Neutral  (-0.05 < score < 0.05) → Gray   #9E9E9E

Thresholds match the VADER compound-score cut-offs already used across the
project (see src/sentiment.py).
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import List, Dict, Any


# ---------------------------------------------------------------------------
# Thresholds (matching VADER cut-offs used in src/sentiment.py)
# ---------------------------------------------------------------------------
BULLISH_THRESHOLD: float = 0.05
BEARISH_THRESHOLD: float = -0.05


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class SentimentColor(str, Enum):
    """Canonical color names for sentiment categories."""

    GREEN = "green"
    RED = "red"
    GRAY = "gray"


class SentimentLabel(str, Enum):
    """Human-readable trading labels for sentiment categories."""

    BULLISH = "Bullish"
    BEARISH = "Bearish"
    NEUTRAL = "Neutral"


# ---------------------------------------------------------------------------
# Dataclass
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class SentimentIndicator:
    """
    Full visual indicator for a single sentiment score.

    Attributes
    ----------
    score:        Original compound sentiment score (-1 to 1).
    color:        Semantic color name ("green" | "red" | "gray").
    hex_color:    CSS hex colour value ("#00C853" | "#D50000" | "#9E9E9E").
    label:        Human-readable label ("Bullish" | "Bearish" | "Neutral").
    display_text: Formatted string for UI badges, e.g. "0.85 Bullish".
    """

    score: float
    color: SentimentColor
    hex_color: str
    label: SentimentLabel
    display_text: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "score": self.score,
            "color": self.color.value,
            "hex_color": self.hex_color,
            "label": self.label.value,
            "display_text": self.display_text,
        }


# ---------------------------------------------------------------------------
# Mapper
# ---------------------------------------------------------------------------

class SentimentIndicatorMapper:
    """
    Converts a raw sentiment score into a :class:`SentimentIndicator` ready
    for serialisation to the API response.

    Usage
    -----
    >>> mapper = SentimentIndicatorMapper()
    >>> indicator = mapper.score_to_indicator(0.82)
    >>> indicator.color
    <SentimentColor.GREEN: 'green'>
    >>> indicator.label
    <SentimentLabel.BULLISH: 'Bullish'>
    >>> indicator.display_text
    '0.82 Bullish'
    """

    # Hex values chosen for accessibility contrast on both dark and light UIs
    _HEX: Dict[SentimentColor, str] = {
        SentimentColor.GREEN: "#00C853",
        SentimentColor.RED: "#D50000",
        SentimentColor.GRAY: "#9E9E9E",
    }

    # Legend copy consumed by GET /sentiment/legend
    _LEGEND: List[Dict[str, str]] = [
        {
            "color": SentimentColor.GREEN.value,
            "hex_color": _HEX[SentimentColor.GREEN],
            "label": SentimentLabel.BULLISH.value,
            "description": (
                f"Positive sentiment (score ≥ {BULLISH_THRESHOLD:+.2f}). "
                "The market or news is generally optimistic about this asset."
            ),
            "score_range": f"≥ {BULLISH_THRESHOLD}",
        },
        {
            "color": SentimentColor.RED.value,
            "hex_color": _HEX[SentimentColor.RED],
            "label": SentimentLabel.BEARISH.value,
            "description": (
                f"Negative sentiment (score ≤ {BEARISH_THRESHOLD:+.2f}). "
                "The market or news is generally pessimistic about this asset."
            ),
            "score_range": f"≤ {BEARISH_THRESHOLD}",
        },
        {
            "color": SentimentColor.GRAY.value,
            "hex_color": _HEX[SentimentColor.GRAY],
            "label": SentimentLabel.NEUTRAL.value,
            "description": (
                f"Neutral sentiment ({BEARISH_THRESHOLD:+.2f} < score < "
                f"{BULLISH_THRESHOLD:+.2f}). Insufficient signal to determine"
                " market direction."
            ),
            "score_range": f"{BEARISH_THRESHOLD} to {BULLISH_THRESHOLD}",
        },
    ]

    def score_to_indicator(self, score: float) -> SentimentIndicator:
        """
        Map a compound sentiment score to a :class:`SentimentIndicator`.

        Parameters
        ----------
        score:
            Compound sentiment score in the range [-1, 1].  Values outside
            this range are clamped to the nearest label boundary.

        Returns
        -------
        SentimentIndicator
        """
        score = float(score)

        if score >= BULLISH_THRESHOLD:
            color = SentimentColor.GREEN
            label = SentimentLabel.BULLISH
        elif score <= BEARISH_THRESHOLD:
            color = SentimentColor.RED
            label = SentimentLabel.BEARISH
        else:
            color = SentimentColor.GRAY
            label = SentimentLabel.NEUTRAL

        hex_color = self._HEX[color]
        display_text = self.format_display(score, label)

        return SentimentIndicator(
            score=score,
            color=color,
            hex_color=hex_color,
            label=label,
            display_text=display_text,
        )

    @staticmethod
    def format_display(score: float, label: SentimentLabel | None = None) -> str:
        """
        Return a formatted display string such as ``"0.85 Bullish"``.

        If *label* is not supplied it is derived from *score* on the fly.
        """
        if label is None:
            if score >= BULLISH_THRESHOLD:
                label = SentimentLabel.BULLISH
            elif score <= BEARISH_THRESHOLD:
                label = SentimentLabel.BEARISH
            else:
                label = SentimentLabel.NEUTRAL
        return f"{score:.2f} {label.value}"

    def get_legend(self) -> List[Dict[str, str]]:
        """
        Return the legend definition that the frontend uses to render
        colour-key tooltips.

        Returns
        -------
        list of dict with keys: color, hex_color, label, description, score_range
        """
        return list(self._LEGEND)


# ---------------------------------------------------------------------------
# Module-level convenience
# ---------------------------------------------------------------------------

_default_mapper = SentimentIndicatorMapper()


def get_sentiment_indicator(score: float) -> SentimentIndicator:
    """
    Convenience wrapper around :class:`SentimentIndicatorMapper`.

    >>> get_sentiment_indicator(0.72).label
    <SentimentLabel.BULLISH: 'Bullish'>
    >>> get_sentiment_indicator(-0.3).hex_color
    '#D50000'
    >>> get_sentiment_indicator(0.0).color
    <SentimentColor.GRAY: 'gray'>
    """
    return _default_mapper.score_to_indicator(score)


def get_legend() -> List[Dict[str, str]]:
    """Return the colour legend used throughout the application."""
    return _default_mapper.get_legend()
