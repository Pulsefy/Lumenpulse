# Backend Query Performance & Index Hardening

This document covers the database index strategy, critical read-path performance expectations, and query profiling setup for the LumenPulse backend.

## Index Strategy

Indexes are defined both as TypeORM `@Index()` decorators (for schema documentation) and as idempotent migration steps (for safe deployments).

### Core Entities

#### `users`
| Index | Columns | Purpose |
|---|---|---|
| PK | `id` | User lookups |
| UQ | `email` | Login by email |
| UQ | `stellarPublicKey` | Wallet linking |
| IDX | `role` | Admin / user filtering |
| IDX | `createdAt` | User analytics, cohort queries |

**Expected performance:**
- `findByEmail`: < 5 ms (unique index)
- `findById`: < 2 ms (primary key)
- Role-based filters: < 20 ms with LIMIT

#### `stellar_accounts`
| Index | Columns | Purpose |
|---|---|---|
| PK | `id` | Account lookups |
| UQ | `userId, publicKey` | Prevent duplicate links |
| IDX | `userId` | List accounts for user |
| IDX | `isActive` | Filter active accounts |
| IDX | `isPrimary` | Find primary account |

**Expected performance:**
- `getStellarAccounts(userId)`: < 10 ms
- `findByPublicKey`: < 5 ms (unique)

#### `portfolio_assets`
| Index | Columns | Purpose |
|---|---|---|
| PK | `id` | Row lookups |
| IDX | `userId` | Fallback portfolio query |
| IDX | `userId, assetCode` | Asset-specific queries |

**Expected performance:**
- `find({ userId })`: < 15 ms
- `find({ userId, assetCode })`: < 5 ms

#### `portfolio_snapshots`
| Index | Columns | Purpose |
|---|---|---|
| PK | `id` | Row lookups |
| IDX | `userId, createdAt` | History pagination + latest snapshot |
| IDX | `createdAt` | Time-range analytics |

**Expected performance:**
- `getPortfolioHistory(userId, page, limit)`: < 30 ms (10k snapshots / user)
- `getPortfolioSummary` (latest): < 15 ms (composite index covers `ORDER BY createdAt DESC`)

#### `articles` (news)
| Index | Columns | Purpose |
|---|---|---|
| PK | `id` | Row lookups |
| UQ | `url` | Deduplication |
| IDX | `publishedAt` | Recent articles feed |
| IDX | `source` | Source filter |
| IDX | `sentimentScore` | Sentiment range scans |
| IDX | `source, publishedAt` | Source + date composite |
| IDX | `category` | Category filter |
| GIN | `tags` | Array containment (`ANY`) |

**Expected performance:**
- `findAll()` ordered: < 50 ms (50k articles)
- `findAll({ category })`: < 30 ms
- `findAll({ tag })` with GIN: < 40 ms
- `getSentimentSummary` (aggregations): < 100 ms (uses `sentimentScore IS NOT NULL` filter)

#### `notifications`
| Index | Columns | Purpose |
|---|---|---|
| PK | `id` | Row lookups |
| IDX | `userId, createdAt` | User inbox with ordering |
| IDX | `userId` | Single-column filter |
| IDX | `read` | Unread count |
| IDX | `type` | Type filter |
| IDX | `severity` | Severity filter |
| IDX | `createdAt` | Time-based cleanup |

**Expected performance:**
- Inbox query (`userId + ORDER BY createdAt`): < 20 ms
- Unread count (`userId + read = false`): < 15 ms

#### `notification_delivery_logs`
| Index | Columns | Purpose |
|---|---|---|
| PK | `id` | Row lookups |
| IDX | `notificationId` | Per-notification delivery status |
| IDX | `userId` | Per-user logs |
| IDX | `channel, status` | Channel health metrics |
| IDX | `createdAt` | Time-based cleanup |
| IDX | `userId, createdAt` | Daily limit counting |
| IDX | `status, retryCount` | Retry job polling |

**Expected performance:**
- `getDeliveryLogsForUser`: < 30 ms (50-row limit)
- `retryFailedDeliveries`: < 50 ms (scans only failed rows)
- `deliverToUser` (preference + log writes): < 100 ms end-to-end

#### `push_tokens`
| Index | Columns | Purpose |
|---|---|---|
| PK | `id` | Row lookups |
| UQ | `token` | Deduplication |
| IDX | `userId` | List tokens for user |
| IDX | `isActive` | Active token filter |
| IDX | `userId, isActive` | Active tokens per user |

