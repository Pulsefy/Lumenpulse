# Blockchain Audit Trail System

## Overview

The Blockchain Audit Trail System provides a comprehensive, tamper-resistant audit log for all admin-triggered blockchain actions in LumenPulse. It captures and persists:

- **Actor**: Who executed the action (admin user ID and display name)
- **Endpoint**: Which admin endpoint was called
- **Target Contract**: Which Soroban contract was interacted with (matching_pool, treasury, registry)
- **Function Name**: Which contract function was invoked
- **Parameters Summary**: Sanitized request parameters (sensitive data redacted)
- **Transaction Hash**: The resulting blockchain transaction hash
- **Ledger Sequence**: The ledger where the transaction was recorded
- **Status**: Transaction status (pending, success, failed)
- **Timestamp**: When the action was triggered
- **IP Address**: Client IP for additional audit context

## Architecture

### Components

1. **BlockchainAuditLog Entity** (`entities/blockchain-audit-log.entity.ts`)
   - TypeORM entity mapping to `blockchain_audit_logs` table
   - Indexes on frequently queried fields: actor_id, target_contract, tx_hash, created_at
   - JSONB support for flexible parameter storage

2. **BlockchainAuditService** (`blockchain-audit.service.ts`)
   - Persists audit logs with automatic sensitive data redaction
   - Provides flexible query interface for compliance and investigation
   - Supports filtering by actor, contract, status, and date range
   - Handles deletion of old audit logs (retention policies)

3. **@BlockchainAudit() Decorator** (`decorators/blockchain-audit.decorator.ts`)
   - Marks endpoints that perform blockchain admin actions
   - Configures contract name, function name, and params to log
   - Works with `BlockchainAuditInterceptor` to automatically capture actions

4. **BlockchainAuditInterceptor** (`interceptors/blockchain-audit.interceptor.ts`)
   - Automatically captures endpoint context (actor, IP, params)
   - Extracts transaction hash and ledger sequence from response
   - Logs both successful and failed blockchain actions
   - Runs asynchronously to minimize request latency

5. **BlockchainAuditController** (`blockchain-audit.controller.ts`)
   - Admin-only REST endpoints for querying audit logs
   - Supports complex filtering: by actor, contract, status, date range
   - Provides specialized queries: by transaction hash, actor, or contract

## Database Schema

```sql
CREATE TABLE blockchain_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID NOT NULL,
  actor_display VARCHAR(255) NOT NULL,
  endpoint VARCHAR(255) NOT NULL,
  http_method VARCHAR(10) NOT NULL,
  target_contract VARCHAR(100) NOT NULL,
  function_name VARCHAR(100) NOT NULL,
  contract_address VARCHAR(255) NOT NULL,
  params_summary JSONB,
  tx_hash VARCHAR(255) NOT NULL,
  tx_status VARCHAR(50) DEFAULT 'success',
  ledger_seq BIGINT,
  action_description TEXT,
  ip_address VARCHAR(45),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  error_message TEXT
);

CREATE INDEX idx_blockchain_audit_actor_id ON blockchain_audit_logs(actor_id);
CREATE INDEX idx_blockchain_audit_target_contract ON blockchain_audit_logs(target_contract);
CREATE INDEX idx_blockchain_audit_tx_hash ON blockchain_audit_logs(tx_hash);
CREATE INDEX idx_blockchain_audit_created_at ON blockchain_audit_logs(created_at);
```

## Usage Guide

### 1. Enable Audit Logging on Endpoints

Mark any admin endpoint that performs blockchain actions with `@BlockchainAudit()`:

```typescript
import { BlockchainAudit } from '../audit/decorators/blockchain-audit.decorator';

@Post('rounds')
@BlockchainAudit({
  targetContract: 'matching_pool',
  functionName: 'create_round',
  description: 'Create a new matching round with specified funds',
  paramsToLog: ['name', 'matchingFunds'],
})
async createRound(
  @Body() dto: CreateRoundDto,
): Promise<RoundResponseDto> {
  // ... implementation
}
```

### 2. Decorator Configuration

The `@BlockchainAudit()` decorator accepts:

