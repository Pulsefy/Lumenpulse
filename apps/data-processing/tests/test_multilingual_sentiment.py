"""
Unit tests for multilingual sentiment analysis and text normalization.
Tests sentiment analysis on non-English articles with language detection,
translation, and normalization capabilities.
"""

import unittest
from unittest.mock import Mock, patch
import os

from src.sentiment import (
    SentimentAnalyzer,
    SentimentResult,
    _normalize_text,
    _normalize_language_code,
    _detect_language,
    _detect_script_language,
    TranslationService,
)


class TestTextNormalization(unittest.TestCase):
    """Test text normalization for multilingual content."""

    def test_normalize_text_removes_extra_whitespace(self):
        """Test that normalization removes extra whitespace."""
        text = "  Bitcoin   news   today  \n\n  extra spaces  "
        normalized = _normalize_text(text)
        self.assertEqual(normalized, "Bitcoin news today extra spaces")

    def test_normalize_text_handles_unicode_normalization(self):
        """Test that Unicode is properly normalized."""
        text = "Cripto\u00a0noticias"  # Contains non-breaking space
        normalized = _normalize_text(text)
        self.assertNotIn("\u00a0", normalized)
        self.assertIn("Cripto", normalized)
        self.assertIn("noticias", normalized)

    def test_normalize_language_code_extracts_base_language(self):
        """Test language code normalization."""
        self.assertEqual(_normalize_language_code("en_US"), "en")
        self.assertEqual(_normalize_language_code("en-US"), "en")
        self.assertEqual(_normalize_language_code("es"), "es")
        self.assertEqual(_normalize_language_code("ES"), "es")
        self.assertEqual(_normalize_language_code("pt_BR"), "pt")

    def test_normalize_language_code_handles_invalid(self):
        """Test language code normalization with invalid input."""
        self.assertEqual(_normalize_language_code(None), "unknown")
        self.assertEqual(_normalize_language_code(""), "unknown")
        self.assertEqual(_normalize_language_code("   "), "unknown")


class TestScriptLanguageDetection(unittest.TestCase):
    """Test script-based language detection for non-Latin scripts."""

    def test_detect_chinese(self):
        """Test detection of Chinese script."""
        text = "这是一个测试"  # Chinese
        result = _detect_script_language(text)
        self.assertEqual(result, "zh")

    def test_detect_japanese(self):
        """Test detection of Japanese script."""
        text = "これはテストです"  # Japanese hiragana
        result = _detect_script_language(text)
        self.assertEqual(result, "ja")

    def test_detect_korean(self):
        """Test detection of Korean script."""
        text = "이것은 테스트입니다"  # Korean
        result = _detect_script_language(text)
        self.assertEqual(result, "ko")

    def test_detect_russian(self):
        """Test detection of Russian script."""
        text = "Это тестовый текст"  # Russian
        result = _detect_script_language(text)
        self.assertEqual(result, "ru")

    def test_detect_arabic(self):
        """Test detection of Arabic script."""
        text = "هذا نص تجريبي"  # Arabic
        result = _detect_script_language(text)
        self.assertEqual(result, "ar")

    def test_detect_latin_script_returns_none(self):
        """Test that Latin script returns None (requires detection)."""
        text = "This is English text"
        result = _detect_script_language(text)
        self.assertIsNone(result)


class TestLanguageDetection(unittest.TestCase):
    """Test language detection from text content."""

    def test_detect_language_with_hint(self):
        """Test language detection uses provided hint."""
        text = "Some text"
        result = _detect_language(text, hint="es")
        self.assertEqual(result, "es")

    def test_detect_language_from_script(self):
        """Test language detection from script."""
        text = "这是中文"  # Chinese
        result = _detect_language(text)
        self.assertEqual(result, "zh")

    def test_detect_language_defaults_to_english(self):
        """Test that unknown content defaults to English."""
        text = "abc xyz"
        result = _detect_language(text)
        self.assertEqual(result, "en")


