import hashlib
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
    monkeypatch.setattr(config, "managed_keys_database_configured", lambda: True)
    monkeypatch.setattr(
        config,
        "lookup_managed_api_key",
        Mock(return_value={"id": "service-consumer", "scopes": scopes}),
    )
    return config


def test_managed_key_uses_consumer_identity_and_read_scope(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config = make_config(monkeypatch, ["data:read"])
    request = make_request("POST", "/analyze")

    assert config.validate_api_key(request)
    assert request.state.api_key_id == "service-consumer"
    assert request.state.api_key_scopes == ["data:read"]


def test_managed_key_cannot_use_write_scope_for_analysis(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config = make_config(monkeypatch, ["data:write"])

    with pytest.raises(HTTPException) as error:
        config.validate_api_key(make_request("POST", "/analyze"))

    assert error.value.status_code == 403
    assert "data:read" in error.value.detail


def test_managed_key_write_scope_authorizes_mutation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config = make_config(monkeypatch, ["data:write"])

    assert config.validate_api_key(make_request("POST", "/ingestion/run"))


def test_database_lookup_uses_hash_and_updates_usage() -> None:
    class Result:
        def mappings(self) -> "Result":
            return self

        def first(self) -> dict[str, object]:
            return {"consumerId": "service-consumer", "scopes": ["data:read"]}

    class Connection:
        def __init__(self) -> None:
            self.queries: list[tuple[str, dict[str, str]]] = []

        def execute(self, statement: object, params: dict[str, str]) -> Result:
            self.queries.append((str(statement), params))
            return Result()

    class Engine:
        def __init__(self, connection: Connection) -> None:
            self.connection = connection

        def begin(self) -> "Engine":
            return self

        def __enter__(self) -> Connection:
            return self.connection

        def __exit__(self, *args: object) -> None:
            return None

    config = SecurityConfig()
    connection = Connection()
    config._managed_keys_engine = Engine(connection)  # type: ignore[assignment]

    assert config.lookup_managed_api_key("managed-secret") == {
        "id": "service-consumer",
        "scopes": ["data:read"],
    }
    key_hash = hashlib.sha256(b"managed-secret").hexdigest()
    assert connection.queries[0][1] == {"key_hash": key_hash}
    assert '"keyHash"' in connection.queries[0][0]
    assert "UPDATE" in connection.queries[1][0]
