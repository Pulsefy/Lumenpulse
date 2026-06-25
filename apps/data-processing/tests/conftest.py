"""
Pytest configuration and shared fixtures for LumenPulse data processing tests.
"""

import os

# Skip FinBERT download/load in default test runs (CI and local pytest).
os.environ.setdefault("SENTIMENT_DISABLE_TRANSFORMER", "1")

import pytest
import sys
import os
from unittest.mock import MagicMock

# Add src directory to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))


@pytest.fixture
def sample_data():
    """Fixture providing sample test data."""
    return {"project_id": 1, "name": "Test Project", "amount": 1000}



_HEAVY_MODULES = [
    "stellar_sdk",
    "stellar_sdk.exceptions",
    "stellar_sdk.call_builder",
    "stellar_sdk.call_builder.call_builder_async",
]
for _mod in _HEAVY_MODULES:
    if _mod not in sys.modules:
        sys.modules[_mod] = MagicMock()
