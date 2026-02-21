import re
import unicodedata
from typing import Optional, Set

from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

try:
    from langdetect import DetectorFactory, LangDetectException, detect

    DetectorFactory.seed = 0
    LANGDETECT_AVAILABLE = True
except ImportError:
    LANGDETECT_AVAILABLE = False

    class LangDetectException(Exception):
        """Fallback exception when langdetect is unavailable."""


class SentimentScore(float):
    """
    Float sentiment score enriched with language metadata.
    """

    language: str
    language_supported: bool
    language_unsupported: bool

    def __new__(
        cls,
        value: float,
        language: str,
        language_supported: bool,
        language_unsupported: bool,
    ) -> "SentimentScore":
        instance = float.__new__(cls, value)
        instance.language = language
        instance.language_supported = language_supported
        instance.language_unsupported = language_unsupported
        return instance

    def to_dict(self) -> dict:
        return {
            "score": float(self),
            "language": self.language,
            "language_supported": self.language_supported,
            "language_unsupported": self.language_unsupported,
        }

    @property
    def score(self) -> float:
        return float(self)

    def __getitem__(self, key: str):
        return self.to_dict()[key]

    def get(self, key: str, default=None):
        return self.to_dict().get(key, default)


class SentimentAnalyzer:
    """
    Analyze sentiment of a given text using VADER.
    Returns a compound sentiment score between -1.0 and 1.0.
    """

    def __init__(self) -> None:
        self.analyzer = SentimentIntensityAnalyzer()
        self.supported_languages: Set[str] = {"en", "es", "pt"}

        self.negative_keywords_en = {
            "crash",
            "crashing",
            "dump",
            "bear",
            "plunge",
            "collapse",
        }
        self.positive_keywords_en = {
            "moon",
            "bull",
            "surge",
            "rally",
            "all time high",
            "ath",
        }

        # Lightweight keyword mapping for non-English sentiment support.
        self.positive_keywords_es = {
            "sube",
            "subida",
            "alza",
            "rally",
            "maximo historico",
            "alcista",
        }
        self.negative_keywords_es = {
            "cae",
            "caida",
            "baja",
            "desplome",
            "colapso",
            "bajista",
        }

        self.positive_keywords_pt = {
            "sobe",
            "alta",
            "rali",
            "maxima historica",
            "otimista",
            "altista",
        }
        self.negative_keywords_pt = {
            "cai",
            "queda",
            "baixa",
            "despenca",
            "colapso",
            "baixista",
        }

    def analyze_text(
        self, text: Optional[str], lang_hint: Optional[str] = None
    ) -> SentimentScore:
        """
        Analyze the sentiment of the given text.

        Args:
            text (str): Input text (headline or article)
            lang_hint (str, optional): Optional ISO language hint (e.g. "en", "es").

        Returns:
            SentimentScore: Float-like score with language metadata.
        """
        if not text or not isinstance(text, str):
            return SentimentScore(0.0, "unknown", False, False)

        cleaned = text.strip()
        if not cleaned:
            return SentimentScore(0.0, "unknown", False, False)

        language = self._resolve_language(cleaned, lang_hint)
        if language not in self.supported_languages:
            return SentimentScore(0.0, language, False, True)

        if language == "en":
            score = self._analyze_english(cleaned)
        elif language == "es":
            score = self._keyword_sentiment_score(
                cleaned, self.positive_keywords_es, self.negative_keywords_es
            )
        else:
            score = self._keyword_sentiment_score(
                cleaned, self.positive_keywords_pt, self.negative_keywords_pt
            )

        return SentimentScore(score, language, True, False)

    def _analyze_english(self, text: str) -> float:
        cleaned = text.lower()

        scores = self.analyzer.polarity_scores(cleaned)
        compound = float(scores.get("compound", 0.0))

        if compound == 0.0:
            if any(word in cleaned for word in self.negative_keywords_en):
                return -0.4
            if any(word in cleaned for word in self.positive_keywords_en):
                return 0.4

        return compound

    def _keyword_sentiment_score(
        self, text: str, positive_keywords: Set[str], negative_keywords: Set[str]
    ) -> float:
        normalized_text = self._normalize_text(text)
        positive_hits = sum(1 for word in positive_keywords if word in normalized_text)
        negative_hits = sum(1 for word in negative_keywords if word in normalized_text)

        total_hits = positive_hits + negative_hits
        if total_hits == 0:
            return 0.0

        score = (positive_hits - negative_hits) / total_hits
        return max(-1.0, min(1.0, float(score)))

    def _normalize_text(self, text: str) -> str:
        normalized = unicodedata.normalize("NFKD", text).encode("ascii", "ignore")
        ascii_text = normalized.decode("ascii")
        return re.sub(r"\s+", " ", ascii_text).strip().lower()

    def _resolve_language(self, text: str, lang_hint: Optional[str]) -> str:
        if lang_hint:
            return self._normalize_language_code(lang_hint)

        script_language = self._detect_script_language(text)
        if script_language:
            return script_language

        if LANGDETECT_AVAILABLE:
            try:
                detected = detect(text)
                return self._normalize_language_code(detected)
            except LangDetectException:
                pass

        return self._heuristic_language_detection(text)

    def _normalize_language_code(self, language: str) -> str:
        normalized = language.strip().lower().replace("_", "-")
        if not normalized:
            return "unknown"
        return normalized.split("-")[0]

    def _heuristic_language_detection(self, text: str) -> str:
        normalized_text = self._normalize_text(text)
        words = set(normalized_text.split())

        spanish_markers = {"sube", "caida", "mercado", "hoy", "alcista", "bajista"}
        portuguese_markers = {
            "sobe",
            "queda",
            "alta",
            "baixa",
            "mercado",
            "hoje",
            "altista",
            "baixista",
        }

        spanish_hits = len(words & spanish_markers)
        portuguese_hits = len(words & portuguese_markers)

        if spanish_hits > portuguese_hits and spanish_hits > 0:
            return "es"
        if portuguese_hits > spanish_hits and portuguese_hits > 0:
            return "pt"
        return "en"

    def _detect_script_language(self, text: str) -> Optional[str]:
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
