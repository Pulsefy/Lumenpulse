"""
Data ingestion module for fetching external data.
"""

from .news_fetcher import NewsFetcher, NewsArticle, fetch_news
from .stellar_fetcher import (
    StellarDataFetcher,
    VolumeData,
    TransactionRecord,
    get_asset_volume,
    get_network_overview,
)
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
    "NewsFetcher",
    "NewsArticle",
    "fetch_news",
    "StellarDataFetcher",
    "VolumeData",
    "TransactionRecord",
    "get_asset_volume",
    "get_network_overview",
    # Social media fetchers
    "SocialFetcher",
    "SocialPost",
    "TwitterFetcher",
    "RedditFetcher",
    "RateLimiter",
    "SocialPlatform",
    "fetch_social",
]
