"""
Database package for analytics data persistence
"""

from .models import (
    Base,
    Article,
    ArticleOnchainEntityLink,
    SocialPost,
    AnalyticsRecord,
    ContractEvent,
    ProjectView,
    ProjectContributor,
    ProjectMilestone,
    NewsInsight,
    AssetTrend,
)
from .postgres_service import PostgresService

__all__ = [
    "Base",
    "Article",
    "ArticleOnchainEntityLink",
    "SocialPost",
    "AnalyticsRecord",
    "ContractEvent",
    "ProjectView",
    "ProjectContributor",
    "ProjectMilestone",
    "NewsInsight",
    "AssetTrend",
    "PostgresService",
]
