"""
Property-based tests for data validation protocol invariants.

These tests ensure that the data validation system maintains its core
invariant properties regardless of input data, preventing protocol violations.
"""

import pytest
from hypothesis import given, strategies as st, assume
from typing import Dict, Any, Optional
import sys
import os
from datetime import datetime
import json

# Add src directory to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "src"))

from validators import validate_news_article, validate_onchain_metric, NewsArticle, OnChainMetric


class TestNewsArticleValidationInvariants:
    """Property-based tests for NewsArticle validation protocol invariants."""
    
    @given(
        id_str=st.text(min_size=1, max_size=50),
        title=st.text(min_size=1, max_size=200),
        content=st.text(min_size=1, max_size=1000),
        published_at=st.text(min_size=1, max_size=50),
        source=st.text(min_size=1, max_size=100),
        url=st.text(min_size=1, max_size=200)
    )
    def test_valid_news_article_acceptance_invariant(
        self, id_str, title, content, published_at, source, url
    ):
        """
        INVARIANT: Valid news articles with all required fields should always be accepted.
        
        The validation protocol must accept any article with properly formatted
        required fields, regardless of content.
        """
        data = {
            "id": id_str,
            "title": title,
            "content": content,
            "published_at": published_at,
            "source": source,
            "url": url
        }
        
        result = validate_news_article(data)
        
        # Should not be None for valid data
        assert result is not None, f"Valid news article was rejected: {data}"
        
        # Should have correct types
        assert isinstance(result, NewsArticle), f"Expected NewsArticle, got {type(result)}"
        assert isinstance(result.id, str), f"ID should be string, got {type(result.id)}"
        assert isinstance(result.title, str), f"Title should be string, got {type(result.title)}"
        assert isinstance(result.content, str), f"Content should be string, got {type(result.content)}"
        assert isinstance(result.published_at, str), f"Published_at should be string, got {type(result.published_at)}"
        
        # Should preserve values
        assert result.id == id_str, f"ID mismatch: {result.id} != {id_str}"
        assert result.title == title, f"Title mismatch: {result.title} != {title}"
        assert result.content == content, f"Content mismatch"
    
    @given(
        id_str=st.text(min_size=1, max_size=50),
        title=st.text(min_size=1, max_size=200),
        content=st.text(min_size=1, max_size=1000),
        source=st.text(min_size=1, max_size=100),
        url=st.text(min_size=1, max_size=200)
    )
    def test_missing_required_field_rejection_invariant(
        self, id_str, title, content, source, url
    ):
        """
        INVARIANT: News articles missing required fields must always be rejected.
        
        The validation protocol must reject any article missing required fields
        to maintain data integrity invariants.
        """
        # Test missing published_at (required field)
        data_missing_published = {
            "id": id_str,
            "title": title,
            "content": content,
            "source": source,
            "url": url
            # Missing published_at
        }
        
        result = validate_news_article(data_missing_published)
        assert result is None, "Article missing published_at should be rejected"
        
        # Test missing id (required field)
        data_missing_id = {
            "title": title,
            "content": content,
            "published_at": "2024-01-01T00:00:00Z",
            "source": source,
            "url": url
            # Missing id
        }
        
        result = validate_news_article(data_missing_id)
        assert result is None, "Article missing id should be rejected"
        
        # Test missing title (required field)
        data_missing_title = {
            "id": id_str,
            "content": content,
            "published_at": "2024-01-01T00:00:00Z",
            "source": source,
            "url": url
            # Missing title
        }
        
        result = validate_news_article(data_missing_title)
        assert result is None, "Article missing title should be rejected"
    
    @given(
        id_str=st.text(min_size=1, max_size=50),
        title=st.text(min_size=1, max_size=200),
        content=st.text(min_size=1, max_size=1000),
        published_at=st.text(min_size=1, max_size=50),
        source=st.text(min_size=1, max_size=100),
        url=st.text(min_size=1, max_size=200)
    )
    def test_wrong_type_rejection_invariant(
        self, id_str, title, content, published_at, source, url
    ):
        """
        INVARIANT: News articles with wrong field types must always be rejected.
        
        The validation protocol must enforce type invariants to maintain
        data structure integrity.
        """
        # Test wrong type for title (should be string)
        data_wrong_title_type = {
            "id": id_str,
            "title": 123,  # Wrong type
            "content": content,
            "published_at": published_at,
            "source": source,
            "url": url
        }
        
        result = validate_news_article(data_wrong_title_type)
        assert result is None, "Article with wrong title type should be rejected"
        
        # Test wrong type for content (should be string)
        data_wrong_content_type = {
            "id": id_str,
            "title": title,
            "content": ["not", "a", "string"],  # Wrong type
            "published_at": published_at,
            "source": source,
            "url": url
        }
        
        result = validate_news_article(data_wrong_content_type)
        assert result is None, "Article with wrong content type should be rejected"
        
        # Test wrong type for published_at (should be string)
        data_wrong_published_type = {
            "id": id_str,
            "title": title,
            "content": content,
            "published_at": 1234567890,  # Wrong type
            "source": source,
            "url": url
        }
        
        result = validate_news_article(data_wrong_published_type)
        assert result is None, "Article with wrong published_at type should be rejected"
    
    @given(
        id_str=st.text(min_size=1, max_size=50),
        title=st.text(min_size=1, max_size=100),
        content=st.text(min_size=1, max_size=1000),
        source=st.text(min_size=0, max_size=100),
        url=st.text(min_size=0, max_size=500)
    )
    def test_empty_string_rejection_invariant(self, id_str, title, content, source, url):
        """
        INVARIANT: Empty strings for validated fields should be rejected.
        
        The validation protocol must reject empty required fields
        to maintain data quality invariants.
        """
        # Test with empty published_at (this field has validation)
        data_empty_published_at = {
            "id": id_str,
            "title": title,
            "content": content,
            "published_at": "",  # Empty string - should be rejected
            "source": source,
            "url": url
        }
        
        result = validate_news_article(data_empty_published_at)
        assert result is None, "Article with empty published_at should be rejected"
    
    @given(st.dictionaries(keys=st.text(min_size=1, max_size=20), values=st.text(), min_size=1, max_size=5))
    def test_extra_fields_handling_invariant(self, extra_dict):
        """
        INVARIANT: Extra fields should be ignored, not cause rejection.
        
        The validation protocol should be robust to additional fields while
        maintaining core validation invariants.
        """
        # Build dict with guaranteed required fields
        data_dict = {
            "id": "test-id",
            "title": "Test Title",
            "content": "Test Content",
            "published_at": "2024-01-01T00:00:00Z",
            "source": "Test Source",
            "url": "https://example.com"
        }
        
        # Add generated extra fields
        data_dict.update(extra_dict)
        
        result = validate_news_article(data_dict)
        
        # Should still be valid despite extra fields
        assert result is not None, "Valid article with extra fields should be accepted"
        assert isinstance(result, NewsArticle)
        assert result.id == "test-id"


