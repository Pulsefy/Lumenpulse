# Blockchain Audit System - Quick Reference Guide

## 30-Second Overview

The blockchain audit trail system automatically logs every admin-triggered blockchain action in LumenPulse. It captures who did what, when, and with what parameters, with all sensitive data automatically redacted.

## Enable Audit on Your Endpoint

```typescript
import { BlockchainAudit } from '../audit/decorators/blockchain-audit.decorator';

@Post('my-endpoint')
@BlockchainAudit({
  targetContract: 'matching_pool',    // or 'treasury', 'registry'
  functionName: 'my_function',
  description: 'What this does',
  paramsToLog: ['field1', 'field2'],
})
async myEndpoint(@Body() dto: MyDto): Promise<MyResponse> {
  // your code
}
```

## Query Audit Logs

```bash
# All recent audits
curl http://localhost:3000/admin/blockchain-audit \
  -H "Authorization: Bearer <JWT>"

# Filter by contract
curl http://localhost:3000/admin/blockchain-audit?targetContract=treasury \
  -H "Authorization: Bearer <JWT>"

# Filter by status
curl http://localhost:3000/admin/blockchain-audit?txStatus=failed \
  -H "Authorization: Bearer <JWT>"

# Find by transaction hash
curl http://localhost:3000/admin/blockchain-audit/by-tx/0x1234... \
  -H "Authorization: Bearer <JWT>"

# Find by actor (admin user)
curl http://localhost:3000/admin/blockchain-audit/by-actor/uuid \
  -H "Authorization: Bearer <JWT>"
```

## Already Configured

✅ `POST /admin/matching-pool/rounds`
✅ `POST /admin/matching-pool/rounds/:roundId/approve-project`
✅ `POST /treasury/streams`

## Database Schema

| Column | Type | Purpose |
|--------|------|---------|
| id | UUID | Unique identifier |
| actor_id | UUID | Who performed the action |
| actor_display | VARCHAR | Admin email/name |
| endpoint | VARCHAR | API path (e.g., /admin/matching-pool/rounds) |
| http_method | VARCHAR | POST, PUT, DELETE, etc. |
| target_contract | VARCHAR | matching_pool, treasury, registry |
| function_name | VARCHAR | Soroban function name |
| contract_address | VARCHAR | Contract public key |
| params_summary | JSONB | Request parameters (redacted) |
| tx_hash | VARCHAR | Blockchain transaction ID |
| tx_status | VARCHAR | pending, success, failed |
| ledger_seq | BIGINT | Ledger sequence number |
| action_description | TEXT | Human-readable description |
| ip_address | VARCHAR | Client IP address |
| error_message | TEXT | Error details if failed |
| created_at | TIMESTAMP | When the action occurred |

## Sensitive Data Redacted

Automatically redacted before storage:
- secret
- privateKey
- password
- token
- apiKey
- signingKey

Works recursively on nested objects and arrays.

## Decorator Options

```typescript
interface BlockchainAuditConfig {
  targetContract: string;        // Required: matching_pool, treasury, registry
  functionName: string;          // Required: Soroban function name
  description?: string;          // Optional: Human-readable description
  paramsToLog?: string[];        // Optional: which params to include
  extractTxHash?: boolean;       // Optional: auto-extract tx hash (default: true)
}
```

## Response Requirements

Your endpoint response should include transaction hash:

```typescript
// Any of these work:
return { txHash: '0x...', ... }
return { hash: '0x...', ... }
return { transactionHash: '0x...', ... }
return { tx_hash: '0x...', ... }

// Optional ledger info:
return { txHash: '0x...', ledger: 12345, ... }
```

## Files Changed

### New Files Created
- `src/audit/entities/blockchain-audit-log.entity.ts`
- `src/audit/blockchain-audit.service.ts`
- `src/audit/blockchain-audit.controller.ts`
- `src/audit/decorators/blockchain-audit.decorator.ts`
- `src/audit/interceptors/blockchain-audit.interceptor.ts`
- `src/audit/BLOCKCHAIN_AUDIT.md`
- `src/audit/IMPLEMENTATION_GUIDE.md`
- `src/database/migrations/1801000000000-CreateBlockchainAuditLogs.ts`

### Files Modified
- `src/audit/audit.module.ts` - Export new services
- `src/app.module.ts` - Register interceptor globally
- `src/stellar/controllers/matching-pool-admin.controller.ts` - Add decorators
- `src/treasury/treasury.controller.ts` - Add decorator

## Deployment

1. **Run migration**
   ```bash
   npm run typeorm migration:run
   ```

2. **Restart service**
   ```bash
   npm run build && npm start
   ```

3. **Verify**
   ```bash
   curl http://localhost:3000/admin/blockchain-audit \
     -H "Authorization: Bearer <JWT>"
   ```

## Troubleshooting

**Audit logs not being created?**
- Endpoint has `@BlockchainAudit()` decorator? ✓
- Migration ran? `SELECT * FROM blockchain_audit_logs;` ✓
- Service restarted after changes? ✓
- Check app logs for errors

**Sensitive data not redacted?**
- Field name must match: secret, privateKey, password, token, apiKey, signingKey
- Check `paramsSummary` in database

**Can't query audit logs?**
- User is ADMIN? ✓
- JWT token valid? ✓
- Using correct endpoint: `/admin/blockchain-audit` ✓

## API Reference

### GET /admin/blockchain-audit
**Query Parameters:**
- `limit` (number, default: 50) - Results per page
- `offset` (number, default: 0) - Pagination offset
- `actorId` (uuid) - Filter by admin user
- `targetContract` (string) - Filter by contract
- `txStatus` (string) - Filter by status: pending, success, failed
- `startDate` (ISO date) - Filter from date
- `endDate` (ISO date) - Filter to date
- `sortBy` (string) - createdAt, txHash, targetContract
- `sortOrder` (string) - ASC or DESC

### GET /admin/blockchain-audit/:id
Get single audit log by ID

### GET /admin/blockchain-audit/by-tx/:txHash
Find logs for a specific transaction hash

### GET /admin/blockchain-audit/by-actor/:actorId
Find all logs from a specific admin user

### GET /admin/blockchain-audit/by-contract/:targetContract
Find all logs for a specific contract

## Example Response

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
      "contractAddress": "CAL4T5X3...",
      "paramsSummary": {
        "name": "Round Alpha",
        "matchingFunds": "1000000"
      },
      "txHash": "0x1234567890...",
      "txStatus": "success",
      "ledgerSeq": 12345678,
      "actionDescription": "Create a new matching round",
      "ipAddress": "203.0.113.42",
      "createdAt": "2025-01-15T10:30:00Z",
      "errorMessage": null
    }
  ],
  "count": 1
}
```

## For More Information

- **Full Technical Docs**: `src/audit/BLOCKCHAIN_AUDIT.md`
- **Deployment Guide**: `src/audit/IMPLEMENTATION_GUIDE.md`
- **Summary**: `BLOCKCHAIN_AUDIT_SUMMARY.md` (root)

---

**Last Updated**: 2025-01-15  
**Version**: 1.0
