# Contract ID Rotation Feature - Implementation Guide

## Overview

This feature allows maintainers to safely update/rotate testnet contract IDs without code changes while keeping a complete audit trail. It implements all acceptance criteria:

✅ Admin-only endpoint to update contract IDs for testnet  
✅ Validates new IDs are reachable/callable before persisting  
✅ Writes audit log entry (who/when/what changed)  
✅ Updates the config endpoint output used by clients  
✅ Prevents partial updates (all-or-nothing transaction)

## Architecture

### Components

1. **ContractRotationService** (`stellar/services/contract-rotation.service.ts`)
   - Validates contract IDs by simulating read-only contract calls
   - Uses Soroban RPC to verify contracts are reachable and callable
   - Supports both testnet and mainnet validation

2. **StellarContractRotationService** (`stellar/services/stellar-contract-rotation.service.ts`)
   - Orchestrates the rotation workflow
   - Applies atomic updates to contract IDs
   - Handles audit logging
   - Invalidates config cache

3. **StellarController** (`stellar/stellar.controller.ts`)
   - Two new endpoints:
     - `POST /v1/stellar/admin/validate-contract-ids` - Pre-flight validation
     - `POST /v1/stellar/admin/rotate-contract-ids` - Execute rotation with audit logging

4. **ConfigService** (`config/config.service.ts`)
   - Enhanced with cache invalidation support
   - Ensures clients receive updated contract IDs after rotation

5. **AuditService** (`audit/audit.service.ts`)
   - Logs all contract rotation activities
   - Records who changed what, when, and why

## API Endpoints

### 1. Validate Contract IDs (Pre-flight Check)

```http
POST /v1/stellar/admin/validate-contract-ids
Authorization: Bearer {jwt_token}
Content-Type: application/json

{
  "contracts": {
    "lumenToken": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
    "crowdfundVault": "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"
  }
}
```

**Response:**
```json
{
  "valid": true,
  "results": [
    {
      "name": "lumenToken",
      "isValid": true
    },
    {
      "name": "crowdfundVault",
      "isValid": true
    }
  ]
}
```

**Error Response (Invalid Contract):**
```json
{
  "valid": false,
  "results": [
    {
      "name": "lumenToken",
      "isValid": false,
      "error": "Contract not callable: Simulation error for method 'decimals': Not found"
    }
  ],
  "error": "Some contracts failed validation"
}
```

**HTTP Status Codes:**
- `200 OK` - Validation completed (check the `valid` field)
- `400 Bad Request` - Invalid contract ID format
- `401 Unauthorized` - Missing or invalid JWT token
- `403 Forbidden` - User is not an admin
- `500 Internal Server Error` - Failed to connect to Soroban RPC

### 2. Rotate Contract IDs

```http
POST /v1/stellar/admin/rotate-contract-ids
Authorization: Bearer {jwt_token}
Content-Type: application/json

{
  "contracts": {
    "lumenToken": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
    "projectRegistry": "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC"
  },
  "reason": "Upgrading contracts to v2 deployment"
}
```

**Response:**
```json
{
  "message": "Contracts rotated successfully",
  "updatedContracts": {
    "lumenToken": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
    "projectRegistry": "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC"
  },
  "auditLogId": "550e8400-e29b-41d4-a716-446655440000",
  "rotatedAt": "2025-05-30T14:30:00Z"
}
```

**Validation Errors:**
```json
{
  "statusCode": 400,
  "message": "Contract validation failed: lumenToken: Invalid contract ID format: INVALID_ID; crowdfundVault: Contract not callable: Simulation error",
  "error": "Bad Request"
}
```

**HTTP Status Codes:**
- `200 OK` - Contracts rotated successfully
- `400 Bad Request` - Validation failed or invalid request
- `401 Unauthorized` - Missing or invalid JWT token
- `403 Forbidden` - User is not an admin
- `500 Internal Server Error` - Failed to connect to Soroban RPC or internal error

## How It Works

### Validation Process

1. **Format Validation**
   - Each contract ID is checked against Stellar's StrKey format
   - Invalid format returns immediate error

2. **On-Chain Validation**
   - Connects to Soroban RPC (testnet or mainnet)
   - Simulates read-only calls to each contract
   - Uses contract-specific validation methods:
     - `lumenToken`: calls `decimals()`
     - `crowdfundVault`: calls `get_admin()`
     - `projectRegistry`: calls `get_admin()`
     - `contributorRegistry`: calls `get_multisig_config()`
     - `matchingPool`: calls `get_admin()`
     - `treasury`: calls `get_admin()`

