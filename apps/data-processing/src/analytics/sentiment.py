import logging
import os
import re
import unicodedata
from typing import Any, Dict, List, Optional, Set, Tuple

from vaderSentiment.vaderSentiment import (
    BOOSTER_DICT,
    NEGATE,
    SentimentIntensityAnalyzer,
)

from src.analytics.explanation import (
    LEXICON_FEATURE_KIND,
    MODEL_FEATURE_KIND,
    FeatureContribution,
    SentimentExplanation,
    empty_explanation,
    leave_one_out_explanation,
)

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

    When an explanation is requested (``explain=True``) the instance also
    carries an optional :class:`SentimentExplanation` describing which tokens
    drove the score.
    """

    language: str
    language_supported: bool
    language_unsupported: bool
    explanation: Optional[SentimentExplanation]

    def __new__(
        cls,
        value: float,
        language: str,
        language_supported: bool,
        language_unsupported: bool,
        explanation: Optional[SentimentExplanation] = None,
    ) -> "SentimentScore":
        instance = float.__new__(cls, value)
        instance.language = language
        instance.language_supported = language_supported
        instance.language_unsupported = language_unsupported
        instance.explanation = explanation
        return instance

    def to_dict(self) -> dict:
        data = {
            "score": float(self),
            "language": self.language,
            "language_supported": self.language_supported,
            "language_unsupported": self.language_unsupported,
        }
        if self.explanation is not None:
            data["explanation"] = self.explanation.to_dict()
        return data

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
        """VADER compound with the crypto-slang fallback (float only)."""
        score, _ = self._vader_english_explained(text, explain=False)
        return score

    def _vader_english_explained(
        self, text: str, explain: bool
    ) -> Tuple[float, Optional[SentimentExplanation]]:
        cleaned = text.lower()
        scores = self.analyzer.polarity_scores(cleaned)
        compound = float(scores.get("compound", 0.0))

        negative_matches = [
            word for word in self.negative_keywords_en if word in cleaned
        ]
        positive_matches = [
            word for word in self.positive_keywords_en if word in cleaned
        ]

        if compound == 0.0:
            if negative_matches:
                score = -0.4
                explanation = (
                    self._crypto_fallback_explanation(
                        score, negative_matches, positive_matches
                    )
                    if explain
                    else None
                )
                return score, explanation
            if positive_matches:
                score = 0.4
                explanation = (
                    self._crypto_fallback_explanation(
                        score, [], positive_matches
                    )
                    if explain
                    else None
                )
                return score, explanation
            if explain:
                return compound, empty_explanation("vader", compound)
            return compound, None

        if explain:
            explanation = self._explain_vader_leave_one_out(cleaned, compound)
        else:
            explanation = None
        return compound, explanation

    def _crypto_lexicon_polarity_dict(self) -> Dict[str, str]:
        polarity: Dict[str, str] = {}
        for word in self.positive_keywords_en:
            polarity[word] = "positive"
        for word in self.negative_keywords_en:
            polarity[word] = "negative"
        return polarity

    def _crypto_fallback_explanation(
        self,
        score: float,
        negative_matches: List[str],
        positive_matches: List[str],
    ) -> SentimentExplanation:
        """Explain the crypto-slang fallback that replaced a zero VADER score."""
        negative_took_precedence = bool(negative_matches)
        contributions: List[FeatureContribution] = []
        for word in negative_matches:
            contributions.append(FeatureContribution(
                token=word,
                contribution=score / len(negative_matches),
                feature=f"lexicon:crypto:negative:{word}",
                kind=LEXICON_FEATURE_KIND,
                note="crypto slang fallback for a zero VADER compound",
            ))
        for word in positive_matches:
            active = not negative_took_precedence
            contributions.append(FeatureContribution(
                token=word,
                contribution=(
                    (score / len(positive_matches)) if active else 0.0
                ),
                feature=f"lexicon:crypto:positive:{word}",
                kind=LEXICON_FEATURE_KIND,
                note=(
                    "crypto slang fallback for a zero VADER compound"
                    if active
                    else (
                        "matched but inactive: negative crypto entries take "
                        "precedence in the zero-compound fallback"
                    )
                ),
            ))
        return SentimentExplanation(
            method="vader+crypto_fallback",
            score=score,
            contributions=tuple(contributions),
        )

    def _vader_feature_for(self, token: str) -> Optional[Tuple[str, str]]:
        """Map a token to the lexicon entry responsible for its valence."""
        low = token.lower()
        if low in self.positive_keywords_en:
            return f"lexicon:crypto:positive:{low}", LEXICON_FEATURE_KIND
        if low in self.negative_keywords_en:
            return f"lexicon:crypto:negative:{low}", LEXICON_FEATURE_KIND
        if low in self.analyzer.lexicon:
            return f"lexicon:vader:{low}", LEXICON_FEATURE_KIND
        if low in BOOSTER_DICT:
            return f"lexicon:vader:booster:{low}", LEXICON_FEATURE_KIND
        if low in NEGATE:
            return f"lexicon:vader:negator:{low}", LEXICON_FEATURE_KIND
        return None

    def _pure_vader_compound(self, text: str) -> float:
        """Raw VADER compound without the crypto-slang fallback."""
        return float(
            self.analyzer.polarity_scores(text.lower()).get("compound", 0.0)
        )

    def _explain_vader_leave_one_out(
        self, cleaned: str, compound: float
    ) -> SentimentExplanation:
        """Decorrelate a non-zero VADER compound onto its driving tokens."""
        explanation = leave_one_out_explanation(
            method="vader",
            text=cleaned,
            base_score=compound,
            scorer=self._pure_vader_compound,
            feature_for=self._vader_feature_for,
            prioritize=tuple(self._crypto_lexicon_polarity_dict().keys()),
        )

        # Surface crypto slang entries that matched but could not move the
        # score (the fallback only fires when VADER's compound is exactly 0).
        resolved = {
            c.feature for c in explanation.contributions
        }
        inactive: List[FeatureContribution] = []
        for word, polarity in self._crypto_lexicon_polarity_dict().items():
            feature = f"lexicon:crypto:{polarity}:{word}"
            if word in cleaned and feature not in resolved:
                inactive.append(FeatureContribution(
                    token=word,
                    contribution=0.0,
                    feature=feature,
                    kind=LEXICON_FEATURE_KIND,
                    note=(
                        "matched but inactive: crypto fallback only applies "
                        "when the VADER compound is exactly 0"
                    ),
                ))
        explanation.contributions = explanation.contributions + tuple(inactive)
        return explanation

    def _explain_finbert(
        self, text: str, score: float
    ) -> SentimentExplanation:
        """Bounded leave-one-out attribution for the FinBERT path."""
        return leave_one_out_explanation(
            method="finbert",
            text=text,
            base_score=score,
            scorer=lambda t: self._finbert_compound(t) or 0.0,
            feature_for=lambda token: (
                f"model:finbert:{token.lower()}",
                MODEL_FEATURE_KIND,
            ),
            model=self._transformer_model_name,
            prioritize=tuple(self._crypto_lexicon_polarity_dict().keys()),
        )

    def analyze_text(
        self,
        text: Optional[str],
        lang_hint: Optional[str] = None,
        *,
        explain: bool = False,
    ) -> SentimentScore:
        """
        Analyze the sentiment of the given text.

        Args:
            text (str): Input text (headline or article)
            lang_hint (str, optional): Optional ISO language hint (e.g. "en", "es").
            explain (bool): When True, attach a per-token
                :class:`SentimentExplanation` to the returned score.  The
                explanation references the lexicon entry or model feature
                responsible for each contribution.  Off by default; when
                enabled it adds bounded leave-one-out work (see
                ``MAX_EXPLAIN_TOKENS`` and ``SENTIMENT_EXPLANATIONS.md``).

        Returns:
            SentimentScore: Float-like score with language metadata.
        """
        if not text or not isinstance(text, str):
            explanation = empty_explanation("none", 0.0) if explain else None
            return SentimentScore(0.0, "unknown", False, False, explanation)

        cleaned = text.strip()
        if not cleaned:
            explanation = empty_explanation("none", 0.0) if explain else None
            return SentimentScore(0.0, "unknown", False, False, explanation)

        language = self._resolve_language(cleaned, lang_hint)
        if language not in self.supported_languages:
            explanation = empty_explanation("none", 0.0) if explain else None
            return SentimentScore(0.0, language, False, True, explanation)

        if language == "en":
            score, explanation = self._analyze_english(cleaned, explain=explain)
        elif language == "es":
            score, explanation = self._keyword_sentiment_score(
                cleaned, self.positive_keywords_es, self.negative_keywords_es,
                lang=language, explain=explain,
            )
        else:
            score, explanation = self._keyword_sentiment_score(
                cleaned, self.positive_keywords_pt, self.negative_keywords_pt,
                lang=language, explain=explain,
            )

        return SentimentScore(score, language, True, False, explanation)

    def _analyze_english(
        self, text: str, explain: bool = False
    ) -> Tuple[float, Optional[SentimentExplanation]]:
        """Score English text, optionally explaining which tokens drove it."""
        finbert_score = self._finbert_compound(text)
        if finbert_score is not None:
            explanation = self._explain_finbert(text, finbert_score) if explain else None
            return finbert_score, explanation
        return self._vader_english_explained(text, explain)

    def _keyword_sentiment_score(
        self,
        text: str,
        positive_keywords: Set[str],
        negative_keywords: Set[str],
        lang: str = "en",
        explain: bool = False,
    ) -> Tuple[float, Optional[SentimentExplanation]]:
        normalized_text = self._normalize_text(text)
        positive_hits = sum(1 for word in positive_keywords if word in normalized_text)
        negative_hits = sum(1 for word in negative_keywords if word in normalized_text)

        total_hits = positive_hits + negative_hits
        if total_hits == 0:
            explanation = empty_explanation(f"keyword:{lang}", 0.0) if explain else None
            return 0.0, explanation

        score = (positive_hits - negative_hits) / total_hits
        score = max(-1.0, min(1.0, float(score)))

        if explain:
            contributions = []
            step = 1.0 / total_hits
            for word in positive_keywords:
                if word in normalized_text:
                    contributions.append(FeatureContribution(
                        token=word,
                        contribution=step,
                        feature=f"lexicon:{lang}:positive:{word}",
                        kind=LEXICON_FEATURE_KIND,
                    ))
            for word in negative_keywords:
                if word in normalized_text:
                    contributions.append(FeatureContribution(
                        token=word,
                        contribution=-step,
                        feature=f"lexicon:{lang}:negative:{word}",
                        kind=LEXICON_FEATURE_KIND,
                    ))
            explanation = SentimentExplanation(
                method=f"keyword:{lang}",
                score=score,
                contributions=tuple(contributions),
            )
        else:
            explanation = None

        return score, explanation

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
