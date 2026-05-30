# SQLAlchemy Reserved Name Fix

## Issue

The CI/CD pipeline failed with the following error:

```
sqlalchemy.exc.InvalidRequestError: Attribute name 'metadata' is reserved when using the Declarative API.
```

This error occurred because SQLAlchemy reserves the attribute name `metadata` for its internal use in the Declarative API.

## Root Cause

In `src/db/models.py`, the `ContributorReputationSnapshot` model had a column named `metadata`:

```python
class ContributorReputationSnapshot(Base):
    # ...
    metadata = Column(JSON, nullable=True, comment="Additional metadata including rank and percentile")
```

SQLAlchemy uses `metadata` internally to store the `MetaData` object that contains table information, so this name conflicts with the framework.

## Solution

Renamed the `metadata` column to `snapshot_metadata` across all files:

### Files Modified

1. **`src/db/models.py`**
   - Changed column name from `metadata` to `snapshot_metadata`

2. **`src/analytics/contributor_reputation.py`**
   - Updated `ContributorMetrics.snapshot_metadata` field
   - Updated `to_dict()` method to return `snapshot_metadata`
   - Updated `_calculate_percentiles()` to use `snapshot_metadata`

3. **`src/api/server.py`**
   - Updated `ContributorMetricsResponse.snapshot_metadata` field
   - Updated API endpoint mapping to use `snapshot_metadata`

4. **`alembic/versions/003_add_contributor_reputation_snapshots.py`**
   - Updated migration to create column as `snapshot_metadata`

5. **`tests/test_contributor_reputation.py`**
   - Updated all test assertions to use `snapshot_metadata`

6. **`tests/integration/test_contributor_api.py`**
   - Updated test data and assertions to use `snapshot_metadata`

## Verification

All references have been updated:

- ✅ Model column: `snapshot_metadata`
- ✅ Dataclass field: `snapshot_metadata`
- ✅ API response field: `snapshot_metadata`
- ✅ Migration column: `snapshot_metadata`
- ✅ Test assertions: `snapshot_metadata`
- ✅ Code formatted with Black

## Impact

This is a **breaking change** for the database schema. The migration will create the column as `snapshot_metadata` instead of `metadata`. If the migration was already applied with the old name, you would need to:

```sql
ALTER TABLE contributor_reputation_snapshots
RENAME COLUMN metadata TO snapshot_metadata;
```

However, since this is being caught before deployment, the migration will create the correct column name from the start.

## Lessons Learned

When creating SQLAlchemy models, avoid these reserved attribute names:

- `metadata`
- `query`
- `session`
- `registry`
- `base`

Always use prefixed names like `snapshot_metadata`, `extra_metadata`, or `custom_metadata` to avoid conflicts.

## Testing

The fix will be validated by the CI/CD pipeline:

```bash
pytest tests/test_contributor_reputation.py -v
pytest tests/integration/test_contributor_api.py -v
```

These tests should now pass without the SQLAlchemy import error.
