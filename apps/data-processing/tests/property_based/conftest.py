"""
Configuration and shared fixtures for property-based tests.

This module provides common configuration, strategies, and utilities
for property-based testing across all protocol invariants.
"""

import pytest
import os
import sys
from hypothesis import settings, Phase, Verbosity, strategies as st
from typing import Dict, Any, List, Optional

# Add src directory to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "src"))

# Configure hypothesis settings for property-based tests
settings.register_profile(
    "property_based",
    max_examples=100,
    phases=[Phase.generate, Phase.target],
    verbosity=Verbosity.verbose,
    deadline=1000,  # 1 second deadline per test case
    stateful_step_count=50,
)

# Apply property-based profile
settings.load_profile("property_based")


class PropertyBasedTestConfig:
    """Configuration for property-based testing."""
    
    # Test generation parameters
    MAX_EXAMPLES = 100
    DEADLINE_MS = 1000
    VERBOSITY = Verbosity.verbose
    
    # Data generation bounds
    MAX_STRING_LENGTH = 1000
    MAX_LIST_SIZE = 100
    MAX_DICT_SIZE = 50
    MAX_NUMERIC_VALUE = 1e10
    MIN_NUMERIC_VALUE = -1e10
    
    # Sentiment analysis bounds
    SENTIMENT_MIN_SCORE = -1.0
    SENTIMENT_MAX_SCORE = 1.0
    SENTIMENT_LABELS = ["positive", "negative", "neutral"]
    
    # Asset codes and symbols
    COMMON_ASSET_CODES = ["BTC", "ETH", "XLM", "USDC", "USDT", "ADA", "DOT", "LINK"]
    ASSET_CODE_LENGTH_RANGE = (1, 20)
    
    # Rate limit formats
    RATE_LIMIT_UNITS = ["second", "minute", "hour", "day"]
    RATE_LIMIT_MAX_NUMBER = 10000
    
    # Database field constraints
    ARTICLE_ID_MAX_LENGTH = 255
    TITLE_MAX_LENGTH = 500
    CONTENT_MAX_LENGTH = 10000
    PRIMARY_ASSET_MAX_LENGTH = 20
    LANGUAGE_MAX_LENGTH = 10
    
    # Social media platforms
    SOCIAL_PLATFORMS = ["twitter", "reddit", "facebook", "instagram"]
    
    # Analytics record types
    ANALYTICS_RECORD_TYPES = ["sentiment_summary", "trend", "volume", "price"]
    ANALYTICS_WINDOWS = ["1h", "24h", "7d", "30d"]
    TREND_DIRECTIONS = ["up", "down", "stable"]


@pytest.fixture
def property_config():
    """Fixture providing property-based test configuration."""
    return PropertyBasedTestConfig()


@pytest.fixture
def mock_api_key():
    """Fixture providing a mock API key for testing."""
    return "test-api-key-12345"


@pytest.fixture
def mock_environment(mock_api_key):
    """Fixture providing mock environment variables."""
    env_vars = {
        "API_KEY": mock_api_key,
        "RATE_LIMIT_ENABLED": "true",
        "RATE_LIMIT_DEFAULT": "100/minute",
        "RATE_LIMIT_STRICT": "10/minute",
        "SENTIMENT_DISABLE_TRANSFORMER": "1",
    }
    
    # Backup original environment
    original_env = os.environ.copy()
    
    # Set mock environment
    for key, value in env_vars.items():
        os.environ[key] = value
    
    yield env_vars
    
    # Restore original environment
    os.environ.clear()
    os.environ.update(original_env)


@pytest.fixture
def sample_sentiment_data(property_config):
    """Fixture providing sample sentiment data for testing."""
    return {
        "valid_scores": [
            -1.0, -0.8, -0.5, -0.1, 0.0, 0.1, 0.5, 0.8, 1.0
        ],
        "invalid_scores": [
            -1.5, -2.0, 1.5, 2.0, 100.0, -100.0
        ],
        "valid_labels": property_config.SENTIMENT_LABELS,
        "invalid_labels": ["invalid", "unknown", "", "positiveish"],
        "boundary_scores": [-1.0, -0.05, 0.05, 1.0],
    }


