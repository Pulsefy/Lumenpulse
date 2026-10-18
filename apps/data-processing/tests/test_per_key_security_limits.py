from unittest.mock import Mock

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from src.security import SecurityConfig


def make_request(method: str, path: str, key: str = "managed-secret") -> Request:
    return Request(
        {
            "type": "http",
            "method": method,
            "path": path,
            "headers": [(b"x-api-key", key.encode())],
            "query_string": b"",
            "server": ("test", 80),
            "scheme": "http",
        }
    )


def make_config(monkeypatch: pytest.MonkeyPatch, scopes: list[str]) -> SecurityConfig:
    config = SecurityConfig()
    config.api_keys = {}
    config.api_key = ""
    config._rate_limit_buckets.clear()
    config._in_flight.clear()
    config.rate_limit_default = "1/minute"
    config.rate_limit_strict = "1/minute"
    config._max_concurrent_requests = 1
    monkeypatch.setattr(config, "managed_keys_database_configured", lambda: True)
    monkeypatch.setattr(
        config,
        "lookup_managed_api_key",
        Mock(return_value={"id": "service-consumer", "scopes": scopes}),
    )
    return config


def test_managed_key_rejects_when_per_key_quota_is_exhausted(monkeypatch: pytest.MonkeyPatch) -> None:
    config = make_config(monkeypatch, ["data:read"])
    request = make_request("GET", "/news")

    assert config.validate_api_key(request) is True

    second_request = make_request("GET", "/news")
    with pytest.raises(HTTPException) as exc:
        config.validate_api_key(second_request)

    assert exc.value.status_code == 429
    assert "Retry-After" in exc.value.headers
    config.release_request(request)


def test_managed_key_rejects_when_concurrency_limit_is_hit(monkeypatch: pytest.MonkeyPatch) -> None:
    config = make_config(monkeypatch, ["data:read"])
    first_request = make_request("GET", "/news")
    second_request = make_request("GET", "/news")

    assert config.validate_api_key(first_request) is True

    with pytest.raises(HTTPException) as exc:
        config.validate_api_key(second_request)

    assert exc.value.status_code == 429
    assert exc.value.headers["Retry-After"]
    config.release_request(first_request)
