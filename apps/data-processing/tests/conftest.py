"""
Pytest configuration and shared fixtures for LumenPulse data processing tests.
"""
import pytest
import sys
import os

# Add src directory to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))


@pytest.fixture
def sample_data():
    """Fixture providing sample test data."""
    return {
        "project_id": 1,
        "name": "Test Project",
        "amount": 1000
    }
