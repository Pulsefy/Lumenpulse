"""
Tests for paginated / streamed analytics collection endpoints (#1458).
"""

from __future__ import annotations

import json
import time

import pytest
from fastapi.testclient import TestClient

from src.analytics.paginated_fetcher import (
    fetch_all_daily_kpi_snapshots,
    iter_paginated,
)
from src.api.server import app
from src.db.models import DailyOnchainKPISnapshot
from src.db.postgres_service import PostgresService
from src.utils.pagination import (
    MAX_CORRELATION_POINTS,
    MAX_PAGE_SIZE,
    REPRESENTATIVE_HISTORY_SIZE,
    clamp_limit,
)


@pytest.fixture
def sqlite_db_service(tmp_path):
    db_path = tmp_path / "test_analytics_pagination.db"
    service = PostgresService(database_url=f"sqlite:///{db_path}")
    service.create_tables()
    return service


def _seed_snapshots(db_service: PostgresService, count: int, period: str = "daily") -> None:
    with db_service.get_session() as session:
        for i in range(count):
            day = 1 + (i % 28)
            month = 1 + ((i // 28) % 12)
            year = 2020 + (i // (28 * 12))
            session.add(
                DailyOnchainKPISnapshot(
                    snapshot_date=f"{year:04d}-{month:02d}-{day:02d}",
                    period=period,
                    tvl=float(i),
                    volume=float(i * 2),
                    active_rounds=i % 5,
                    contribution_count=i,
                    unique_contributors=max(1, i // 3),
                )
            )


def test_clamp_limit_enforces_max_uncapped_size():
    assert clamp_limit(None) == 100
    assert clamp_limit(0) == 1
    assert clamp_limit(MAX_PAGE_SIZE + 50) == MAX_PAGE_SIZE
    assert clamp_limit(25) == 25


def test_postgres_pagination_stable_order(sqlite_db_service):
    _seed_snapshots(sqlite_db_service, 25)

    page1, total = sqlite_db_service.get_daily_onchain_kpi_snapshots(
        period="daily", limit=10, offset=0
    )
    page2, total2 = sqlite_db_service.get_daily_onchain_kpi_snapshots(
        period="daily", limit=10, offset=10
    )
    assert total == total2 == 25
    assert len(page1) == 10
    assert len(page2) == 10
    assert page1[0].snapshot_date >= page1[-1].snapshot_date
    assert page1[-1].snapshot_date >= page2[0].snapshot_date
    assert not ({s.id for s in page1} & {s.id for s in page2})


def test_paginated_fetcher_walks_all_pages(sqlite_db_service):
    _seed_snapshots(sqlite_db_service, 35)
    all_items = fetch_all_daily_kpi_snapshots(sqlite_db_service, page_size=10)
    assert len(all_items) == 35

    collected = list(
        iter_paginated(
            lambda **kw: sqlite_db_service.get_daily_onchain_kpi_snapshots(
                period="daily", **kw
            ),
            page_size=7,
        )
    )
    assert len(collected) == 35


def test_api_daily_snapshots_pagination_headers(sqlite_db_service, monkeypatch):
    from src.security import security_config
    import src.api.server as server_module

    _seed_snapshots(sqlite_db_service, 15)
    monkeypatch.setattr(security_config, "api_key", "test-key")
    monkeypatch.setattr(server_module, "postgres_service", sqlite_db_service)

    client = TestClient(app)
    headers = {"X-API-Key": "test-key"}

    resp = client.get(
        "/analytics/kpis/daily-snapshots?period=daily&limit=5&offset=0",
        headers=headers,
    )
    assert resp.status_code == 200
    assert len(resp.json()) == 5
    assert resp.headers.get("X-Total-Count") == "15"
    assert resp.headers.get("X-Limit") == "5"
    assert resp.headers.get("X-Offset") == "0"
    assert resp.headers.get("X-Has-More") == "true"
    assert resp.headers.get("X-Max-Page-Size") == str(MAX_PAGE_SIZE)

    oversized = client.get(
        f"/analytics/kpis/daily-snapshots?period=daily&limit={MAX_PAGE_SIZE + 1}",
        headers=headers,
    )
    assert oversized.status_code == 422


def test_api_daily_snapshots_stream_ndjson(sqlite_db_service, monkeypatch):
    from src.security import security_config
    import src.api.server as server_module

    _seed_snapshots(sqlite_db_service, 12)
    monkeypatch.setattr(security_config, "api_key", "test-key")
    monkeypatch.setattr(server_module, "postgres_service", sqlite_db_service)

    client = TestClient(app)
    headers = {"X-API-Key": "test-key"}
    resp = client.get(
        "/analytics/kpis/daily-snapshots/stream?period=daily&page_size=5",
        headers=headers,
    )
    assert resp.status_code == 200
    assert "ndjson" in resp.headers.get("content-type", "")
    lines = [ln for ln in resp.text.strip().splitlines() if ln]
    assert len(lines) == 12
    first = json.loads(lines[0])
    assert "snapshot_date" in first
    assert "tvl" in first


def test_correlation_rejects_oversize_payload(sqlite_db_service, monkeypatch):
    from src.security import security_config
    import src.api.server as server_module

    monkeypatch.setattr(security_config, "api_key", "test-key")
    monkeypatch.setattr(server_module, "postgres_service", sqlite_db_service)

    client = TestClient(app)
    headers = {"X-API-Key": "test-key"}
    oversized = {
        "sentiment_data": [
            {"timestamp": f"2026-01-01T00:{i % 60:02d}:00Z", "score": 0.1}
            for i in range(MAX_CORRELATION_POINTS + 10)
        ],
        "price_data": [],
        "volume_data": [],
    }
    resp = client.post("/correlation/analyze", json=oversized, headers=headers)
    assert resp.status_code == 413


def test_representative_history_response_time(sqlite_db_service, monkeypatch):
    """Measure list latency against a representative history volume (#1458)."""
    from src.security import security_config
    import src.api.server as server_module

    n = min(REPRESENTATIVE_HISTORY_SIZE, 500)
    _seed_snapshots(sqlite_db_service, n)
    monkeypatch.setattr(security_config, "api_key", "test-key")
    monkeypatch.setattr(server_module, "postgres_service", sqlite_db_service)

    client = TestClient(app)
    headers = {"X-API-Key": "test-key"}

    start = time.perf_counter()
    resp = client.get(
        "/analytics/kpis/daily-snapshots?period=daily&limit=100&offset=0",
        headers=headers,
    )
    elapsed_ms = (time.perf_counter() - start) * 1000

    assert resp.status_code == 200
    assert len(resp.json()) == 100
    assert resp.headers.get("X-Total-Count") == str(n)
    assert elapsed_ms < 2000, f"paginated response too slow: {elapsed_ms:.1f}ms"
