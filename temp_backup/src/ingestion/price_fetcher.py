"""
Off-chain price fetcher for Soroban pricing adapter feeds.

This module supports fetching USD prices for supported Stellar assets,
scaling them to the pricing adapter base decimals, and handling failures
with stale cache fallback.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from requests.exceptions import RequestException
from src.utils.http_client import RobustHTTPClient

logger = logging.getLogger(__name__)

BASE_DECIMALS = 7
DEFAULT_CACHE_TTL_SECONDS = 300
DEFAULT_STALE_TTL_SECONDS = 600
DEFAULT_REQUEST_TIMEOUT = 10

COINGECKO_URL = "https://api.coingecko.com/api/v3/simple/price"
COINCAP_URL = "https://api.coincap.io/v2/assets"

SUPPORTED_ASSETS: Dict[str, Dict[str, Any]] = {
    "XLM": {
        "coingecko_id": "stellar",
        "coincap_id": "stellar",
        "asset_decimals": 7,
        "asset_issuer": None,
    },
    "USDC": {
        "coingecko_id": "usd-coin",
        "coincap_id": "usd-coin",
        "asset_decimals": 6,
        "asset_issuer": None,
    },
}


class PriceFetcher:
    """Fetch current asset prices and prepare adapter-ready payloads."""

    def __init__(
        self,
        cache_ttl_seconds: int = DEFAULT_CACHE_TTL_SECONDS,
        stale_ttl_seconds: int = DEFAULT_STALE_TTL_SECONDS,
        request_timeout: int = DEFAULT_REQUEST_TIMEOUT,
    ):
        self.cache_ttl_seconds = cache_ttl_seconds
        self.stale_ttl_seconds = stale_ttl_seconds
        self.request_timeout = request_timeout
        self.cache: Dict[str, Dict[str, Any]] = {}
        self.session = RobustHTTPClient()

    def fetch_all_prices(
        self, asset_codes: Optional[List[str]] = None
    ) -> List[Dict[str, Any]]:
        """Fetch prices for supported assets and return adapter-ready values."""
        asset_codes = asset_codes or list(SUPPORTED_ASSETS.keys())
        now = datetime.now(timezone.utc)
        source = "coingecko"

        try:
            price_map = self._fetch_coingecko(asset_codes)
        except Exception as primary_error:
            logger.warning(
                "Primary price source failed: %s; trying fallback endpoint.",
                primary_error,
            )
            source = "coincap"
            try:
                price_map = self._fetch_coincap(asset_codes)
            except Exception as fallback_error:
                logger.warning(
                    "Fallback price source failed: %s; using cached stale values if available.",
                    fallback_error,
                )
                price_map = {}
                source = "cache"

        results: List[Dict[str, Any]] = []
        for asset_code in asset_codes:
            asset_config = SUPPORTED_ASSETS.get(asset_code)
            if not asset_config:
                logger.warning("Skipping unsupported asset code: %s", asset_code)
                continue

            coingecko_id = asset_config["coingecko_id"]
            price_usd = price_map.get(coingecko_id)

            if price_usd is not None:
                scaled_price = self._scale_price(price_usd)
                payload = self._build_price_payload(
                    asset_code=asset_code,
                    asset_issuer=asset_config.get("asset_issuer"),
                    price_usd=price_usd,
                    scaled_price=scaled_price,
                    asset_decimals=asset_config["asset_decimals"],
                    source=source,
                    timestamp=now,
                    is_stale=False,
                )
                self.cache[asset_code] = {
                    "payload": payload,
                    "cached_at": now,
                }
                results.append(payload)
                continue

            stale_payload = self._get_stale_payload(asset_code, now)
            if stale_payload is not None:
                results.append(stale_payload)
                continue

            results.append(
                {
                    "asset_code": asset_code,
                    "asset_issuer": asset_config.get("asset_issuer"),
                    "success": False,
                    "error": "price_unavailable",
                    "source": source,
                    "is_stale": False,
                    "timestamp": now.isoformat(),
                }
            )

        return results

    def fetch_price(self, asset_code: str) -> Dict[str, Any]:
        """Fetch the current price for a single asset."""
        return self.fetch_all_prices([asset_code])[0]

    def _fetch_coingecko(self, asset_codes: List[str]) -> Dict[str, float]:
        """Fetch usd prices from CoinGecko."""
        asset_ids = self._asset_ids(asset_codes, key="coingecko_id")
        response = self.session.get(
            COINGECKO_URL,
            params={"ids": ",".join(asset_ids), "vs_currencies": "usd"},
            timeout=self.request_timeout,
        )
        response.raise_for_status()
        data = response.json()
        prices: Dict[str, float] = {}
        for asset_code in asset_codes:
            asset_id = SUPPORTED_ASSETS[asset_code]["coingecko_id"]
            asset_data = data.get(asset_id, {})
            usd_value = asset_data.get("usd")
            if usd_value is not None:
                prices[asset_id] = float(usd_value)
        if not prices:
            raise RequestException("CoinGecko returned no valid prices")
        return prices

    def _fetch_coincap(self, asset_codes: List[str]) -> Dict[str, float]:
        """Fetch usd prices from CoinCap as a fallback."""
        asset_ids = self._asset_ids(asset_codes, key="coincap_id")
        response = self.session.get(
            COINCAP_URL,
            params={"ids": ",".join(asset_ids)},
            timeout=self.request_timeout,
        )
        response.raise_for_status()
        data = response.json()
        prices: Dict[str, float] = {}
        for item in data.get("data", []):
            asset_id = item.get("id")
            price_usd = item.get("priceUsd")
            if asset_id and price_usd:
                prices[asset_id] = float(price_usd)
        if not prices:
            raise RequestException("CoinCap returned no valid prices")
        return prices

    def _scale_price(self, price_usd: float) -> int:
        return int(round(price_usd * (10**BASE_DECIMALS)))

    def _build_price_payload(
        self,
        asset_code: str,
        asset_issuer: Optional[str],
        price_usd: float,
        scaled_price: int,
        asset_decimals: int,
        source: str,
        timestamp: datetime,
        is_stale: bool,
    ) -> Dict[str, Any]:
        return {
            "asset_code": asset_code,
            "asset_issuer": asset_issuer,
            "price_usd": price_usd,
            "price": scaled_price,
            "asset_decimals": asset_decimals,
            "base_decimals": BASE_DECIMALS,
            "source": source,
            "timestamp": timestamp.isoformat(),
            "is_stale": is_stale,
            "success": True,
        }

    def _asset_ids(self, asset_codes: List[str], key: str) -> List[str]:
        return [SUPPORTED_ASSETS[asset_code][key] for asset_code in asset_codes]

    def _get_stale_payload(
        self, asset_code: str, now: datetime
    ) -> Optional[Dict[str, Any]]:
        cached = self.cache.get(asset_code)
        if not cached:
            return None
        age = (now - cached["cached_at"]).total_seconds()
        if age > self.stale_ttl_seconds:
            logger.warning(
                "Cached price for %s is stale (%.0fs old), discarding.",
                asset_code,
                age,
            )
            return None
        payload = cached["payload"].copy()
        payload["is_stale"] = True
        payload["source"] = "cache"
        payload["timestamp"] = now.isoformat()
        return payload
