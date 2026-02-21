"""
Database package for analytics data persistence
"""

from .models import Base, NewsInsight, AssetTrend
from .postgres_service import PostgresService

__all__ = ["Base", "NewsInsight", "AssetTrend", "PostgresService"]
