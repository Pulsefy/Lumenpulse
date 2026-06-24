# Blockchain Audit System - Testing Guide

## Verification Checklist

Use this guide to verify the blockchain audit system is working correctly after deployment.

## Pre-Test Setup

### 1. Get Admin JWT Token

```bash
# Login as admin user
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@lumenpulse.com",
    "password": "your_password"
  }'

# Extract the token from response
export JWT_TOKEN="eyJhbGciOiJIUzI1NiIs..."
```

### 2. Verify Database

```bash
# Connect to PostgreSQL
psql -U postgres -h localhost -d lumenpulse

# Check if table exists
SELECT * FROM information_schema.tables 
WHERE table_name = 'blockchain_audit_logs';

# Verify columns
\d blockchain_audit_logs

# Check indexes
SELECT indexname FROM pg_indexes 
WHERE tablename = 'blockchain_audit_logs';
```

Expected indexes:
- idx_blockchain_audit_actor_id
- idx_blockchain_audit_target_contract
- idx_blockchain_audit_tx_hash
- idx_blockchain_audit_created_at

## Test 1: Query Empty Audit Logs

```bash
curl -X GET "http://localhost:3000/admin/blockchain-audit" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json"
```

**Expected Response:**
```json
{
  "logs": [],
  "count": 0
}
```

## Test 2: Permission Check (Non-Admin)

```bash
# Get non-admin token
export NON_ADMIN_TOKEN="eyJhbGciOiJIUzI1NiIs..."

# Try to access audit logs
curl -X GET "http://localhost:3000/admin/blockchain-audit" \
  -H "Authorization: Bearer $NON_ADMIN_TOKEN" \
  -H "Content-Type: application/json"
```

**Expected Response:**
```
403 Forbidden
```

## Test 3: Trigger Blockchain Action (Matching Pool)

Assuming you have testnet funded and configured:

```bash
curl -X POST "http://localhost:3000/admin/matching-pool/rounds" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Round",
    "matchingFunds": "1000000"
  }'
```

**Expected Response:**
```json
{
  "roundId": "0x...",
  "txHash": "0x1234567890abcdef...",
  "status": "success",
  "createdAt": "2025-01-15T10:30:00Z"
}
```

**Save the txHash for later testing:** `export TX_HASH="0x..."`

## Test 4: Verify Audit Log Created

After action completes (give 1-2 seconds), query audit logs:

```bash
curl -X GET "http://localhost:3000/admin/blockchain-audit?limit=10" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json"
```

**Expected Response:**
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
        "name": "Test Round",
        "matchingFunds": "1000000"
      },
      "txHash": "0x1234567890abcdef...",
      "txStatus": "success",
      "ledgerSeq": 12345678,
      "actionDescription": "Create a new matching round with specified funds",
      "ipAddress": "127.0.0.1",
      "createdAt": "2025-01-15T10:30:00Z",
      "errorMessage": null
    }
  ],
  "count": 1
}
```

### Verify Audit Log Content

- ✅ `actorId` matches your admin user ID
- ✅ `actorDisplay` shows your email
- ✅ `endpoint` is correct: `POST /admin/matching-pool/rounds`
- ✅ `targetContract` is `matching_pool`
- ✅ `functionName` is `create_round`
- ✅ `params_summary` contains: `name`, `matchingFunds` (not redacted)
- ✅ `txHash` matches response from action
- ✅ `txStatus` is `success`
- ✅ `createdAt` is recent

## Test 5: Query by Transaction Hash

```bash
curl -X GET "http://localhost:3000/admin/blockchain-audit/by-tx/$TX_HASH" \
  -H "Authorization: Bearer $JWT_TOKEN"
```

**Expected Response:**
```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "txHash": "0x1234567890abcdef...",
    // ... rest of audit log
  }
]
```

## Test 6: Query by Actor

Get your admin user ID (from audit log response above):

```bash
export ACTOR_ID="660e8400-e29b-41d4-a716-446655440111"

curl -X GET "http://localhost:3000/admin/blockchain-audit/by-actor/$ACTOR_ID" \
  -H "Authorization: Bearer $JWT_TOKEN"
```

**Expected Response:**
```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "actorId": "660e8400-e29b-41d4-a716-446655440111",
    // ... rest of audit log
  }
]
```

## Test 7: Query by Contract

```bash
curl -X GET "http://localhost:3000/admin/blockchain-audit/by-contract/matching_pool" \
  -H "Authorization: Bearer $JWT_TOKEN"
```

**Expected Response:**
```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "targetContract": "matching_pool",
    // ... rest of audit log
  }
]
```

## Test 8: Query by Status

```bash
curl -X GET "http://localhost:3000/admin/blockchain-audit?txStatus=success" \
  -H "Authorization: Bearer $JWT_TOKEN"
```

**Expected Response:**
```json
{
  "logs": [
    {
      "txStatus": "success",
      // ... rest of audit log
    }
  ],
  "count": 1
}
```

## Test 9: Test Pagination

```bash
curl -X GET "http://localhost:3000/admin/blockchain-audit?limit=5&offset=0" \
  -H "Authorization: Bearer $JWT_TOKEN"
```

**Expected Response:**
- `logs` array with up to 5 items
- `count` shows total available

## Test 10: Test Sorting

```bash
curl -X GET "http://localhost:3000/admin/blockchain-audit?sortBy=createdAt&sortOrder=ASC" \
  -H "Authorization: Bearer $JWT_TOKEN"