3. **Atomic Validation**
   - ALL contracts must pass validation
   - If ANY contract fails, no changes are made
   - Prevents partial updates

### Rotation Process

1. **Pre-Validation**
   - Same validation as above

2. **Atomic Update**
   - Updates all contract IDs in a single operation
   - Uses in-memory configuration update
   - In production, would use database transaction or config management system

3. **Audit Logging**
   - Creates audit log entry with:
     - Action: `contracts.rotate_testnet`
     - User ID: Admin who performed rotation
     - IP Address: Request origin
     - Metadata:
       - Updated contract names and new IDs
       - Previous values (for rollback capability)
       - Rotation reason (if provided)
       - Number of contracts changed

4. **Cache Invalidation**
   - Clears cached config endpoint response
   - Forces clients to fetch updated contract IDs
   - Config is re-cached for next 5 minutes

## Security Considerations

### Authentication & Authorization
- All endpoints require JWT token
- All endpoints require ADMIN role
- Uses standard NestJS guard chain: `JwtAuthGuard` → `RolesGuard`

### Data Validation
- Stellar contract ID format validation
- Required field validation
- Max length validation for reason (500 chars)

### Audit Trail
- Immutable audit logs in database
- Records complete history with timestamps
- Captures previous and new values
- Enables rollback capability

### Network Safety
- Simulated calls only (read-only)
- No state changes during validation
- Tests reachability before any persistent change
- Graceful error handling for network issues

## Configuration Requirements

The feature relies on existing environment variables:
- `STELLAR_SERVER_SECRET` - For Soroban RPC validation
- `STELLAR_NETWORK` - Current network (testnet/mainnet)
- `STELLAR_SOROBAN_RPC_URL` - Optional custom RPC endpoint

## Database Schema

### Audit Logs Table
```sql
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY,
  userId UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,  -- 'contracts.rotate_testnet'
  ipAddress VARCHAR(45),
  metadata JSONB,  -- Contains updatedContracts, reason, previousValues
  createdAt TIMESTAMP WITH TIME ZONE DEFAULT NOW()
)
```

Example metadata:
```json
{
  "updatedContracts": {
    "lumenToken": "CAAAA...",
    "projectRegistry": "CCCCC..."
  },
  "previousValues": {
    "lumenToken": "CBBBB...",
    "projectRegistry": "CDDDD..."
  },
  "reason": "Upgrading to v2 deployment",
  "contractCount": 2
}
```

## Usage Examples

### CLI Example (cURL)
```bash
# Validate new contract IDs
curl -X POST http://localhost:3000/v1/stellar/admin/validate-contract-ids \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "contracts": {
      "lumenToken": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4"
    }
  }'

# Rotate contracts
curl -X POST http://localhost:3000/v1/stellar/admin/rotate-contract-ids \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "contracts": {
      "lumenToken": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4"
    },
    "reason": "Upgrading to v2"
  }'
```

### TypeScript Client Example
```typescript
import axios from 'axios';

const client = axios.create({
  baseURL: 'http://localhost:3000',
  headers: {
    'Authorization': `Bearer ${jwtToken}`,
    'Content-Type': 'application/json'
  }
});

// Validate
const validation = await client.post('/v1/stellar/admin/validate-contract-ids', {
  contracts: {
    lumenToken: 'CAAAA...'
  }
});

if (validation.data.valid) {
  // Rotate
  const result = await client.post('/v1/stellar/admin/rotate-contract-ids', {
    contracts: {
      lumenToken: 'CAAAA...'
    },
    reason: 'Upgrading to v2'
  });
  
  console.log('Rotated:', result.data.updatedContracts);
  console.log('Audit Log ID:', result.data.auditLogId);
}
```

## Error Handling

### Common Error Scenarios

1. **Invalid Contract ID Format**
   ```json
   {
     "statusCode": 400,
     "message": "Contract validation failed: lumenToken: Invalid contract ID format: INVALID",
     "error": "Bad Request"
   }
   ```

2. **Contract Not Found on Network**
   ```json
   {
     "statusCode": 400,
     "message": "Contract validation failed: lumenToken: Contract not callable: Simulation error for method 'decimals': Not found",
     "error": "Bad Request"
   }
   ```

