"""
Database initialization script
Creates tables and sets up the database schema
"""

import sys
import os
import logging
from dotenv import load_dotenv

# Add parent directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.db import PostgresService

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)

logger = logging.getLogger(__name__)


def main():
    """Initialize the database"""
    load_dotenv()
    
    logger.info("=" * 60)
    logger.info("Database Initialization Script")
    logger.info("=" * 60)
    
    try:
        # Initialize PostgreSQL service
        db_service = PostgresService()
        logger.info(f"Connected to database: {db_service.database_url}")
        
        # Create tables
        logger.info("Creating database tables...")
        db_service.create_tables()
        logger.info("✓ Tables created successfully")
        
        # Verify tables
        logger.info("\nVerifying tables...")
        with db_service.get_session() as session:
            # Check if tables exist by querying them
            from src.db.models import NewsInsight, AssetTrend
            
            news_count = session.query(NewsInsight).count()
            trends_count = session.query(AssetTrend).count()
            
            logger.info(f"✓ news_insights table: {news_count} records")
            logger.info(f"✓ asset_trends table: {trends_count} records")
        
        logger.info("\n" + "=" * 60)
        logger.info("Database initialization completed successfully!")
        logger.info("=" * 60)
        
        return 0
        
    except Exception as e:
        logger.error(f"Database initialization failed: {e}", exc_info=True)
        return 1


if __name__ == "__main__":
    sys.exit(main())