class TestOnChainMetricValidationInvariants:
    """Property-based tests for OnChainMetric validation protocol invariants."""
    
    @given(
        metric_id=st.text(min_size=1, max_size=50),
        value=st.floats(min_value=-1e10, max_value=1e10),
        timestamp=st.text(min_size=1, max_size=50),
        chain=st.text(min_size=1, max_size=50)
    )
    def test_valid_onchain_metric_acceptance_invariant(
        self, metric_id, value, timestamp, chain
    ):
        """
        INVARIANT: Valid on-chain metrics with all required fields should always be accepted.
        
        The validation protocol must accept any metric with properly formatted
        required fields, regardless of values.
        """
        data = {
            "metric_id": metric_id,
            "value": value,
            "timestamp": timestamp,
            "chain": chain
        }
        
        result = validate_onchain_metric(data)
        
        # Should not be None for valid data
        assert result is not None, f"Valid on-chain metric was rejected: {data}"
        
        # Should have correct types
        assert isinstance(result, OnChainMetric), f"Expected OnChainMetric, got {type(result)}"
        assert isinstance(result.metric_id, str), f"metric_id should be string, got {type(result.metric_id)}"
        assert isinstance(result.value, float), f"value should be float, got {type(result.value)}"
        assert isinstance(result.timestamp, str), f"timestamp should be string, got {type(result.timestamp)}"
        assert isinstance(result.chain, str), f"chain should be string, got {type(result.chain)}"
        
        # Should preserve values
        assert result.metric_id == metric_id, f"metric_id mismatch"
        assert result.value == value, f"value mismatch"
        assert result.timestamp == timestamp, f"timestamp mismatch"
        assert result.chain == chain, f"chain mismatch"
    
    @given(
        metric_id=st.text(min_size=1, max_size=50),
        value=st.floats(min_value=-1e10, max_value=1e10),
        timestamp=st.text(min_size=1, max_size=50),
        chain=st.text(min_size=1, max_size=50)
    )
    def test_missing_required_field_rejection_invariant(
        self, metric_id, value, timestamp, chain
    ):
        """
        INVARIANT: On-chain metrics missing required fields must always be rejected.
        
        The validation protocol must reject any metric missing required fields
        to maintain data integrity invariants.
        """
        # Test missing metric_id
        data_missing_id = {
            "value": value,
            "timestamp": timestamp,
            "chain": chain
            # Missing metric_id
        }
        
        result = validate_onchain_metric(data_missing_id)
        assert result is None, "Metric missing metric_id should be rejected"
        
        # Test missing value
        data_missing_value = {
            "metric_id": metric_id,
            "timestamp": timestamp,
            "chain": chain
            # Missing value
        }
        
        result = validate_onchain_metric(data_missing_value)
        assert result is None, "Metric missing value should be rejected"
        
        # Test missing timestamp
        data_missing_timestamp = {
            "metric_id": metric_id,
            "value": value,
            "chain": chain
            # Missing timestamp
        }
        
        result = validate_onchain_metric(data_missing_timestamp)
        assert result is None, "Metric missing timestamp should be rejected"
        
        # Test missing chain
        data_missing_chain = {
            "metric_id": metric_id,
            "value": value,
            "timestamp": timestamp
            # Missing chain
        }
        
        result = validate_onchain_metric(data_missing_chain)
        assert result is None, "Metric missing chain should be rejected"
    
    @given(
        metric_id=st.text(min_size=1, max_size=50),
        value=st.floats(min_value=-1e10, max_value=1e10),
        timestamp=st.text(min_size=1, max_size=50),
        chain=st.text(min_size=1, max_size=50)
    )
    def test_wrong_type_rejection_invariant(
        self, metric_id, value, timestamp, chain
    ):
        """
        INVARIANT: On-chain metrics with wrong field types must always be rejected.
        
        The validation protocol must enforce type invariants to maintain
        data structure integrity.
        """
        # Test wrong type for value (should be float)
        data_wrong_value_type = {
            "metric_id": metric_id,
            "value": "not-a-float",  # Wrong type
            "timestamp": timestamp,
            "chain": chain
        }
        
        result = validate_onchain_metric(data_wrong_value_type)
        assert result is None, "Metric with wrong value type should be rejected"
        
        # Test wrong type for metric_id (should be string)
        data_wrong_id_type = {
            "metric_id": 123,  # Wrong type
            "value": value,
            "timestamp": timestamp,
            "chain": chain
        }
        
        result = validate_onchain_metric(data_wrong_id_type)
        assert result is None, "Metric with wrong metric_id type should be rejected"
        
        # Test wrong type for timestamp (should be string)
        data_wrong_timestamp_type = {
            "metric_id": metric_id,
            "value": value,
            "timestamp": 1234567890,  # Wrong type
            "chain": chain
        }
        
        result = validate_onchain_metric(data_wrong_timestamp_type)
        assert result is None, "Metric with wrong timestamp type should be rejected"
    
    @given(
        metric_id=st.text(min_size=1, max_size=50),
        value=st.floats(min_value=-1e10, max_value=1e10),
        timestamp=st.text(min_size=1, max_size=50),
        chain=st.text(min_size=1, max_size=50),
        extra_data=st.dictionaries(keys=st.text(), values=st.text(), min_size=1, max_size=5)
    )
    def test_optional_field_handling_invariant(
        self, metric_id, value, timestamp, chain, extra_data
    ):
        """
        INVARIANT: Optional fields should be handled correctly.
        
        The validation protocol should properly handle optional fields
        while maintaining core validation invariants.
        """
        # Test with extra field
        data_with_extra = {
            "metric_id": metric_id,
            "value": value,
            "timestamp": timestamp,
            "chain": chain,
            "extra": extra_data
        }
        
        result = validate_onchain_metric(data_with_extra)
        
        # Should be valid with extra field
        assert result is not None, "Metric with valid extra field should be accepted"
        assert result.extra == extra_data, "Extra field should be preserved"
        
        # Test without extra field
        data_without_extra = {
            "metric_id": metric_id,
            "value": value,
            "timestamp": timestamp,
            "chain": chain
        }
        
        result = validate_onchain_metric(data_without_extra)
        
        # Should be valid without extra field
        assert result is not None, "Metric without extra field should be accepted"
        assert result.extra is None, "Extra field should be None when not provided"