@pytest.fixture
def sample_validation_data(property_config):
    """Fixture providing sample validation data for testing."""
    return {
        "valid_news_articles": [
            {
                "id": "article-1",
                "title": "Valid Article Title",
                "content": "Valid article content with sufficient length.",
                "published_at": "2024-01-01T00:00:00Z",
                "source": "Test Source",
                "url": "https://example.com/article-1"
            }
        ],
        "invalid_news_articles": [
            {},  # Empty
            {"id": "article-2"},  # Missing required fields
            {"id": "article-3", "title": 123},  # Wrong types
            {"id": "", "title": "Empty ID"},  # Empty required field
        ],
        "valid_metrics": [
            {
                "metric_id": "metric-1",
                "value": 42.0,
                "timestamp": "2024-01-01T00:00:00Z",
                "chain": "stellar"
            }
        ],
        "invalid_metrics": [
            {},  # Empty
            {"metric_id": "metric-2"},  # Missing required fields
            {"metric_id": "metric-3", "value": "not-a-float"},  # Wrong types
        ]
    }


@pytest.fixture
def sample_security_data(property_config):
    """Fixture providing sample security data for testing."""
    return {
        "valid_rate_limits": [
            "100/second",
            "50/minute",
            "24/hour",
            "7/day"
        ],
        "invalid_rate_limits": [
            "invalid",
            "100",
            "100/",
            "/minute",
            "100/invalid",
            "abc/minute",
            "100/second/extra",
            "",
            " ",
            "100/ MINUTE",  # Case sensitive
        ],
        "valid_api_keys": [
            "valid-key-123",
            "another-valid-key",
            "complex-key-with-special-chars-!@#$%"
        ],
        "invalid_api_keys": [
            "",  # Empty
            " ",  # Space only
            "\t",  # Tab only
            "\n",  # Newline only
        ]
    }


class PropertyBasedTestUtils:
    """Utilities for property-based testing."""
    
    @staticmethod
    def generate_valid_timestamp() -> str:
        """Generate a valid ISO8601 timestamp."""
        from datetime import datetime, timezone
        return datetime.now(timezone.utc).isoformat()
    
    @staticmethod
    def generate_invalid_timestamps() -> List[str]:
        """Generate various invalid timestamp formats."""
        return [
            "",
            "invalid-timestamp",
            "2024-13-01T00:00:00Z",  # Invalid month
            "2024-01-32T00:00:00Z",  # Invalid day
            "2024-01-01T25:00:00Z",  # Invalid hour
            "2024-01-01T00:60:00Z",  # Invalid minute
            "2024-01-01 00:00:00",   # Missing Z and T
            1234567890,               # Unix timestamp (wrong format)
            None,                     # None value
        ]
    
    @staticmethod
    def generate_boundary_strings(min_length: int = 1, max_length: int = 100) -> List[str]:
        """Generate strings at various boundary conditions."""
        return [
            "a" * min_length,  # Minimum length
            "a" * max_length,  # Maximum length
            "",                # Empty string
            " ",               # Space only
            "\t",              # Tab only
            "\n",              # Newline only
            "a" * (max_length + 1),  # Exceeds maximum
        ]
    
    @staticmethod
    def generate_boundary_numbers(min_val: float, max_val: float) -> List[float]:
        """Generate numbers at various boundary conditions."""
        return [
            min_val,           # Minimum
            max_val,           # Maximum
            min_val - 1,       # Below minimum
            max_val + 1,       # Above maximum
            0.0,               # Zero
            -0.0,              # Negative zero
            float('inf'),      # Infinity
            float('-inf'),     # Negative infinity
            float('nan'),      # Not a number
        ]
    
    @staticmethod
    def assert_invariant(condition: bool, message: str):
        """
        Assert that an invariant condition holds true.
        
        Args:
            condition: The invariant condition to check
            message: Descriptive message for assertion failure
            
        Raises:
            AssertionError: If the invariant is violated
        """
        if not condition:
            raise AssertionError(f"INVARIANT VIOLATION: {message}")
    
    @staticmethod
    def check_type_invariants(obj: Any, expected_types: Dict[str, type], context: str = ""):
        """
        Check that object fields maintain expected type invariants.
        
        Args:
            obj: Object to check
            expected_types: Dictionary of field names to expected types
            context: Context description for error messages
            
        Raises:
            AssertionError: If type invariants are violated
        """
        for field_name, expected_type in expected_types.items():
            if hasattr(obj, field_name):
                actual_value = getattr(obj, field_name)
                if actual_value is not None and not isinstance(actual_value, expected_type):
                    context_str = f" in {context}" if context else ""
                    raise AssertionError(
                        f"TYPE INVARIANT VIOLATION{context_str}: "
                        f"{field_name} should be {expected_type.__name__}, "
                        f"got {type(actual_value).__name__}"
                    )
    
    @staticmethod
    def check_value_invariants(obj: Any, constraints: Dict[str, Any], context: str = ""):
        """
        Check that object fields maintain expected value invariants.
        
        Args:
            obj: Object to check
            constraints: Dictionary of field names to constraint functions
            context: Context description for error messages
            
        Raises:
            AssertionError: If value invariants are violated
        """
        for field_name, constraint_func in constraints.items():
            if hasattr(obj, field_name):
                actual_value = getattr(obj, field_name)
                if actual_value is not None and not constraint_func(actual_value):
                    context_str = f" in {context}" if context else ""
                    raise AssertionError(
                        f"VALUE INVARIANT VIOLATION{context_str}: "
                        f"{field_name} with value {actual_value} violates constraint"
                    )


