# Data Persistence Implementation

## Issue #327: Persist Analytics Output to PostgreSQL

### Overview
Implemented PostgreSQL persistence layer for storing processed sentiment and trend data, enabling the backend/frontend to query analytics directly from the database instead of relying on transient in-memory storage.

## Features Implemented

### 1. Database Models

#### NewsInsight Table
Stores sentiment analysis results for news articles:
- `id`: Primary key (auto-increment)
- `article_id`: External article identifier
- `article_title`, `article_url`, `source`: Article metadata
- `sentiment_score`: Compound sentiment score (-1 to 1)
- `positive_score`, `negative_score`, `neutral_score`: Component scores
- `sentiment_label`: Classification (positive/negative/neutral)
- `keywords`: JSON array of extracted keywords
- `language`: Article language code
- `article_published_at`: Original publication timestamp
- `analyzed_at`, `created_at`: Processing timestamps

**Indexes:**
- `idx_news_insights_analyzed_at`: For time-based queries
- `idx_news_insights_sentiment_label`: For filtering by sentiment
- `idx_news_insights_source`: For filtering by source

#### AssetTrend Table
Stores calculated trends for assets and metrics:
- `id`: Primary key (auto-increment)
- `asset`: Asset symbol (e.g., 'XLM', 'BTC')
- `metric_name`: Metric being tracked (e.g., 'sentiment_score', 'volume')
- `window`: Time window (e.g., '1h', '24h', '7d')
- `trend_direction`: Trend direction (up/down/stable)
- `score`: Trend strength/score
- `current_value`, `previous_value`: Values for comparison
- `change_percentage`: Percentage change
- `extra_data`: JSON for additional trend data
- `timestamp`, `created_at`: Timestamps

**Indexes:**
- `idx_asset_trends_asset_metric`: For asset+metric queries
- `idx_asset_trends_timestamp`: For time-based queries
- `idx_asset_trends_window`: For filtering by time window

### 2. PostgreSQL Service Layer

**PostgresService** (`src/db/postgres_service.py`):
- Connection pooling with SQLAlchemy
- Context manager for session handling
- Automatic rollback on errors
- Batch insert operations for performance

**Key Methods:**
- `save_news_insight()`: Save single sentiment result
- `save_news_insights_batch()`: Batch save for efficiency
- `get_recent_news_insights()`: Query recent insights
- `save_asset_trend()`: Save single trend
- `save_asset_trends_batch()`: Batch save trends
- `get_recent_asset_trends()`: Query recent trends
- `get_sentiment_summary()`: Aggregate statistics
- `cleanup_old_data()`: Data retention management

### 3. Hybrid Storage Strategy

**DatabaseService** (`src/database.py`):
- Maintains backward compatibility with file-based storage
- Dual-write to both files and PostgreSQL
- Graceful degradation if PostgreSQL unavailable
- File storage serves as backup/fallback

### 4. Database Initialization

**Migration Script** (`scripts/init_database.py`):
```bash
python scripts/init_database.py
```
- Creates all tables with proper indexes
- Verifies table creation
- Safe to run multiple times (idempotent)

### 5. Environment Configuration

**Required Environment Variables:**
```env
DATABASE_URL=postgresql://user:password@host:port/database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=lumenpulse
DB_USER=postgres
DB_PASSWORD=postgres
```

### 6. Integration Tests

**Test Suite** (`tests/integration/test_postgres_integration.py`):
- Tests all CRUD operations
- Validates batch operations
- Verifies query functionality
- Tests data cleanup

Run tests:
```bash
pytest tests/integration/test_postgres_integration.py -v
```

## Usage Examples

### Initialize Database
```python
from src.db import PostgresService

# Initialize service
db_service = PostgresService()

# Create tables
db_service.create_tables()
```

### Save Sentiment Analysis
```python
# Single insight
sentiment_result = {
    "compound_score": 0.5,
    "positive": 0.7,
    "negative": 0.1,
    "neutral": 0.2,
    "sentiment_label": "positive",
}

article_data = {
    "id": "article-123",
    "title": "Crypto Market Update",
    "url": "https://example.com/article",
    "source": "CoinDesk",
}

insight = db_service.save_news_insight(sentiment_result, article_data)

# Batch save
results = [sentiment_result1, sentiment_result2, ...]
articles = [article_data1, article_data2, ...]
count = db_service.save_news_insights_batch(results, articles)
```

### Save Trend Data
```python
trend_data = {
    "trend_direction": "up",
    "score": 0.75,
    "current_value": 100.0,
    "previous_value": 90.0,
    "change_percentage": 11.11,
}

trend = db_service.save_asset_trend(
    asset="XLM",
    metric_name="sentiment_score",
    window="24h",
    trend_data=trend_data,
)
```

### Query Data
```python
# Get recent insights
insights = db_service.get_recent_news_insights(limit=100, hours=24)

# Get asset trends
trends = db_service.get_recent_asset_trends(
    asset="XLM",
    metric_name="sentiment_score",
    limit=50
)

# Get sentiment summary
summary = db_service.get_sentiment_summary(hours=24)
print(f"Average sentiment: {summary['average_sentiment']}")
print(f"Positive: {summary['positive_percentage']}%")
```