```typescript
interface BlockchainAuditConfig {
  /**
   * Target contract name: 'matching_pool', 'treasury', 'registry'
   */
  targetContract: string;

  /**
   * Soroban contract function name
   */
  functionName: string;

  /**
   * Human-readable description (optional)
   */
  description?: string;

  /**
   * Which request body keys to include in audit log
   * - undefined/[]: all non-sensitive keys
   * - ['*']: all keys including sensitive
   * - ['key1', 'key2']: only specified keys
   */
  paramsToLog?: string[];

  /**
   * Whether to extract txHash from response (default: true)
   */
  extractTxHash?: boolean;
}
```

### 3. Query Audit Logs

#### Get paginated audit logs with filters

```bash
GET /admin/blockchain-audit?limit=50&offset=0&targetContract=matching_pool&sortBy=createdAt&sortOrder=DESC
```

Query parameters:
- `limit`: Results per page (default: 50)
- `offset`: Pagination offset (default: 0)
- `actorId`: Filter by admin user ID
- `targetContract`: Filter by contract (matching_pool, treasury, registry)
- `txStatus`: Filter by status (pending, success, failed)
- `startDate`: Filter for actions on or after this date
- `endDate`: Filter for actions on or before this date
- `sortBy`: Sort by field (createdAt, txHash, targetContract)
- `sortOrder`: ASC or DESC

#### Get audit log by ID

```bash
GET /admin/blockchain-audit/:id
```

#### Find logs by transaction hash

```bash
GET /admin/blockchain-audit/by-tx/:txHash
```

Useful for verifying a transaction on Stellar explorer and cross-referencing with admin actions.

#### Find logs by actor

```bash
GET /admin/blockchain-audit/by-actor/:actorId?limit=50
```

Useful for accountability: see all actions performed by a specific admin.

#### Find logs by contract

```bash
GET /admin/blockchain-audit/by-contract/:targetContract?limit=50
```

Examples:
- `/admin/blockchain-audit/by-contract/matching_pool`
- `/admin/blockchain-audit/by-contract/treasury`
- `/admin/blockchain-audit/by-contract/registry`

## Sensitive Data Redaction

The `BlockchainAuditService` automatically redacts sensitive fields before persistence. Fields redacted:

- `secret`
- `privateKey`
- `password`
- `token`
- `apiKey`
- `signingKey`

Redaction is **recursive** and handles:
- Top-level object properties
- Nested objects
- Arrays containing objects

Example:

**Before Redaction:**
```json
{
  "name": "Round Alpha",
  "matchingFunds": "1000000",
  "managerSecret": "SB...",
  "nested": {
    "apiKey": "key_123",
    "beneficiary": "GA..."
  }
}
```

**After Redaction:**
```json
{
  "name": "Round Alpha",
  "matchingFunds": "1000000",
  "managerSecret": "[REDACTED]",
  "nested": {
    "apiKey": "[REDACTED]",
    "beneficiary": "GA..."
  }
}
```

## Covered Admin Actions

### Matching Pool Contract

- **POST** `/admin/matching-pool/rounds`
  - Function: `create_round`
  - Params: name, matchingFunds

- **POST** `/admin/matching-pool/rounds/:roundId/approve-project`
  - Function: `approve_project`
  - Params: projectAddress

### Treasury Contract

- **POST** `/treasury/streams`
  - Function: `allocate_budget`
  - Params: beneficiary, amount, startTime, duration

### Registry Contract

To be added. Use the same pattern when implementing registry admin endpoints.

## API Response Examples

### Query Audit Logs

```json
{
  "logs": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "actorId": "660e8400-e29b-41d4-a716-446655440111",
      "actorDisplay": "admin@lumenpulse.com",
      "endpoint": "POST /admin/matching-pool/rounds",
      "httpMethod": "POST",
      "targetContract": "matching_pool",
      "functionName": "create_round",
      "contractAddress": "CAL4T5X3E6MHVHIXLJ2BFNQTBVZCZKDCB7EXZWFFWQYDMHKCVHEFQIW",
      "paramsSummary": {
        "name": "Round Alpha",
        "matchingFunds": "1000000"
      },
      "txHash": "0x1234567890abcdef...",
      "txStatus": "success",
      "ledgerSeq": 12345678,
      "actionDescription": "Create a new matching round with specified funds",
      "ipAddress": "203.0.113.42",
      "createdAt": "2025-01-15T10:30:00Z",
      "errorMessage": null
    }
  ],
  "count": 1
}
```