**Expected performance:**
- `find({ userId, isActive })`: < 10 ms

#### `refresh_tokens`
| Index | Columns | Purpose |
|---|---|---|
| PK | `id` | Row lookups |
| IDX | `tokenHash` | Token validation |
| IDX | `userId` | Revoke all sessions |
| IDX | `expiresAt` | Cleanup stale tokens |

**Expected performance:**
- Token lookup: < 5 ms
- Cleanup job (`expiresAt < now()`): < 100 ms (batch)

#### `password_reset_tokens`
| Index | Columns | Purpose |
|---|---|---|
| PK | `id` | Row lookups |
| IDX | `tokenHash` | Token validation |
| IDX | `expiresAt` | Cleanup stale tokens |

**Expected performance:**
- Token lookup: < 5 ms

#### `outbox_events`
| Index | Columns | Purpose |
|---|---|---|
| PK | `id` | Row lookups |
| IDX | `status, createdAt` | Outbox poller (pending events) |
| IDX | `eventType` | Event-type metrics |

**Expected performance:**
- Poller query (`status = pending ORDER BY createdAt`): < 30 ms

#### `daily_snapshots`
| Index | Columns | Purpose |
|---|---|---|
| PK | `id` | Row lookups |
| UQ | `snapshotDate, assetSymbol` | Idempotent daily row |
| IDX | `assetSymbol` | Per-asset history |
| IDX | `createdAt` | Recent snapshot queries |

**Expected performance:**
- `findByDateRange`: < 20 ms
- Aggregate queries: < 50 ms

#### `stellar_sync_checkpoints`
| Index | Columns | Purpose |
|---|---|---|
| PK | `id` | Row lookups |
| UQ | `type` | Checkpoint per sync type |
| IDX | `updatedAt` | Staleness detection |

#### `stellar_processed_events`
| Index | Columns | Purpose |
|---|---|---|
| PK | `id` | Row lookups |
| UQ | `eventId` | Deduplication |
| IDX | `processedAt` | Cleanup old events |

## Query Profiling

### How it works

A `QueryProfilerService` wraps critical read paths and logs execution time. If a query exceeds its threshold, a `[SLOW QUERY]` warning is emitted.

### Thresholds

| Service / Method | Threshold | Rationale |
|---|---|---|
| `NewsService.findAll` | 150 ms | Filtered list with optional GIN scan |
| `NewsService.getSentimentSummary` | 200 ms | Two aggregation queries |
| `PortfolioService.getPortfolioHistory` | 150 ms | Paginated snapshot scan |
| `PortfolioService.getPortfolioSummary` | 200 ms | User + snapshot lookup |
| `NotificationDeliveryService.deliverToUser` | 300 ms | Preference + multi-channel delivery |
| `NotificationDeliveryService.getDeliveryLogsForUser` | 150 ms | Log pagination |
| `ReconciliationService.runReconciliation` | 5000 ms | Full pass across all users |
| `WatchlistService.getWatchlist` | 100 ms | Small per-user dataset |

### Enabling debug logs

Set `LOG_LEVEL=debug` (or use NestJS `--debug`) to see all `[QUERY]` timings. Only queries exceeding thresholds emit `[SLOW QUERY]` warnings at the default `warn` level.

### Decorator for controllers

You can also use the `@ProfileQuery()` decorator on controller methods:

```ts
import { ProfileQuery } from './common/profiling/profile-query.decorator';

@Controller('portfolio')
export class PortfolioController {
  @Get('history')
  @ProfileQuery('PortfolioController.getHistory', 150)
  async getHistory(@Query() query: PortfolioHistoryQueryDto) {
    // ...
  }
}
```

## Maintenance

1. **Run migrations** after each deploy:
   ```bash
   npm run migration:run
   ```

2. **Review slow query logs** periodically:
   ```bash
   grep "SLOW QUERY" logs/app.log | tail -n 50
   ```

3. **Analyze index usage** in PostgreSQL:
   ```sql
   SELECT schemaname, tablename, indexname, idx_scan, idx_tup_read
   FROM pg_stat_user_indexes
   WHERE schemaname = 'public'
   ORDER BY idx_scan ASC;
   ```

4. **Vacuum & analyze** after large data loads:
   ```sql
   ANALYZE articles;
   ANALYZE portfolio_snapshots;
   ```

## Known Issues

- There are two `User` entity files (`users/entities/user.entity.ts` and `users/user.entity.ts`) both mapping to the `users` table. The active one is `users/entities/user.entity.ts`. Index changes are applied to the canonical entity.
