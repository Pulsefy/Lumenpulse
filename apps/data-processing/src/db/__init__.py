"""
Database package for analytics data persistence
"""

from .models import (
    Base,
    Article,
    SocialPost,
    AnalyticsRecord,
    ProjectContributionMaterializedView,
    NewsInsight,
    AssetTrend,
)
from .postgres_service import PostgresService

__all__ = [
    "Base",
    "Article",
    "SocialPost",
    "AnalyticsRecord",
    "ProjectContributionMaterializedView",
    "NewsInsight",
    "AssetTrend",
    "PostgresService",
]