class TestMultilingualSentimentAnalysis(unittest.TestCase):
    """Test sentiment analysis on multilingual content."""

    def setUp(self):
        self.analyzer = SentimentAnalyzer()

    def test_english_sentiment_analysis(self):
        """Test English sentiment analysis."""
        result = self.analyzer.analyze("Bitcoin is soaring to the moon!")
        self.assertEqual(result.language, "en")
        self.assertGreater(result.compound_score, 0)

    def test_spanish_sentiment_analysis(self):
        """Test Spanish sentiment analysis."""
        result = self.analyzer.analyze("Bitcoin sube con fuerte rally")
        self.assertEqual(result.language, "es")
        self.assertGreater(result.compound_score, 0)

    def test_portuguese_sentiment_analysis(self):
        """Test Portuguese sentiment analysis."""
        result = self.analyzer.analyze("Bitcoin sobe em alta no mercado")
        self.assertEqual(result.language, "pt")
        self.assertGreater(result.compound_score, 0)

    def test_sentiment_result_includes_language_metadata(self):
        """Test that sentiment results include language and translation info."""
        result = self.analyzer.analyze("Bitcoin is rising")
        self.assertIsInstance(result, SentimentResult)
        self.assertIsNotNone(result.language)
        self.assertIsNotNone(result.translated)
        self.assertFalse(result.translated)  # English should not be translated

    def test_analyze_batch_with_mixed_languages(self):
        """Test batch analysis with mixed language content."""
        texts = [
            "Bitcoin is crashing",  # English
            "Bitcoin sube rápidamente",  # Spanish
            "Bitcoin está caindo",  # Portuguese
        ]
        results = self.analyzer.analyze_batch(texts)
        self.assertEqual(len(results), 3)
        languages = [r.language for r in results]
        self.assertIn("en", languages)
        self.assertIn("es", languages)
        self.assertIn("pt", languages)

    def test_sentiment_result_to_dict(self):
        """Test that SentimentResult properly serializes to dict."""
        result = self.analyzer.analyze("Bitcoin rises")
        result_dict = result.to_dict()
        self.assertIn("language", result_dict)
        self.assertIn("translated", result_dict)
        self.assertIn("compound_score", result_dict)
        self.assertIn("sentiment_label", result_dict)


class TestTranslationService(unittest.TestCase):
    """Test the TranslationService for text translation."""

    def setUp(self):
        self.service = TranslationService()

    def test_translation_disabled_by_default(self):
        """Test that translation is optional and doesn't crash if model unavailable."""
        # Should not raise, just return None
        result = self.service.translate("Hola mundo")
        # Result can be None if model not available
        self.assertTrue(result is None or isinstance(result, str))

    def test_translation_service_environment_variable(self):
        """Test translation service respects environment variables."""
        # Test that TRANSLATION_DISABLE_MODEL works
        original = os.environ.get("TRANSLATION_DISABLE_MODEL")
        try:
            os.environ["TRANSLATION_DISABLE_MODEL"] = "true"
            service = TranslationService()
            result = service.translate("test")
            self.assertIsNone(result)
        finally:
            if original:
                os.environ["TRANSLATION_DISABLE_MODEL"] = original
            else:
                os.environ.pop("TRANSLATION_DISABLE_MODEL", None)

    def test_empty_text_returns_none(self):
        """Test translation of empty text."""
        result = self.service.translate("")
        self.assertIsNone(result)

    def test_translation_disabled_returns_none(self):
        """Test that disabled translation service returns None."""
        service = TranslationService()
        service._translation_disabled = True
        result = service.translate("Test text")
        self.assertIsNone(result)


class TestMultilingualNormalizationPipeline(unittest.TestCase):
    """Integration tests for the full multilingual normalization pipeline."""

    def setUp(self):
        self.analyzer = SentimentAnalyzer()

    def test_pipeline_normalizes_spanish_article(self):
        """Test full pipeline on Spanish content."""
        spanish_text = "   Bitcoin   está   en   aumento   hoy!   "
        result = self.analyzer.analyze(spanish_text)
        self.assertEqual(result.language, "es")
        self.assertIsNotNone(result.compound_score)
        self.assertIsInstance(result.text, str)

    def test_pipeline_handles_mixed_scripts(self):
        """Test pipeline with text containing mixed scripts."""
        mixed_text = "Bitcoin 比特币 is rising"
        result = self.analyzer.analyze(mixed_text)
        self.assertIsNotNone(result.language)
        self.assertIsNotNone(result.compound_score)

    def test_pipeline_preserves_asset_detection_after_translation(self):
        """Test that asset codes are still detected after translation."""
        text = "Bitcoin y Ethereum suben juntos"
        result = self.analyzer.analyze(text)
        # Asset extraction happens on normalized text
        self.assertIsNotNone(result.asset_codes)

    def test_batch_parallel_with_multilingual_content(self):
        """Test parallel batch analysis with multilingual content."""
        texts = [
            "Bitcoin is amazing" * 100,  # English, long
            "Bitcoin es increíble" * 100,  # Spanish, long
            "Bitcoin é incrível" * 100,  # Portuguese, long
        ]
        results = self.analyzer.analyze_batch_parallel(texts)
        self.assertEqual(len(results), 3)
        for result in results:
            self.assertIsNotNone(result.language)
            self.assertIsNotNone(result.compound_score)
            self.assertIsNotNone(result.translated)


if __name__ == "__main__":
    unittest.main()
