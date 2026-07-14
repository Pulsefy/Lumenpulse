"""
Data ingestion module for fetching external data.
"""
from .stellar_asset_id import (
    KNOWN_ASSETS,
    NATIVE_KEY,
    AssetID,
    display_name,
    make_asset_key,
    normalize_asset_dict,
    parse_asset_key,
)

from .payload_quarantine import (
    QuarantineStore,
    QuarantinedPayload,
    quarantine_on_error,
    process_with_quarantine,
)

from .news_fetcher import NewsFetcher, NewsArticle, fetch_news
from .stellar_fetcher import (
    StellarDataFetcher,
    VolumeData,
    TransactionRecord,
    get_asset_volume,
    get_network_overview,
)
from .price_fetcher import PriceFetcher
from .social_fetcher import (
    SocialFetcher,
    SocialPost,
    TwitterFetcher,
    RedditFetcher,
    RateLimiter,
    SocialPlatform,
    fetch_social,
)

__all__ = [
    # Stellar asset ID helpers
    "KNOWN_ASSETS",
    "NATIVE_KEY",
    "AssetID",
    "display_name",
    "make_asset_key",
    "normalize_asset_dict",
    "parse_asset_key",
    # News
    "NewsFetcher",
    "NewsArticle",
    "fetch_news",
    # Stellar fetcher
    "StellarDataFetcher",
    "VolumeData",
    "TransactionRecord",
    "get_asset_volume",
    "get_network_overview",
    "PriceFetcher",
    # Social media fetchers
    "SocialFetcher",
    "SocialPost",
    "TwitterFetcher",
    "RedditFetcher",
    "RateLimiter",
    "SocialPlatform",
    "fetch_social",
    "QuarantineStore",
    "QuarantinedPayload",
    "quarantine_on_error",
    "process_with_quarantine",
]