@pytest.fixture
def test_utils():
    """Fixture providing property-based test utilities."""
    return PropertyBasedTestUtils()


# Custom hypothesis strategies
def valid_asset_codes():
    """Strategy for generating valid asset codes."""
    from hypothesis.strategies import text, sampled_from
    return sampled_from(PropertyBasedTestConfig.COMMON_ASSET_CODES) | text(
        min_size=PropertyBasedTestConfig.ASSET_CODE_LENGTH_RANGE[0],
        max_size=PropertyBasedTestConfig.ASSET_CODE_LENGTH_RANGE[1],
        alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    )


def valid_sentiment_scores():
    """Strategy for generating valid sentiment scores."""
    from hypothesis.strategies import floats
    return floats(
        min_value=PropertyBasedTestConfig.SENTIMENT_MIN_SCORE,
        max_value=PropertyBasedTestConfig.SENTIMENT_MAX_SCORE
    )


def invalid_sentiment_scores():
    """Strategy for generating invalid sentiment scores."""
    from hypothesis.strategies import floats, one_of
    return one_of(
        floats(max_value=PropertyBasedTestConfig.SENTIMENT_MIN_SCORE - 0.1),
        floats(min_value=PropertyBasedTestConfig.SENTIMENT_MAX_SCORE + 0.1)
    )


def valid_rate_limit_strings():
    """Strategy for generating valid rate limit strings."""
    from hypothesis.strategies import integers, sampled_from
    return integers(
        min_value=1,
        max_value=PropertyBasedTestConfig.RATE_LIMIT_MAX_NUMBER
    ).flatmap(
        lambda n: sampled_from(PropertyBasedTestConfig.RATE_LIMIT_UNITS).map(
            lambda unit: f"{n}/{unit}"
        )
    )


# Custom strategies are available as functions above
# They can be used directly in tests with st.from_type() or by calling the functions


# Markers for different types of property-based tests
pytest.mark.property_based = pytest.mark.property_based
pytest.mark.sentiment_invariants = pytest.mark.sentiment_invariants
pytest.mark.validation_invariants = pytest.mark.validation_invariants
pytest.mark.security_invariants = pytest.mark.security_invariants
pytest.mark.database_invariants = pytest.mark.database_invariants


def pytest_configure(config):
    """Configure pytest markers."""
    config.addinivalue_line(
        "markers",
        "property_based: marks tests as property-based tests"
    )
    config.addinivalue_line(
        "markers",
        "sentiment_invariants: marks tests for sentiment analysis invariants"
    )
    config.addinivalue_line(
        "markers",
        "validation_invariants: marks tests for data validation invariants"
    )
    config.addinivalue_line(
        "markers",
        "security_invariants: marks tests for security protocol invariants"
    )
    config.addinivalue_line(
        "markers",
        "database_invariants: marks tests for database model invariants"
    )


def pytest_collection_modifyitems(config, items):
    """Modify test collection to add markers based on file location."""
    for item in items:
        # Add property_based marker to all tests in property_based directory
        if "property_based" in str(item.fspath):
            item.add_marker(pytest.mark.property_based)
        
        # Add specific markers based on test file names
        if "sentiment_invariants" in str(item.fspath):
            item.add_marker(pytest.mark.sentiment_invariants)
        elif "validation_invariants" in str(item.fspath):
            item.add_marker(pytest.mark.validation_invariants)
        elif "security_invariants" in str(item.fspath):
            item.add_marker(pytest.mark.security_invariants)
        elif "database_invariants" in str(item.fspath):
            item.add_marker(pytest.mark.database_invariants)
