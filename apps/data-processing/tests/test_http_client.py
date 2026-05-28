import time
from unittest.mock import MagicMock, patch

import pytest
import requests

from src.utils.http_client import CircuitBreakerOpenException, RobustHTTPClient


def test_successful_request():
    """Verify that a successful request does not retry and resets breaker state."""
    client = RobustHTTPClient(max_retries=3, failure_threshold=2)
    mock_response = MagicMock(spec=requests.Response)
    mock_response.status_code = 200

    with patch.object(
        requests.Session, "request", return_value=mock_response
    ) as mock_req:
        res = client.get("https://example.com/api")
        assert res.status_code == 200
        assert mock_req.call_count == 1
        assert client.state == "CLOSED"
        assert client.failure_count == 0


def test_retries_on_transient_error_and_succeeds():
    """Verify that client retries on 500 and returns when it eventually succeeds."""
    client = RobustHTTPClient(max_retries=3, backoff_factor=0.01, failure_threshold=2)

    fail_response = MagicMock(spec=requests.Response)
    fail_response.status_code = 500

    success_response = MagicMock(spec=requests.Response)
    success_response.status_code = 200

    # Fail twice, then succeed
    with patch.object(
        requests.Session,
        "request",
        side_effect=[fail_response, fail_response, success_response],
    ) as mock_req:
        res = client.get("https://example.com/api")
        assert res.status_code == 200
        assert mock_req.call_count == 3
        assert client.state == "CLOSED"
        assert client.failure_count == 0


def test_trips_circuit_breaker_on_repeated_failures():
    """Verify that circuit breaker transitions to OPEN after threshold failures and rejects requests."""
    client = RobustHTTPClient(
        max_retries=1, backoff_factor=0.01, failure_threshold=2, recovery_timeout=5.0
    )

    fail_response = MagicMock(spec=requests.Response)
    fail_response.status_code = 500

    with patch.object(
        requests.Session, "request", return_value=fail_response
    ) as mock_req:
        # First failure sequence (will try twice: initial + 1 retry)
        with pytest.raises(requests.exceptions.HTTPError):
            client.get("https://example.com/api")
        assert client.failure_count == 1
        assert client.state == "CLOSED"

        # Second failure sequence (will try twice again: initial + 1 retry)
        with pytest.raises(requests.exceptions.HTTPError):
            client.get("https://example.com/api")
        assert client.failure_count == 2
        assert client.state == "OPEN"

        # Third request should immediately fail fast due to OPEN circuit breaker
        with pytest.raises(CircuitBreakerOpenException):
            client.get("https://example.com/api")

        # Session request should not have been called for the third request
        assert mock_req.call_count == 4  # 2 in first sequence, 2 in second sequence


def test_recovery_from_open_to_half_open():
    """Verify circuit breaker transitions to HALF-OPEN after timeout and recovers on success."""
    client = RobustHTTPClient(max_retries=0, failure_threshold=1, recovery_timeout=0.1)

    fail_response = MagicMock(spec=requests.Response)
    fail_response.status_code = 500

    success_response = MagicMock(spec=requests.Response)
    success_response.status_code = 200

    with patch.object(
        requests.Session, "request", side_effect=[fail_response, success_response]
    ) as mock_req:
        # Trip the breaker
        with pytest.raises(requests.exceptions.HTTPError):
            client.get("https://example.com/api")
        assert client.state == "OPEN"

        # Wait for recovery timeout
        time.sleep(0.15)

        # Next request should be allowed (HALF-OPEN) and succeed (recovering to CLOSED)
        res = client.get("https://example.com/api")
        assert res.status_code == 200
        assert client.state == "CLOSED"
        assert client.failure_count == 0
        assert mock_req.call_count == 2
