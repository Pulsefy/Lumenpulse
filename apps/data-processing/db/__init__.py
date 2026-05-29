"""
Database package for analytics data persistence
"""

from .models import Base, Article, SocialPost, AnalyticsRecord, NewsInsight, AssetTrend, OnChainEntity, ArticleEntityLink
from .postgres_service import PostgresService

__all__ = [
    "Base",
    "Article",
    "SocialPost",
    "AnalyticsRecord",
    "NewsInsight",
    "AssetTrend",
    "OnChainEntity",
    "ArticleEntityLink",
    "PostgresService",
]
