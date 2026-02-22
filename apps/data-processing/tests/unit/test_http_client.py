import pytest
import requests
import requests_mock
from src.utils.http_client import RobustHTTPClient, http_breaker
from pybreaker import CircuitBreakerError
import logging

# Reset the circuit breaker before each test
@pytest.fixture(autouse=True)
def reset_breaker():
    http_breaker.close()
    yield

def test_request_success():
    client = RobustHTTPClient(base_url="https://api.example.com")
    
    with requests_mock.Mocker() as m:
        m.get("https://api.example.com/test", json={"status": "ok"}, status_code=200)
        
        response = client.get("/test")
        
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}
        assert m.called

def test_request_retry_on_5xx():
    client = RobustHTTPClient(base_url="https://api.example.com", max_retries=3)
    
    with requests_mock.Mocker() as m:
        # Fail twice, succeed on third attempt
        m.register_uri('GET', "https://api.example.com/retry", [
            {'json': {'error': 'server error'}, 'status_code': 500},
            {'json': {'error': 'server error'}, 'status_code': 503},
            {'json': {'status': 'ok'}, 'status_code': 200}
        ])
        
        # We need to mock time.sleep or set tenancy wait to small for faster tests
        # but for now let's just run it
        response = client.get("/retry")
        
        assert response.status_code == 200
        assert m.call_count == 3

def test_request_retry_on_timeout():
    client = RobustHTTPClient(base_url="https://api.example.com", max_retries=2)
    
    with requests_mock.Mocker() as m:
        m.register_uri('GET', "https://api.example.com/timeout", [
            {'exc': requests.exceptions.Timeout},
            {'json': {'status': 'ok'}, 'status_code': 200}
        ])
        
        response = client.get("/timeout")
        
        assert response.status_code == 200
        assert m.call_count == 2

def test_circuit_breaker_opens():
    # Use 1 max_retries to avoid waiting too long
    client = RobustHTTPClient(base_url="https://api.example.com", max_retries=1)
    
    with requests_mock.Mocker() as m:
        # Simulate a persistent 500 error
        m.get("https://api.example.com/fail", status_code=500)
        
        # We don't know the exact internal state of the global breaker,
        # so we loop until it opens, with a safety limit.
        opened = False
        for _ in range(10):
            try:
                client.get("/fail")
            except requests.exceptions.HTTPError:
                # This exception is expected while the breaker is CLOSED
                continue
            except CircuitBreakerError:
                # This exception is expected once the breaker is OPEN
                opened = True
                break
        
        assert opened, "Circuit breaker should have opened"

def test_request_structured_logging(caplog):
    client = RobustHTTPClient(base_url="https://api.example.com")
    
    with requests_mock.Mocker() as m:
        m.get("https://api.example.com/log", json={"status": "ok"}, status_code=200)
        
        with caplog.at_level(logging.INFO):
            client.get("/log")
            
        assert "HTTP GET https://api.example.com/log - 200" in caplog.text
