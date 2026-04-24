# Pull Request: Historical Data Backfill & Warehousing (PostgreSQL)

## Issue
Closes #456 - Historical Data Backfill & Warehousing (PostgreSQL)

## Description
This PR implements a proper PostgreSQL database for long-term storage of all fetched news, social posts, and computed analytics, moving beyond JSONL files as requested in issue #456.

## Changes Made

### 1. Database Models (`src/db/models.py`)
Added three new database models to support comprehensive data storage:

- **Article**: Stores news articles with full content, metadata, and sentiment analysis
  - Fields: article_id, title, content, summary, source, url, asset_codes, primary_asset, categories, sentiment scores, keywords, language, timestamps
  - Indexes: published_at, sentiment_label, source, primary_asset, created_at

- **SocialPost**: Stores social media posts (Twitter, Reddit, etc.)
  - Fields: post_id, platform, content, author, url, engagement metrics (likes, comments, shares), asset_codes, primary_asset, hashtags, subreddit, sentiment scores, timestamps
  - Indexes: platform, posted_at, sentiment_label, primary_asset, created_at

- **AnalyticsRecord**: Stores computed analytics and aggregated metrics
  - Fields: record_type, asset, metric_name, window, value, previous_value, change_percentage, trend_direction, extra_data, timestamp
  - Indexes: record_type, asset, timestamp, type+asset, asset+metric

**Note**: Legacy tables (NewsInsight, AssetTrend) are preserved for backward compatibility.

### 2. PostgreSQL Service Enhancements (`src/db/postgres_service.py`)
Enhanced the PostgreSQL service with:

- **New CRUD operations** for Article, SocialPost, and AnalyticsRecord models
- **Retry logic** with exponential backoff for database operations
  - Configurable max retries (default: 3)
  - Exponential backoff delay (default: 1s, doubles each retry)
  - Handles OperationalError for transient connection issues
- **Batch operations** for efficient bulk inserts
- **Upsert logic** for articles and social posts (updates existing records)
- **Enhanced cleanup** to handle all table types

### 3. Alembic Migrations Setup
Set up Alembic for database schema versioning:

- `alembic.ini`: Configuration file for database connection and migration settings
- `alembic/env.py`: Environment configuration for online/offline migrations
- `alembic/script.py.mako`: Template for generating migration files
- `alembic/versions/001_initial_schema.py`: Initial migration creating all tables

### 4. Migration Script (`scripts/migrate_jsonl_to_db.py`)
Created a migration script to transfer historical data from analytics.jsonl to PostgreSQL:

- Reads JSONL files line by line
- Parses sentiment data and trends
- Creates AnalyticsRecord entries in the database
- Provides detailed migration statistics
- Handles errors gracefully with line-by-line logging

**Usage:**
```bash
python scripts/migrate_jsonl_to_db.py
python scripts/migrate_jsonl_to_db.py --file data/analytics.jsonl
python scripts/migrate_jsonl_to_db.py --file data/backfill/news_2026-01-23.json
```

### 5. Backfill Script Updates (`scripts/backfill.py`)
Enhanced the backfill script to support database storage:

- Added `--save-to-db` flag to enable PostgreSQL storage
- Initializes PostgresService when database saving is enabled
- Saves articles to database in addition to JSON files
- Tracks database save statistics
- Maintains backward compatibility (defaults to file-only storage)

**Usage:**
```bash
python scripts/backfill.py --days 30                    # File only (default)
python scripts/backfill.py --days 30 --save-to-db       # File + PostgreSQL
python scripts/backfill.py --days 1 --save-to-db        # Test with 1 day
```

### 6. Package Exports (`src/db/__init__.py`)
Updated package exports to include new models:
- Article
- SocialPost
- AnalyticsRecord
- PostgresService

## Acceptance Criteria Met

✅ **Database schema for Articles, SocialPosts, and AnalyticsRecords**
   - Three new models with comprehensive fields and indexes
   - Proper relationships and constraints
   - Support for sentiment analysis data

✅ **Migration script from analytics.jsonl to DB**
   - `scripts/migrate_jsonl_to_db.py` migrates historical data
   - Handles sentiment data and trends
   - Provides detailed statistics and error handling

✅ **Service handles DB connection pooling and retries**
   - SQLAlchemy connection pooling (pool_size=5, max_overflow=10)
   - pool_pre_ping for connection verification
   - Retry logic with exponential backoff for transient errors
   - Proper session management with context managers

## Technical Details

### Database Configuration
The service reads database configuration from environment variables:
```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/lumenpulse
```

### Connection Pooling
- Pool size: 5 connections
- Max overflow: 10 connections
- Pool pre-ping: Enabled (verifies connections before use)

### Retry Strategy
- Max retries: 3 (configurable)
- Initial delay: 1 second
- Backoff: Exponential (doubles each retry)
- Retryable errors: OperationalError (transient connection issues)
- Non-retryable errors: Other SQLAlchemyError types

### Indexes
All tables include strategic indexes for common query patterns:
- Time-based queries (published_at, posted_at, timestamp)
- Asset filtering (primary_asset)
- Sentiment analysis (sentiment_label)
- Composite indexes for multi-column queries

## Testing

### Manual Testing
1. Initialize database:
   ```bash
   python scripts/init_database.py
   ```

2. Run migrations:
   ```bash
   alembic upgrade head
   ```

3. Migrate historical data:
   ```bash
   python scripts/migrate_jsonl_to_db.py
   ```

4. Run backfill with database:
   ```bash
   python scripts/backfill.py --days 7 --save-to-db
   ```

### Integration Tests
Existing integration tests in `tests/integration/test_postgres_integration.py` can be extended to cover new models and operations.

## Dependencies
All required dependencies are already in `requirements.txt`:
- sqlalchemy>=2.0.0
- alembic>=1.13.0
- psycopg2-binary>=2.9.9

## Backward Compatibility
- Legacy tables (NewsInsight, AssetTrend) are preserved
- Existing code continues to work without modifications
- New features are opt-in via flags and configuration

## Future Enhancements
- Add database indexes for performance optimization
- Implement data partitioning for large datasets
- Add database backup and restore scripts
- Create monitoring dashboards for database metrics
- Implement data archival strategies

## Related Issues
- Closes #456 - Historical Data Backfill & Warehousing (PostgreSQL)

## Checklist
- [x] Database models for Articles, SocialPosts, and AnalyticsRecords
- [x] Alembic migrations setup
- [x] Migration script from analytics.jsonl to DB
- [x] Retry logic with exponential backoff
- [x] Connection pooling configuration
- [x] Backward compatibility maintained
- [x] Documentation updated
- [x] Code follows project conventions
