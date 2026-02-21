# Portfolio Snapshot History Implementation

## Issue #332: Portfolio Snapshot History

### Overview
Implemented periodic portfolio snapshots to track historical performance over time for each user. This allows the frontend to display portfolio value trends and asset allocation changes.

## Features Implemented

### 1. Database Schema
- **PortfolioSnapshot Entity**: Stores periodic snapshots of user portfolios
  - `id`: UUID primary key
  - `userId`: UUID foreign key to users table
  - `createdAt`: Timestamp of snapshot creation
  - `assetBalances`: JSONB array containing per-asset balances and USD values
  - `totalValueUsd`: Total portfolio value in USD
  - Index on `(userId, createdAt)` for efficient querying

### 2. Services

#### StellarBalanceService
- Fetches real-time account balances from Stellar Horizon API
- Converts asset balances to USD values (mock prices for now)
- Handles native XLM and custom assets

#### PortfolioService
- `createSnapshot(userId)`: Creates a snapshot for a specific user
- `getPortfolioHistory(userId, page, limit)`: Retrieves paginated snapshot history
- `createSnapshotsForAllUsers()`: Scheduled job that runs daily at midnight
- `triggerSnapshotCreation()`: Manual trigger for testing/admin use

### 3. API Endpoints

#### GET /portfolio/history
Returns portfolio snapshots for the authenticated user with pagination.

**Query Parameters:**
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 10)

**Response:**
```json
{
  "snapshots": [
    {
      "id": "uuid",
      "userId": "uuid",
      "createdAt": "2026-02-20T00:00:00Z",
      "assetBalances": [
        {
          "assetCode": "XLM",
          "assetIssuer": null,
          "amount": "1000.50",
          "valueUsd": 120.06
        }
      ],
      "totalValueUsd": "120.06"
    }
  ],
  "total": 30,
  "page": 1,
  "limit": 10,
  "totalPages": 3
}
```

#### POST /portfolio/snapshot
Manually trigger snapshot creation for the authenticated user.

**Response:**
```json
{
  "success": true,
  "snapshot": {
    "id": "uuid",
    "createdAt": "2026-02-20T10:30:00Z",
    "totalValueUsd": "120.06"
  }
}
```

#### POST /portfolio/snapshots/trigger
Admin endpoint to trigger snapshot creation for all users.

**Response:**
```json
{
  "message": "Snapshot creation triggered",
  "success": 15,
  "failed": 0
}
```

### 4. Scheduled Jobs
- **Daily Snapshots**: Runs every day at midnight (00:00)
- Uses `@nestjs/schedule` with cron expressions
- Automatically creates snapshots for all users
- Logs success/failure counts

### 5. Data Flow

1. **Stellar Integration**:
   - Fetches real-time balances from Stellar Horizon API
   - Falls back to `portfolio_assets` table if Stellar fetch fails
   - User's Stellar public key is stored as their user ID

2. **USD Valuation**:
   - Mock prices implemented for demonstration
   - Production should integrate with CoinGecko, CoinMarketCap, or similar API
   - Calculates per-asset and total portfolio value

3. **Storage**:
   - Snapshots stored in `portfolio_snapshots` table
   - Asset balances stored as JSONB for flexibility
   - Indexed for efficient time-series queries

## Database Migration

Run the migration to create the portfolio_snapshots table:

```bash
npm run migration:run
```

Migration file: `1769600000000-CreatePortfolioSnapshot.ts`

## Dependencies Added

- `@nestjs/schedule`: For cron job scheduling

## Testing

### Manual Snapshot Creation
```bash
curl -X POST http://localhost:3000/portfolio/snapshot \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Get Portfolio History
```bash
curl -X GET "http://localhost:3000/portfolio/history?page=1&limit=10" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Trigger Snapshots for All Users (Admin)
```bash
curl -X POST http://localhost:3000/portfolio/snapshots/trigger \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## Future Enhancements

1. **Real Price Integration**: Replace mock prices with actual market data from CoinGecko or similar
2. **Admin Guard**: Add role-based access control for admin endpoints
3. **Snapshot Retention**: Implement data retention policies (e.g., keep daily snapshots for 1 year)
4. **Performance Metrics**: Add calculated fields like 24h change, 7d change, etc.
5. **Asset Filtering**: Allow filtering snapshots by specific assets
6. **Export Functionality**: Add CSV/JSON export for tax reporting
7. **Alerts**: Notify users of significant portfolio value changes

## Architecture Notes

- **Separation of Concerns**: Stellar integration separated into dedicated service
- **Fallback Strategy**: Uses portfolio_assets table if Stellar API is unavailable
- **Scalability**: Indexed queries and pagination support large datasets
- **Type Safety**: Full TypeScript typing with DTOs and entities
- **Error Handling**: Comprehensive logging and graceful degradation

## Files Created/Modified

### New Files:
- `src/portfolio/entities/portfolio-snapshot.entity.ts`
- `src/portfolio/dto/portfolio-snapshot.dto.ts`
- `src/portfolio/stellar-balance.service.ts`
- `src/portfolio/portfolio.service.ts`
- `src/portfolio/portfolio.controller.ts`
- `src/database/migrations/1769600000000-CreatePortfolioSnapshot.ts`

### Modified Files:
- `src/portfolio/portfolio.module.ts` - Added services and controller
- `src/portfolio/portfolio-asset.entity.ts` - Updated imports and timestamps
- `src/app.module.ts` - Added PortfolioModule and ScheduleModule
- `package.json` - Added @nestjs/schedule dependency