class TestValidationRobustnessInvariants:
    """Property-based tests for validation system robustness invariants."""
    
    @given(st.dictionaries(keys=st.text(), values=st.text(), min_size=0, max_size=20))
    def test_malformed_data_handling_invariant(self, data_dict):
        """
        INVARIANT: Validation should handle malformed data gracefully without crashes.
        
        The validation protocol must be robust against various forms of
        malformed input while maintaining system stability.
        """
        # Test various malformed inputs that shouldn't crash
        malformed_inputs = [
            {},  # Empty dict
            None,  # None value
            "not-a-dict",  # Wrong type
            [],  # List instead of dict
            123,  # Number instead of dict
        ]
        
        for malformed_input in malformed_inputs:
            try:
                # Should not raise exceptions
                news_result = validate_news_article(malformed_input)
                metric_result = validate_onchain_metric(malformed_input)
                
                # Should return None for invalid data
                if malformed_input in [None, "not-a-dict", [], 123]:
                    assert news_result is None, f"Invalid input {malformed_input} should return None"
                    assert metric_result is None, f"Invalid input {malformed_input} should return None"
                    
            except Exception as e:
                pytest.fail(f"Validation crashed on malformed input {malformed_input}: {e}")
    
    @given(st.text(min_size=1, max_size=100))
    def test_unicode_content_handling_invariant(self, text):
        """
        INVARIANT: Validation should handle unicode content correctly.
        
        The validation protocol must properly handle unicode characters
        while maintaining validation invariants.
        """
        # Create data with unicode content
        unicode_data = {
            "id": f"unicode-test-{text}",
            "title": f"Unicode Title: {text} 🚀 📈",
            "content": f"Unicode content: {text} 💰 🌟 📉",
            "published_at": "2024-01-01T00:00:00Z",
            "source": "Unicode Source 📰",
            "url": f"https://example.com/{text}"
        }
        
        result = validate_news_article(unicode_data)
        
        # Should handle unicode correctly
        if result is not None:
            assert isinstance(result, NewsArticle), "Unicode data should be valid"
            assert text in result.title, "Unicode text should be preserved"
            assert text in result.content, "Unicode text should be preserved"
    
    @given(
        id_str=st.text(min_size=1, max_size=50, alphabet="0123456789"),
        title=st.text(min_size=1, max_size=200),
        content=st.text(min_size=1, max_size=1000)
    )
    def test_numeric_id_handling_invariant(self, id_str, title, content):
        """
        INVARIANT: Numeric IDs should be handled as strings.
        
        The validation protocol should treat numeric IDs as strings
        to maintain type consistency invariants.
        """
        data = {
            "id": id_str,
            "title": title,
            "content": content,
            "published_at": "2024-01-01T00:00:00Z",
            "source": "Test Source",
            "url": "https://example.com"
        }
        
        result = validate_news_article(data)
        
        if result is not None:
            assert isinstance(result.id, str), "Numeric ID should be treated as string"
            assert result.id == id_str, "Numeric ID should be preserved"


if __name__ == "__main__":
    # Run tests directly
    pytest.main([__file__, "-v"])