3. **Soroban RPC Connection Failed**
   ```json
   {
     "statusCode": 500,
     "message": "Failed to connect to Soroban RPC for validation: getaddrinfo ENOTFOUND soroban-testnet.stellar.org",
     "error": "Internal Server Error"
   }
   ```

4. **Missing Required Admin Role**
   ```json
   {
     "statusCode": 403,
     "message": "Forbidden",
     "error": "Forbidden"
   }
   ```

## Monitoring & Observability

### Audit Log Queries
```sql
-- Get recent contract rotations
SELECT id, userId, action, metadata, createdAt
FROM audit_logs
WHERE action = 'contracts.rotate_testnet'
ORDER BY createdAt DESC
LIMIT 10;

-- Get rotations by admin user
SELECT id, action, metadata, createdAt
FROM audit_logs
WHERE action = 'contracts.rotate_testnet'
  AND userId = 'admin-user-id'
ORDER BY createdAt DESC;

-- Check what contracts were updated
SELECT 
  id,
  metadata->'updatedContracts' as updated_contracts,
  metadata->>'reason' as reason,
  createdAt
FROM audit_logs
WHERE action = 'contracts.rotate_testnet'
ORDER BY createdAt DESC;
```

### Logging
- All validation errors are logged
- All successful rotations are logged
- Network errors are captured and logged
- Audit log entries serve as primary audit trail

## Testing

### Unit Test Examples

```typescript
describe('ContractRotationService', () => {
  let service: ContractRotationService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [ContractRotationService],
    }).compile();
    service = module.get<ContractRotationService>(ContractRotationService);
  });

  it('should validate valid contract IDs', async () => {
    const results = await service.validateContractIds(
      { lumenToken: 'CAAAA...' },
      'testnet'
    );
    expect(results[0].isValid).toBe(true);
  });

  it('should reject invalid contract IDs', async () => {
    const results = await service.validateContractIds(
      { lumenToken: 'INVALID' },
      'testnet'
    );
    expect(results[0].isValid).toBe(false);
    expect(results[0].error).toContain('Invalid contract ID format');
  });
});
```

### Integration Test Examples

```typescript
describe('Contract Rotation (Integration)', () => {
  it('POST /v1/stellar/admin/validate-contract-ids - should validate', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/stellar/admin/validate-contract-ids')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        contracts: { lumenToken: 'CAAAA...' }
      });

    expect(response.status).toBe(200);
    expect(response.body.valid).toBe(true);
  });

  it('POST /v1/stellar/admin/rotate-contract-ids - should rotate', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/stellar/admin/rotate-contract-ids')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        contracts: { lumenToken: 'CAAAA...' },
        reason: 'v2 upgrade'
      });

    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Contracts rotated successfully');
    expect(response.body.auditLogId).toBeDefined();
  });
});
```

## Future Enhancements

1. **Database Persistence**
   - Store contract IDs in database
   - Support rolling back to previous versions
   - Track version history

2. **Approval Workflow**
   - Require approval from multiple admins
   - Support scheduled rotations
   - Notifications for pending approvals

3. **Mainnet Support**
   - Support rotating mainnet contracts
   - Additional validation/approval for mainnet
   - Separate permissions for mainnet rotations

4. **Metrics & Dashboards**
   - Track rotation frequency
   - Monitor validation success rates
   - Alert on failed validations

5. **Scheduled Rotations**
   - Support scheduled contract rotations
   - Automatic rollback on failure
   - Pre-rotation notifications

## Files Modified/Created

### Created Files
- `src/stellar/dto/rotate-contract-ids.dto.ts` - DTOs for request/response
- `src/stellar/services/contract-rotation.service.ts` - Validation logic
- `src/stellar/services/stellar-contract-rotation.service.ts` - Rotation orchestration

### Modified Files
- `src/stellar/stellar.controller.ts` - Added new endpoints
- `src/stellar/stellar.module.ts` - Registered new services
- `src/config/config.service.ts` - Added cache invalidation

## Deployment Checklist

- [ ] Code review and approval
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] E2E tests pass
- [ ] Database migrations run (if needed)
- [ ] Environment variables configured
- [ ] Audit logs table verified
- [ ] Cache manager available
- [ ] Admin users created/verified
- [ ] API documentation updated (Swagger)
- [ ] Monitoring/alerting configured
- [ ] Rollback plan documented
- [ ] Production deployment
- [ ] Smoke tests in production
- [ ] Monitor audit logs for issues