### Get Single Log

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "actorId": "660e8400-e29b-41d4-a716-446655440111",
  "actorDisplay": "admin@lumenpulse.com",
  "endpoint": "POST /treasury/streams",
  "httpMethod": "POST",
  "targetContract": "treasury",
  "functionName": "allocate_budget",
  "contractAddress": "CBJ2OHYSPZLJ4YZXC4JBVSEKN5C77PBPDMK7Q7MKXGRNKMYAFL4NCRH",
  "paramsSummary": {
    "beneficiary": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    "amount": "500000",
    "startTime": 1705315200,
    "duration": 2592000
  },
  "txHash": "0xabcdef1234567890...",
  "txStatus": "success",
  "ledgerSeq": 12345700,
  "actionDescription": "Allocate a treasury budget and start a vesting stream",
  "ipAddress": "203.0.113.42",
  "createdAt": "2025-01-15T11:45:00Z",
  "errorMessage": null
}
```

## Compliance & Security

### Retention Policy

Audit logs are retained indefinitely by default. To implement retention policies:

```typescript
// Delete logs older than 90 days
await blockchainAuditService.deleteOlderThan(90);
```

### Access Control

- Only users with `ADMIN` role can query audit logs
- Query endpoint `/admin/blockchain-audit` requires JWT authentication
- All endpoints return 403 Forbidden for non-admin users

### Audit Trail Integrity

- Audit logs are **append-only** (no UPDATE operations)
- Each log entry has a unique UUID primary key
- Timestamp is set server-side to prevent tampering
- Transaction hash links logs to on-chain transactions (immutable)

### Monitoring & Alerting

Consider implementing alerts for:

1. **Failed transactions**: Audit logs with `txStatus = 'failed'`
2. **Unusual patterns**: Multiple failed attempts by same actor
3. **High-frequency actions**: Many transactions in short time window
4. **New actors**: First-time admin actions from new users

Example query for failed treasury transactions:

```bash
GET /admin/blockchain-audit?targetContract=treasury&txStatus=failed&sortOrder=DESC
```

## Integration Checklist

- [ ] Add `BlockchainAuditLog` entity to database migrations
- [ ] Run migrations: `npm run typeorm migration:run`
- [ ] Import `AuditModule` in `AppModule`
- [ ] Add `BlockchainAuditInterceptor` to global interceptors
- [ ] Mark admin endpoints with `@BlockchainAudit()` decorator
- [ ] Test audit log persistence on admin endpoints
- [ ] Test sensitive data redaction
- [ ] Test query endpoints with various filters
- [ ] Document custom alerts and monitoring rules
- [ ] Add audit query links to admin dashboard

## Example: Adding Audit to a New Endpoint

1. **Decorate the endpoint:**

```typescript
@Post('custom-action')
@BlockchainAudit({
  targetContract: 'registry',
  functionName: 'custom_function',
  description: 'Perform a custom registry operation',
  paramsToLog: ['field1', 'field2'],
})
async customAction(@Body() dto: CustomDto): Promise<CustomResponse> {
  // Implementation
}
```

2. **Ensure response includes transaction hash:**

The interceptor looks for: `txHash`, `hash`, `transactionHash`, or `tx_hash` in response.

```typescript
// Your response should include one of:
{
  txHash: '0x...',
  ledger: 12345,
  status: 'success'
}
```

3. **Test the audit log:**

```bash
curl -X GET http://localhost:3000/admin/blockchain-audit \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json"
```

## Troubleshooting

### Audit logs not being created

1. Check that endpoint is marked with `@BlockchainAudit()` decorator
2. Verify `BlockchainAuditInterceptor` is registered globally
3. Check database migrations have run
4. Check for errors in application logs

### Sensitive data not being redacted

1. Verify field name matches redaction patterns (case-insensitive substring match)
2. Check that field is included in `paramsToLog` or uses default (all keys)
3. Test redaction directly: review saved `paramsSummary` in database

### Can't query audit logs

1. Verify user has `ADMIN` role
2. Check JWT token is valid and included in Authorization header
3. Verify endpoint paths: `/admin/blockchain-audit`
4. Check query parameters are URL-encoded

## Related Documentation

- [Treasury Contract Admin Guide](../TREASURY.md)
- [Matching Pool Admin Guide](../MATCHING_POOL.md)
- [Stellar Security Best Practices](../STELLAR_SECURITY.md)
- [TypeORM Migration Guide](../../DATABASE.md)
