import logging
import os
import re
import unicodedata
from typing import Any, Dict, Optional, Set, Tuple

from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

try:
    from langdetect import DetectorFactory, LangDetectException, detect

    DetectorFactory.seed = 0
    LANGDETECT_AVAILABLE = True
except ImportError:
    LANGDETECT_AVAILABLE = False

    class LangDetectException(Exception):
        """Fallback exception when langdetect is unavailable."""

logger = logging.getLogger(__name__)

_DEFAULT_FINBERT_MODEL = "ProsusAI/finbert"


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


def _env_flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in ("1", "true", "yes", "on")


class SentimentAnalyzer:
    """
    Analyze sentiment using a financial FinBERT model for English when available,
    with VADER (and crypto keyword hints) as fallback if transformers fail or are disabled.
    Spanish and Portuguese use lightweight keyword scoring.
    """

    def __init__(
        self,
        *,
        enable_transformer: Optional[bool] = None,
        transformer_model: Optional[str] = None,
    ) -> None:
        self.analyzer = SentimentIntensityAnalyzer()
        self.supported_languages: Set[str] = {"en", "es", "pt"}

        env_off = _env_flag("SENTIMENT_DISABLE_TRANSFORMER")
        if enable_transformer is None:
            self._transformer_enabled = not env_off
        else:
            self._transformer_enabled = bool(enable_transformer) and not env_off

        self._transformer_model_name = (
            transformer_model
            or os.environ.get("SENTIMENT_TRANSFORMER_MODEL", _DEFAULT_FINBERT_MODEL).strip()
            or _DEFAULT_FINBERT_MODEL
        )

        self._transformer_model: Any = None
        self._transformer_tokenizer: Any = None
        self._transformer_load_failed = False

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

    def _load_transformer(self) -> bool:
        if not self._transformer_enabled or self._transformer_load_failed:
            return False
        if self._transformer_model is not None:
            return True
        try:
            from transformers import AutoModelForSequenceClassification, AutoTokenizer

            model_name = self._transformer_model_name
            self._transformer_tokenizer = AutoTokenizer.from_pretrained(model_name)
            self._transformer_model = AutoModelForSequenceClassification.from_pretrained(
                model_name
            )
            self._transformer_model.eval()
            logger.info("Loaded transformer sentiment model: %s", model_name)
            return True
        except Exception as e:
            logger.warning(
                "Transformer sentiment unavailable, using VADER fallback: %s", e
            )
            self._transformer_load_failed = True
            return False

    def _finbert_compound(self, text: str) -> Optional[float]:
        if not self._load_transformer():
            return None
        try:
            import torch

            inputs = self._transformer_tokenizer(
                text,
                return_tensors="pt",
                truncation=True,
                max_length=512,
                padding=True,
            )
            with torch.no_grad():
                logits = self._transformer_model(**inputs).logits
            probs = torch.softmax(logits, dim=-1)[0]

            id2label = self._transformer_model.config.id2label
            pos_idx: Optional[int] = None
            neg_idx: Optional[int] = None
            for key, label in id2label.items():
                idx = int(key) if not isinstance(key, int) else key
                low = str(label).lower()
                if low == "positive":
                    pos_idx = idx
                elif low == "negative":
                    neg_idx = idx
            if pos_idx is None or neg_idx is None:
                return None

            p_pos = float(probs[pos_idx].item())
            p_neg = float(probs[neg_idx].item())
            return max(-1.0, min(1.0, p_pos - p_neg))
        except Exception as e:
            logger.warning("FinBERT inference failed, falling back to VADER: %s", e)
            return None

    def _vader_english_compound(self, text: str) -> float:
        cleaned = text.lower()
        scores = self.analyzer.polarity_scores(cleaned)
        compound = float(scores.get("compound", 0.0))

        if compound == 0.0:
            if any(word in cleaned for word in self.negative_keywords_en):
                return -0.4
            if any(word in cleaned for word in self.positive_keywords_en):
                return 0.4

        return compound

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
        finbert_score = self._finbert_compound(text)
        if finbert_score is not None:
            return finbert_score
        return self._vader_english_compound(text)

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


def benchmark_vader_vs_transformer(
    texts: Tuple[str, ...],
) -> Tuple[Dict[str, Tuple[float, Optional[float]]], Dict[str, Any]]:
    """
    Run the same English headlines through VADER-only and FinBERT paths.

    Returns:
        (per_text_scores, summary) where each value is (vader_compound, transformer_compound).
        transformer_compound is None if the model could not be loaded or inference failed.
    """
    vader_analyzer = SentimentAnalyzer(enable_transformer=False)
    full_analyzer = SentimentAnalyzer(enable_transformer=True)

    rows: Dict[str, Tuple[float, Optional[float]]] = {}
    tf_ok = 0
    agreement = 0
    n = 0

    for raw in texts:
        t = raw.strip()
        if not t:
            continue
        v = vader_analyzer._vader_english_compound(t)
        tf = full_analyzer._finbert_compound(t)
        rows[t] = (v, tf)
        n += 1
        if tf is not None:
            tf_ok += 1
            if (v >= 0) == (tf >= 0):
                agreement += 1

    summary = {
        "samples": n,
        "transformer_inferences_ok": tf_ok,
        "sign_agreement_with_vader": agreement,
        "sign_agreement_rate": (agreement / tf_ok) if tf_ok else 0.0,
    }
    return rows, summary
