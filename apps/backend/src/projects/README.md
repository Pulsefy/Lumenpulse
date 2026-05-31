# Projects API

This module implements a Projects API that merges on-chain state with off-chain metadata, addressing issue #712.

## Overview

The Projects API provides endpoints to:
- List projects with on-chain status fields (active/expired, totals, etc.)
- Get detailed project information including project registry and vault-derived state
- Support pagination and filtering for MVP

## On-Chain State Integration

The API integrates with Stellar/Soroban blockchain to fetch:
- **Contract Address**: Smart contract address on-chain
- **Total Funding**: Total funding received (in stroops)
- **Vault Balance**: Current vault balance (in stroops)
- **Contributor Count**: Number of unique contributors
- **Last Updated Ledger**: Last ledger where on-chain state was updated

## API Endpoints

### GET /projects

List projects with on-chain state, pagination, and filtering.

**Query Parameters:**
- `status` (optional): Filter by project status (ACTIVE, EXPIRED, PENDING, ARCHIVED)
- `ownerPublicKey` (optional): Filter by owner public key
- `category` (optional): Filter by category
- `tags` (optional): Filter by tags (comma-separated)
- `q` (optional): Search query (matches name or description)
- `includeOnChain` (optional, default: true): Include on-chain state in response
- `limit` (optional, default: 20, max: 100): Pagination limit
- `offset` (optional, default: 0): Pagination offset

**Response:**
```json
{
  "projects": [
    {
      "id": "uuid",
      "name": "Project Name",
      "description": "Project description",
      "ownerPublicKey": "G...",
      "status": "ACTIVE",
      "onChainState": {
        "contractAddress": "C...",
        "totalFunding": "10000000",
        "vaultBalance": "5000000",
        "contributorCount": 25,
        "lastUpdatedLedger": "12345678"
      },
      "websiteUrl": "https://...",
      "githubUrl": "https://github.com/...",
      "tags": ["stellar", "defi"],
      "category": "DeFi",
      "createdAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-01-15T00:00:00Z",
      "expiresAt": "2024-12-31T23:59:59Z",
      "verifiedAt": "2024-01-10T00:00:00Z"
    }
  ],
  "total": 42,
  "limit": 20,
  "offset": 0
}
```

### GET /projects/:id

Get detailed project information with full on-chain state.

**Response:** Same as list item but with additional `metadata` field and guaranteed `onChainState`.

### POST /projects/:id/sync

Manually trigger a sync of on-chain state from the blockchain for a specific project. Requires authentication.

**Response:**
```json
{
  "success": true
}
```

## Database Schema

### Projects Table

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| name | varchar(255) | Project name (unique) |
| description | text | Project description |
| ownerPublicKey | varchar(56) | Stellar public key of owner |
| status | enum | ACTIVE, EXPIRED, PENDING, ARCHIVED |
| contractAddress | varchar(56) | Smart contract address |
| totalFunding | bigint | Total funding received |
| vaultBalance | bigint | Current vault balance |
| contributorCount | int | Number of contributors |
| lastUpdatedLedger | bigint | Last updated ledger |
| metadata | jsonb | Additional metadata |
| websiteUrl | text | Website URL |
| githubUrl | text | GitHub URL |
| tags | text[] | Project tags |
| category | varchar(100) | Project category |
| createdAt | timestamptz | Creation timestamp |
| updatedAt | timestamptz | Update timestamp |
| expiresAt | timestamptz | Expiration timestamp |
| verifiedAt | timestamptz | Verification timestamp |

**Indexes:**
- IDX_projects_status
- IDX_projects_ownerPublicKey
- IDX_projects_contractAddress

## Implementation Notes

- The current on-chain state fetching is a placeholder implementation
- TODO: Integrate with actual Soroban RPC to fetch contract state
- The service includes error handling to allow the API to continue with cached data if on-chain sync fails
- Projects are automatically marked as EXPIRED if their expiresAt date has passed during sync

## Migration

Run the migration to create the projects table:

```bash
npm run migration:run
```

Or use TypeORM CLI:

```bash
typeorm migration:run
```
