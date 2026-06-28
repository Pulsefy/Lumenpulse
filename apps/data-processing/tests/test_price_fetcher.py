"""Unit tests for the new price fetcher module."""

from datetime import datetime, timezone

import pytest

from src.ingestion.price_fetcher import PriceFetcher, SUPPORTED_ASSETS


class DummyResponse:
    def __init__(self, status_code: int, json_data):
        self.status_code = status_code
        self._json_data = json_data

    def raise_for_status(self):
        if self.status_code >= 400:
            raise Exception(f"HTTP {self.status_code}")

    def json(self):
        return self._json_data


def test_fetch_all_prices_success(monkeypatch):
    fetcher = PriceFetcher()

    def mock_get(url, params=None, timeout=None):
        assert timeout == fetcher.request_timeout
        if "coingecko" in url:
            return DummyResponse(
                200,
                {
                    "stellar": {"usd": 0.1234567},
                    "usd-coin": {"usd": 1.0},
                },
            )
        raise AssertionError("Unexpected URL: %s" % url)

    monkeypatch.setattr(fetcher.session, "get", mock_get)
    prices = fetcher.fetch_all_prices(["XLM", "USDC"])

    assert len(prices) == 2
    xlm = next(item for item in prices if item["asset_code"] == "XLM")
    usdc = next(item for item in prices if item["asset_code"] == "USDC")

    assert xlm["success"] is True
    assert xlm["price"] == 1234567
    assert xlm["asset_decimals"] == SUPPORTED_ASSETS["XLM"]["asset_decimals"]
    assert xlm["is_stale"] is False

    assert usdc["success"] is True
    assert usdc["price"] == 10000000
    assert usdc["asset_decimals"] == SUPPORTED_ASSETS["USDC"]["asset_decimals"]
    assert usdc["is_stale"] is False


def test_fetch_all_prices_uses_cache_when_source_fails(monkeypatch):
    fetcher = PriceFetcher()
    now = datetime.now(timezone.utc)
    stale_payload = {
        "asset_code": "XLM",
        "asset_issuer": None,
        "price_usd": 0.12,
        "price": 1200000,
        "asset_decimals": SUPPORTED_ASSETS["XLM"]["asset_decimals"],
        "base_decimals": 7,
        "source": "coingecko",
        "timestamp": now.isoformat(),
        "is_stale": False,
        "success": True,
    }
    fetcher.cache["XLM"] = {"payload": stale_payload, "cached_at": now}

    def mock_get(url, params=None, timeout=None):
        raise Exception("Source unreachable")

    monkeypatch.setattr(fetcher.session, "get", mock_get)
    prices = fetcher.fetch_all_prices(["XLM"])

    assert len(prices) == 1
    xlm = prices[0]
    assert xlm["success"] is True
    assert xlm["is_stale"] is True
    assert xlm["source"] == "cache"
    assert xlm["price"] == 1200000


def test_fetch_all_prices_returns_error_when_no_source_and_no_cache(monkeypatch):
    fetcher = PriceFetcher()

    def mock_get(url, params=None, timeout=None):
        raise Exception("Source unreachable")

    monkeypatch.setattr(fetcher.session, "get", mock_get)
    prices = fetcher.fetch_all_prices(["XLM"])

    assert len(prices) == 1
    xlm = prices[0]
    assert xlm["success"] is False
    assert xlm["error"] == "price_unavailable"
    assert xlm["source"] == "cache"
