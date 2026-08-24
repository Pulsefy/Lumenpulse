import json
import logging
import os
import re
import unicodedata
from typing import Any, Dict, List, Optional, Set, Tuple

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

# Languages the analyzer can actually score (English via VADER/FinBERT,
# the rest via lightweight keyword lexicons).
SUPPORTED_LANGUAGES: Set[str] = {"en", "es", "pt", "zh"}

# Per-language keyword lexicons. English entries extend VADER's lexicon;
# es/pt/zh entries drive keyword scoring when no ML model is available.
POSITIVE_KEYWORDS: Dict[str, Set[str]] = {
    "en": {
        "moon",
        "bull",
        "surge",
        "rally",
        "all time high",
        "ath",
    },
    "es": {
        "sube",
        "subida",
        "alza",
        "rally",
        "maximo historico",
        "alcista",
    },
    "pt": {
        "sobe",
        "alta",
        "rali",
        "maxima historica",
        "otimista",
        "altista",
    },
    "zh": {
        "上涨",  # rising
        "大涨",  # big rise
        "飙升",  # soar
        "新高",  # new high
        "看涨",  # bullish
        "牛市",  # bull market
        "反弹",  # rebound
        "突破",  # breakout
        "利好",  # positive news
        "回升",  # recovery
        "走强",  # strengthening
        "盈利",  # profit
    },
}

NEGATIVE_KEYWORDS: Dict[str, Set[str]] = {
    "en": {
        "crash",
        "crashing",
        "dump",
        "bear",
        "plunge",
        "collapse",
    },
    "es": {
        "cae",
        "caida",
        "baja",
        "desplome",
        "colapso",
        "bajista",
    },
    "pt": {
        "cai",
        "queda",
        "baixa",
        "despenca",
        "colapso",
        "baixista",
    },
    "zh": {
        "下跌",  # falling
        "大跌",  # big drop
        "暴跌",  # plunge
        "崩盘",  # crash
        "看跌",  # bearish
        "熊市",  # bear market
        "抛售",  # sell-off
        "跌破",  # break below
        "利空",  # negative news
        "回落",  # pullback
        "走弱",  # weakening
        "亏损",  # loss
    },
}

# Default location of the labelled sentiment evaluation set used to report
# per-language accuracy (see ``evaluate_language_accuracy``).
_DEFAULT_LABELLED_SET_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..", "data", "sentiment_labelled_set.json"
)


# Thresholds used to map a compound score to a discrete label. These mirror
# the thresholds used by the legacy ``src/sentiment.py`` pipeline.
POSITIVE_THRESHOLD = 0.05
NEGATIVE_THRESHOLD = -0.05


def score_to_label(score: float) -> str:
    """Map a compound score in [-1, 1] to a positive/negative/neutral label."""
    if score >= POSITIVE_THRESHOLD:
        return "positive"
    if score <= NEGATIVE_THRESHOLD:
        return "negative"
    return "neutral"


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
            "score_reliable": self.score_reliable,
            "unscored": self.unscored,
        }

    @property
    def score(self) -> float:
        return float(self)

    @property
    def score_reliable(self) -> bool:
        """
        True when the score was computed with a method appropriate for the
        detected language. Unsupported or undetectable text is never reliable.
        """
        return (
            self.language in SUPPORTED_LANGUAGES
            and self.language_supported
            and not self.language_unsupported
        )

    @property
    def unscored(self) -> bool:
        """
        True when no sentiment score was produced (empty text or a detected
        language with no scoring support), as opposed to a confident-but-wrong
        score from an English model applied to non-English content.
        """
        return self.language_unsupported or self.language == "unknown"

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
    Spanish, Portuguese, and Chinese use lightweight keyword scoring.
    """

    def __init__(
        self,
        *,
        enable_transformer: Optional[bool] = None,
        transformer_model: Optional[str] = None,
    ) -> None:
        self.analyzer = SentimentIntensityAnalyzer()
        self.supported_languages: Set[str] = set(SUPPORTED_LANGUAGES)

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

        # English keyword hints extend VADER for crypto slang; the es/pt/zh
        # sets drive lightweight keyword scoring for non-English content.
        self.positive_keywords_en = POSITIVE_KEYWORDS["en"]
        self.negative_keywords_en = NEGATIVE_KEYWORDS["en"]
        self.positive_keywords_es = POSITIVE_KEYWORDS["es"]
        self.negative_keywords_es = NEGATIVE_KEYWORDS["es"]
        self.positive_keywords_pt = POSITIVE_KEYWORDS["pt"]
        self.negative_keywords_pt = NEGATIVE_KEYWORDS["pt"]
        self.positive_keywords_zh = POSITIVE_KEYWORDS["zh"]
        self.negative_keywords_zh = NEGATIVE_KEYWORDS["zh"]

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

    def detect_language(
        self, text: Optional[str], lang_hint: Optional[str] = None
    ) -> str:
        """
        Detect the language of a text before scoring.

        Detection order: explicit ``lang_hint`` → script detection (CJK,
        Cyrillic, …) → langdetect → keyword heuristics. Returns an ISO-639-1
        code (or "unknown" for empty input).
        """
        if not text or not isinstance(text, str):
            return "unknown"
        cleaned = text.strip()
        if not cleaned:
            return "unknown"
        return self._resolve_language(cleaned, lang_hint)

    def keyword_score(self, text: str, language: str) -> float:
        """
        Score text with the keyword lexicon for ``language`` (e.g. "es", "zh").

        Returns a value in [-1, 1] based on the ratio of positive to negative
        keyword hits, or 0.0 when the language has no lexicon.
        """
        positive = POSITIVE_KEYWORDS.get(language)
        negative = NEGATIVE_KEYWORDS.get(language)
        if not positive or not negative:
            return 0.0
        return self._keyword_sentiment_score(text, positive, negative)

    def analyze_text(
        self, text: Optional[str], lang_hint: Optional[str] = None
    ) -> SentimentScore:
        """
        Analyze the sentiment of the given text.

        Language is detected before scoring and recorded on the result. Content
        in a detected-but-unsupported language is marked as unscored rather
        than being scored by the English model.

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

        language = self.detect_language(cleaned, lang_hint)
        if language not in self.supported_languages:
            return SentimentScore(0.0, language, False, True)

        if language == "en":
            score = self._analyze_english(cleaned)
        elif language == "es":
            score = self.keyword_score(cleaned, "es")
        elif language == "pt":
            score = self.keyword_score(cleaned, "pt")
        else:
            score = self.keyword_score(cleaned, "zh")

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

    @staticmethod
    def _is_cjk(ch: str) -> bool:
        """Return True for CJK ideographs, CJK punctuation, and full-width forms."""
        code = ord(ch)
        return (
            0x4E00 <= code <= 0x9FFF  # CJK Unified Ideographs
            or 0x3400 <= code <= 0x4DBF  # Extension A
            or 0xF900 <= code <= 0xFAFF  # Compatibility Ideographs
            or 0x3000 <= code <= 0x303F  # CJK punctuation
            or 0xFF00 <= code <= 0xFFEF  # Full-width forms
        )

    def _normalize_text(self, text: str) -> str:
        """ASCII-fold Latin text (accents, case) while preserving CJK characters."""
        normalized = unicodedata.normalize("NFKD", text)
        kept = [ch for ch in normalized if ord(ch) < 128 or self._is_cjk(ch)]
        cleaned = "".join(kept)
        return re.sub(r"\s+", " ", cleaned).strip().lower()

    def _resolve_language(self, text: str, lang_hint: Optional[str]) -> str:
        if lang_hint:
            return self._normalize_language_code(lang_hint)

        script_language = self._detect_script_language(text)
        if script_language:
            return script_language

        if LANGDETECT_AVAILABLE:
            try:
                detected = detect(text)
                normalized = self._normalize_language_code(detected)
                # langdetect returns "und" for undetectable input; fall
                # through to the keyword heuristic instead of trusting it.
                if normalized in ("und", "unknown"):
                    return self._heuristic_language_detection(text)
                # Short Spanish/Portuguese texts are frequently misdetected
                # by langdetect (fr/it/no/...). Prefer an explicit marker
                # match over an unsupported-language guess so we never hand
                # non-English content to the English scorer by accident.
                heuristic = self._heuristic_language_detection(text)
                if normalized not in SUPPORTED_LANGUAGES and heuristic in (
                    "es",
                    "pt",
                ):
                    return heuristic
                return normalized
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