```

**Expected Response:**
- Logs sorted by creation date in ascending order

## Test 11: Test Date Range Filtering

```bash
# Get logs from last hour
START_DATE=$(date -u -d '1 hour ago' '+%Y-%m-%dT%H:%M:%SZ')
END_DATE=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

curl -X GET "http://localhost:3000/admin/blockchain-audit?startDate=$START_DATE&endDate=$END_DATE" \
  -H "Authorization: Bearer $JWT_TOKEN"
```

**Expected Response:**
- Only logs within the specified date range

## Test 12: Get Single Log by ID

From any previous response, extract an audit log ID:

```bash
export LOG_ID="550e8400-e29b-41d4-a716-446655440000"

curl -X GET "http://localhost:3000/admin/blockchain-audit/$LOG_ID" \
  -H "Authorization: Bearer $JWT_TOKEN"
```

**Expected Response:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  // ... complete audit log details
}
```

## Test 13: Sensitive Data Redaction

Create an endpoint that accepts sensitive parameters:

```bash
# If you have a test endpoint with sensitive data
curl -X POST "http://localhost:3000/admin/test-sensitive" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test",
    "apiKey": "secret_key_12345",
    "password": "myPassword123",
    "beneficiary": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
  }'

# Query audit logs and verify redaction
curl -X GET "http://localhost:3000/admin/blockchain-audit" \
  -H "Authorization: Bearer $JWT_TOKEN"
```

**Expected in paramsSummary:**
```json
{
  "name": "Test",
  "apiKey": "[REDACTED]",
  "password": "[REDACTED]",
  "beneficiary": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
}
```

## Test 14: Treasury Action Audit

```bash
curl -X POST "http://localhost:3000/treasury/streams" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "beneficiary": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    "amount": "500000",
    "startTime": 1705315200,
    "duration": 2592000
  }'

# Verify it was audited
curl -X GET "http://localhost:3000/admin/blockchain-audit?targetContract=treasury" \
  -H "Authorization: Bearer $JWT_TOKEN"
```

**Expected in audit log:**
- `targetContract`: "treasury"
- `functionName`: "allocate_budget"
- `paramsSummary`: Contains beneficiary, amount, startTime, duration

## Test 15: Database Query Verification

Direct database verification:

```bash
# Connect to database
psql -U postgres -h localhost -d lumenpulse

# Count audit logs
SELECT COUNT(*) FROM blockchain_audit_logs;

# View recent logs
SELECT 
  id, 
  actor_display, 
  endpoint, 
  target_contract, 
  tx_hash, 
  created_at 
FROM blockchain_audit_logs 
ORDER BY created_at DESC 
LIMIT 10;

# Verify sensitive data redaction
SELECT params_summary FROM blockchain_audit_logs LIMIT 1;

# Check for null values
SELECT COUNT(*) FROM blockchain_audit_logs 
WHERE params_summary IS NOT NULL;
```

## Performance Tests

### Test 16: Query Performance (100+ logs)

Create many audit logs, then test query performance:

```bash
# Time the query
time curl -X GET "http://localhost:3000/admin/blockchain-audit?limit=100" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  > /dev/null
```

**Expected:** Response time < 500ms

### Test 17: Index Usage

Verify indexes are being used:

```sql
-- Database query plan
EXPLAIN ANALYZE
SELECT * FROM blockchain_audit_logs 
WHERE actor_id = '660e8400-e29b-41d4-a716-446655440111' 
ORDER BY created_at DESC 
LIMIT 50;

-- Should show index scan, not seq scan
```

## Integration Tests (Optional)

Create a test script that:

1. ✅ Creates multiple audit logs
2. ✅ Queries with various filters
3. ✅ Verifies data integrity
4. ✅ Tests concurrent access
5. ✅ Checks error handling

Example test case:

```typescript
describe('Blockchain Audit System', () => {
  it('should create audit log on blockchain action', async () => {
    const response = await request(app.getHttpServer())
      .post('/admin/matching-pool/rounds')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({ name: 'Test', matchingFunds: '1000000' });

    expect(response.status).toBe(201);

    // Give async logger time to persist
    await new Promise(resolve => setTimeout(resolve, 100));

    const auditLogs = await request(app.getHttpServer())
      .get('/admin/blockchain-audit')
      .set('Authorization', `Bearer ${jwtToken}`);

    expect(auditLogs.body.count).toBeGreaterThan(0);
    expect(auditLogs.body.logs[0].targetContract).toBe('matching_pool');
  });

  it('should redact sensitive data', async () => {
    // Create action with sensitive params
    // Verify they're redacted in audit log
  });

  it('should deny non-admin access', async () => {
    const response = await request(app.getHttpServer())
      .get('/admin/blockchain-audit')
      .set('Authorization', `Bearer ${userToken}`);

    expect(response.status).toBe(403);
  });
});
```

## Common Issues & Solutions

| Issue | Solution |
|-------|----------|
| Can't query audit logs | Verify JWT token is valid and user is ADMIN |
| Audit logs not created | Check interceptor is registered in AppModule |
| Wrong contract address | Verify config.stellar.contracts configuration |
| Sensitive data not redacted | Check field name matches redaction patterns |
| Slow queries | Verify indexes are created and used |
| Database error | Run migrations: `npm run typeorm migration:run` |

## Success Criteria

- ✅ All 17 tests pass
- ✅ Audit logs created for all blockchain actions
- ✅ Sensitive data properly redacted
- ✅ Queries return correct data
- ✅ Permissions enforced correctly
- ✅ Performance is acceptable (<500ms for queries)
- ✅ Database indexes are used

---

**When complete, you're ready for production deployment!**