### Data Cleanup
```python
# Clean up data older than 30 days
deleted = db_service.cleanup_old_data(days=30)
print(f"Deleted {deleted['news_insights']} insights")
print(f"Deleted {deleted['asset_trends']} trends")
```

## Integration with Existing Pipeline

The DatabaseService now automatically persists to PostgreSQL when enabled:

```python
from src.database import DatabaseService
from src.db import PostgresService

# Initialize with PostgreSQL support
postgres_service = PostgresService()
db_service = DatabaseService(
    storage_dir="./data",
    use_postgres=True,
    postgres_service=postgres_service
)

# Save analytics (writes to both file and PostgreSQL)
record = AnalyticsRecord(
    timestamp=datetime.utcnow(),
    news_count=10,
    sentiment_data=sentiment_data,
    trends=trends
)
db_service.save_analytics(record)
```

## Database Schema

### news_insights
```sql
CREATE TABLE news_insights (
    id SERIAL PRIMARY KEY,
    article_id VARCHAR(255),
    article_title TEXT,
    article_url TEXT,
    source VARCHAR(100),
    sentiment_score FLOAT NOT NULL,
    positive_score FLOAT NOT NULL,
    negative_score FLOAT NOT NULL,
    neutral_score FLOAT NOT NULL,
    sentiment_label VARCHAR(20) NOT NULL,
    keywords JSON,
    language VARCHAR(10),
    article_published_at TIMESTAMPTZ,
    analyzed_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_news_insights_analyzed_at ON news_insights(analyzed_at);
CREATE INDEX idx_news_insights_sentiment_label ON news_insights(sentiment_label);
CREATE INDEX idx_news_insights_source ON news_insights(source);
CREATE INDEX idx_news_insights_article_id ON news_insights(article_id);
```

### asset_trends
```sql
CREATE TABLE asset_trends (
    id SERIAL PRIMARY KEY,
    asset VARCHAR(50) NOT NULL,
    metric_name VARCHAR(100) NOT NULL,
    window VARCHAR(20) NOT NULL,
    trend_direction VARCHAR(20) NOT NULL,
    score FLOAT NOT NULL,
    current_value FLOAT NOT NULL,
    previous_value FLOAT NOT NULL,
    change_percentage FLOAT NOT NULL,
    extra_data JSON,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_asset_trends_asset_metric ON asset_trends(asset, metric_name);
CREATE INDEX idx_asset_trends_timestamp ON asset_trends(timestamp);
CREATE INDEX idx_asset_trends_window ON asset_trends(window);
```

## Performance Considerations

1. **Connection Pooling**: SQLAlchemy pool (size=5, max_overflow=10)
2. **Batch Operations**: Use batch methods for multiple inserts
3. **Indexes**: Optimized for common query patterns
4. **Data Retention**: Automatic cleanup of old data
5. **Graceful Degradation**: Falls back to file storage if PostgreSQL unavailable

## Dependencies Added

```
asyncpg>=0.29.0
sqlalchemy>=2.0.0
alembic>=1.13.0
psycopg2-binary>=2.9.9
pytest-asyncio>=0.23.0
```

## Future Enhancements

1. **Alembic Migrations**: Add proper migration management
2. **Read Replicas**: Support for read-only replicas
3. **Partitioning**: Time-based partitioning for large datasets
4. **Caching Layer**: Redis cache for frequently accessed data
5. **Async Operations**: Async database operations for better performance
6. **Data Aggregation**: Pre-computed aggregation tables
7. **Full-Text Search**: PostgreSQL full-text search on article content
8. **Time-Series Optimization**: TimescaleDB extension for time-series data

## Files Created/Modified

### New Files:
- `src/db/__init__.py`
- `src/db/models.py`
- `src/db/postgres_service.py`
- `scripts/init_database.py`
- `tests/integration/test_postgres_integration.py`
- `DATA_PERSISTENCE_IMPLEMENTATION.md`

### Modified Files:
- `requirements.txt` - Added database dependencies
- `.env.example` - Added database configuration
- `src/database.py` - Integrated PostgreSQL support

## Testing

### Unit Tests
```bash
pytest tests/integration/test_postgres_integration.py -v
```

### Manual Testing
```bash
# 1. Set up database
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/lumenpulse"

# 2. Initialize database
python scripts/init_database.py

# 3. Run pipeline with PostgreSQL
python src/main.py run
```

## Troubleshooting

### Connection Issues
- Verify DATABASE_URL is correct
- Check PostgreSQL is running
- Verify network connectivity
- Check firewall rules

### Permission Issues
- Ensure database user has CREATE TABLE permissions
- Verify user can INSERT/SELECT/UPDATE/DELETE

### Performance Issues
- Check index usage with EXPLAIN ANALYZE
- Monitor connection pool usage
- Consider increasing pool size
- Review query patterns

## Conclusion

The PostgreSQL persistence layer provides a robust, scalable solution for storing analytics data while maintaining backward compatibility with the existing file-based system. The implementation follows best practices for database design, includes comprehensive error handling, and provides a solid foundation for future enhancements.