def evaluate_language_accuracy(
    labelled_set_path: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Report per-language sentiment accuracy against the labelled set.

    The labelled set is a JSON file of the form:

    .. code-block:: json

        {
          "meta": {"languages": ["en", "es", ...]},
          "samples": [
            {"text": "...", "language": "en", "label": "positive"}
          ]
        }

    For supported languages the predicted label (positive/negative/neutral)
    is compared with the labelled label. Samples whose language is unsupported
    count as correct when the analyzer marks them unscored instead of guessing.

    Returns:
        A report dict with overall and per-language accuracy statistics.
    """
    path = labelled_set_path or _DEFAULT_LABELLED_SET_PATH
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)

    samples = data.get("samples", [])
    analyzer = SentimentAnalyzer(enable_transformer=False)

    per_language: Dict[str, Dict[str, Any]] = {}
    total = 0
    correct = 0
    unscored_correct = 0

    for sample in samples:
        text = sample.get("text", "")
        language = sample.get("language", "unknown")
        expected_label = sample.get("label", "neutral")

        score = analyzer.analyze_text(text)

        bucket = per_language.setdefault(
            language,
            {
                "samples": 0,
                "correct": 0,
                "unscored": 0,
                "predicted": {},
            },
        )
        bucket["samples"] += 1

        if language not in SUPPORTED_LANGUAGES:
            # Unsupported content must be marked unscored, not mis-scored.
            if score.unscored and not score.score_reliable:
                bucket["correct"] += 1
                unscored_correct += 1
            bucket["unscored"] += 1
            total += 1
            correct += 1 if score.unscored and not score.score_reliable else 0
            continue

        predicted_label = score_to_label(score.score)
        bucket["predicted"][predicted_label] = (
            bucket["predicted"].get(predicted_label, 0) + 1
        )
        total += 1
        if predicted_label == expected_label:
            bucket["correct"] += 1
            correct += 1

    language_mismatches: List[Dict[str, Any]] = []
    for s in samples:
        detected = analyzer.detect_language(s.get("text", ""))
        labelled = s.get("language")
        if detected not in (labelled, "unknown"):
            language_mismatches.append(
                {
                    "text": s.get("text", "")[:80],
                    "labelled_language": labelled,
                    "detected_language": detected,
                }
            )

    report: Dict[str, Any] = {
        "source": path,
        "total_samples": total,
        "correct": correct,
        "accuracy": round(correct / total, 4) if total else 0.0,
        "unscored_correct": unscored_correct,
        "detected_vs_labelled_language_mismatches": language_mismatches[:50],
        "per_language": {},
    }

    for language, bucket in sorted(per_language.items()):
        count = bucket["samples"]
        report["per_language"][language] = {
            "samples": count,
            "correct": bucket["correct"],
            "accuracy": round(bucket["correct"] / count, 4) if count else 0.0,
            "unscored": bucket["unscored"],
            "predicted_labels": bucket.get("predicted"),
        }

    report["languages_evaluated"] = sorted(report["per_language"].keys())
    return report
