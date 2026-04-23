"""
Pytest configuration and shared fixtures for LumenPulse data processing tests.
"""

import os

# Skip FinBERT download/load in default test runs (CI and local pytest).
os.environ.setdefault("SENTIMENT_DISABLE_TRANSFORMER", "1")

import pytest
import sys
import os

# Add src directory to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))


@pytest.fixture
def sample_data():
    """Fixture providing sample test data."""
    return {"project_id": 1, "name": "Test Project", "amount": 1000}
