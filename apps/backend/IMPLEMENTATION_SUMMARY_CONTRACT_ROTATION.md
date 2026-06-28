# Contract ID Rotation Feature - Implementation Summary

## Feature Overview

This implementation provides a secure, audit-logged system for rotating testnet contract IDs at runtime without code changes. It fulfills all acceptance criteria with a production-ready architecture.

## Acceptance Criteria Fulfilled

| Criterion | Implementation | Status |
|-----------|-----------------|--------|
| Admin-only endpoint | `POST /v1/stellar/admin/rotate-contract-ids` with `@Roles(UserRole.ADMIN)` guard | ✅ |
| Validates reachability before persist | `ContractRotationService.validateContractIds()` simulates contract reads | ✅ |
| Writes audit log | `AuditService.log()` records who/when/what/why in database | ✅ |
| Updates config endpoint | Cache invalidation forces clients to fetch updated values | ✅ |
| All-or-nothing transaction | Validation of ALL contracts must pass before ANY changes made | ✅ |

## Architecture Overview

### Service Layer

#### 1. **ContractRotationService** (Validation)
- **File**: `src/stellar/services/contract-rotation.service.ts`
- **Responsibility**: Validates contract IDs by simulating read-only calls
- **Key Methods**:
  - `validateContractIds(contractIds, network)` - Validates multiple contracts
  - `simulateContractRead()` - Simulates a read method call on-chain
  - `loadSimulationContext()` - Sets up RPC connection and account

**Features**:
- Two-phase validation: Format → On-chain
- Format validation rejects immediately (before RPC calls)
- On-chain validation simulates safe read-only methods
- Supports testnet and mainnet validation
- Graceful error handling for network issues

#### 2. **StellarContractRotationService** (Orchestration)
- **File**: `src/stellar/services/stellar-contract-rotation.service.ts`
- **Responsibility**: Orchestrates the rotation workflow
- **Key Methods**:
  - `rotateContractIds()` - Main entry point (validates → applies → audits → invalidates cache)

**Features**:
- Validates all contracts before making ANY changes
- Atomic updates: All-or-nothing
- Creates detailed audit logs
- Invalidates config cache for clients
- Captures IP address and user context

#### 3. **ConfigService** (Cache Management)
- **File**: `src/stellar/config/config.service.ts`
- **Responsibility**: Manages Stellar config endpoint and cache
- **Key Methods**:
  - `invalidateCache()` - Clears cached config after rotation

**Features**:
- Injects CACHE_MANAGER for cache control
- Cache key: `stellar-config`
- 5-minute TTL for config endpoint

### API Endpoints

#### 1. **Validation Endpoint** (Pre-flight Check)
```
POST /v1/stellar/admin/validate-contract-ids
Authorization: Bearer {JWT}

Request:
{
  "contracts": {
    "lumenToken": "CAAAA...",
    "crowdfundVault": "CBBBBB..."
  }
}

Response:
{
  "valid": true,
  "results": [
    { "name": "lumenToken", "isValid": true },
    { "name": "crowdfundVault", "isValid": true }
  ]
}
```

**Purpose**: Allow admins to validate contract IDs without making changes

#### 2. **Rotation Endpoint** (Execute Rotation)
```
POST /v1/stellar/admin/rotate-contract-ids
Authorization: Bearer {JWT}

Request:
{
  "contracts": {
    "lumenToken": "CAAAA...",
    "projectRegistry": "CCCCC..."
  },
  "reason": "Upgrading to v2 deployment"
}

Response:
{
  "message": "Contracts rotated successfully",
  "updatedContracts": {
    "lumenToken": "CAAAA...",
    "projectRegistry": "CCCCC..."
  },
  "auditLogId": "550e8400-e29b-41d4-a716-446655440000",
  "rotatedAt": "2025-05-30T14:30:00Z"
}
```

**Purpose**: Execute contract rotation with full validation and audit logging

### Data Transfer Objects (DTOs)

**File**: `src/stellar/dto/rotate-contract-ids.dto.ts`

- `ContractIdUpdateDto` - Partial contract updates (all fields optional)
- `RotateTestnetContractIdsRequestDto` - Request with contracts + reason
- `RotateContractIdsResponseDto` - Success response with audit info
- `ValidateContractIdsRequestDto` - Validation request
- `ValidateContractIdsResponseDto` - Validation results
- `ContractValidationResultDto` - Per-contract validation status

### Validation Strategy

**Phase 1: Format Validation**
```typescript
// Check Stellar contract ID format immediately
if (!StrKey.isValidContract(contractId)) {
  return { isValid: false, error: "Invalid contract ID format" }
}
```

**Phase 2: On-Chain Validation**
```typescript
// Simulate read-only method calls to verify reachability
const tx = new TransactionBuilder(...).addOperation(
  new Contract(contractId).call(methodName)
).build()
const simulation = await rpc.simulateTransaction(tx)

// Success: contract is reachable and callable
// Failure: contract not found or restore required
```

**Phase 3: Atomic Decision**
```typescript
// ALL contracts must pass validation
if (validationResults.some(r => !r.isValid)) {
  throw BadRequestException("Validation failed")
  // No changes made at this point
}

// THEN apply changes
applyContractUpdates(updates)
```

## Audit Logging

### Audit Log Entry Structure
```sql
INSERT INTO audit_logs (
  id, userId, action, ipAddress, metadata, createdAt
) VALUES (
  $1, $2, 'contracts.rotate_testnet', $3, $4, NOW()
)
```

### Metadata Content
```json
{
  "updatedContracts": {
    "lumenToken": "CAAAA...",
    "projectRegistry": "CCCCC..."
  },
  "previousValues": {
    "lumenToken": "CBBBBB...",
    "projectRegistry": "CDDDD..."
  },
  "reason": "Upgrading to v2 deployment",
  "contractCount": 2
}
```

### Audit Trail Capabilities
- **Who**: User ID in `userId` field
- **When**: Timestamp in `createdAt`
- **What**: Contract names and IDs in `updatedContracts`
- **Why**: Optional `reason` field
- **Rollback**: Previous values stored in `previousValues`

## Security Implementation

### Authentication
```typescript
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
```
- Requires valid JWT token
- Guards chain: JWT validation → Role verification
- Only ADMIN users can access endpoints

### Authorization
```typescript
// RolesGuard checks UserRole.ADMIN
if (!user.roles.includes(UserRole.ADMIN)) {
  throw ForbiddenException()
}
```

### Data Validation
```typescript
// Class-validator decorators
@IsString() @IsOptional() contractId?: string
@IsString() @IsOptional() reason?: string
```

### Network Safety
- Only simulated (read-only) calls to Soroban RPC
- No state-changing operations during validation
- Graceful error handling for network issues
- Redaction of sensitive contract IDs in logs

## Error Handling

### Validation Errors
```json
{
  "statusCode": 400,
  "message": "Contract validation failed: lumenToken: Invalid contract ID format: INVALID",
  "error": "Bad Request"
}
```

### Authentication Errors
```json
{
  "statusCode": 401,
  "message": "Unauthorized",
  "error": "Unauthorized"
}
```

### Authorization Errors
```json
{
  "statusCode": 403,
  "message": "Forbidden",
  "error": "Forbidden"
}
```

### RPC Connection Errors
```json
{
  "statusCode": 500,
  "message": "Failed to connect to Soroban RPC for validation: getaddrinfo ENOTFOUND soroban-testnet.stellar.org",
  "error": "Internal Server Error"
}
```

## Configuration

### Environment Variables Used
- `STELLAR_SERVER_SECRET` - For Soroban RPC simulation
- `STELLAR_NETWORK` - Current network (testnet/mainnet)
- `STELLAR_SOROBAN_RPC_URL` - Optional custom RPC endpoint

### Database Requirements
- `audit_logs` table must exist
- Indexes on `userId`, `action`, `createdAt`
- JSONB support for `metadata` column

### Cache Manager
- Required: `@nestjs/cache-manager` must be configured
- Used for: Invalidating config endpoint cache
- Cache key: `stellar-config`

## Implementation Checklist

### Code Files Created
- [x] `src/stellar/dto/rotate-contract-ids.dto.ts` (6 DTOs)
- [x] `src/stellar/services/contract-rotation.service.ts` (validation logic)
- [x] `src/stellar/services/stellar-contract-rotation.service.ts` (orchestration)
- [x] `src/stellar/tests/contract-rotation.integration.spec.ts` (integration tests)
- [x] `src/stellar/services/contract-rotation.service.spec.ts` (unit tests)

### Code Files Modified
- [x] `src/stellar/stellar.controller.ts` (added 2 endpoints)
- [x] `src/stellar/stellar.module.ts` (registered services)
- [x] `src/config/config.service.ts` (added cache invalidation)

### Documentation Files Created
- [x] `FEATURE_CONTRACT_ROTATION.md` (comprehensive guide)
- [x] This implementation summary

## Testing

### Unit Tests
**Location**: `src/stellar/services/contract-rotation.service.spec.ts`

Covers:
- Contract ID format validation
- On-chain validation error handling
- Multiple contract validation
- Network error handling
- Contract-specific validation methods

### Integration Tests
**Location**: `src/stellar/tests/contract-rotation.integration.spec.ts`

Covers:
- Validation endpoint behavior
- Rotation endpoint behavior
- Authentication/authorization
- Audit logging
- Cache invalidation
- Error scenarios

## Deployment Steps

1. **Code Review**
   - Review DTOs and services for correctness
   - Review error handling and edge cases

2. **Database**
   - Ensure `audit_logs` table exists
   - Create indexes if needed

3. **Configuration**
   - Verify environment variables configured
   - Verify cache manager configured

4. **Testing**
   - Run unit tests: `npm test -- contract-rotation.service.spec.ts`
   - Run integration tests: `npm test -- contract-rotation.integration.spec.ts`

5. **Deployment**
   - Deploy code to production
   - Monitor audit logs for issues

6. **Verification**
   - Test validation endpoint with test contract IDs
   - Verify audit logs are created
   - Check config endpoint invalidation works

## Performance Considerations

### Validation Latency
- Format validation: < 1ms per contract
- On-chain validation: 100-500ms per contract (network dependent)
- Total validation time: 200-3000ms for multiple contracts

### Optimization Tips
1. Validate locally before calling API
2. Consider batch validation for multiple contract sets
3. Monitor Soroban RPC response times
4. Cache validation results client-side

## Future Enhancements

1. **Mainnet Support**
   - Add separate `/admin/rotate-contract-ids-mainnet` endpoint
   - Require additional approval step for mainnet

2. **Approval Workflow**
   - Require approval from multiple admins
   - Scheduled rotations

3. **Database Persistence**
   - Store contract IDs in database
   - Support version history and rollback

4. **Monitoring**
   - Metrics for validation success rate
   - Alerts for failed rotations
   - Dashboard for recent changes

5. **Rate Limiting**
   - Prevent rapid contract rotation
   - Alert on suspicious activity

## Key Decision Points

### Why Read-Only Simulation?
- Safe: No state changes
- Fast: Validates reachability quickly
- Reliable: Tests actual contract responses

### Why Atomic Validation?
- Prevents partial updates that could break client connections
- Ensures consistency across all contracts
- Simplifies error handling and rollback

### Why Cache Invalidation?
- Clients may cache config for 5 minutes
- Rotation would be invisible without invalidation
- Forces clients to fetch updated contract IDs immediately

### Why Detailed Audit Logs?
- Compliance requirements
- Troubleshooting capability
- Rollback capability (previous values stored)
- Historical analysis

## Support & Troubleshooting

### Common Issues

**Issue**: Validation fails with "Contract not found"
- **Cause**: Contract ID doesn't exist on specified network
- **Solution**: Verify contract ID is deployed to testnet

**Issue**: Soroban RPC connection timeout
- **Cause**: Network latency or RPC service down
- **Solution**: Check Soroban RPC status, try again later

**Issue**: Config endpoint still returns old contract IDs
- **Cause**: Cache wasn't invalidated
- **Solution**: Manually clear cache or wait for TTL expiry

**Issue**: Audit log not created
- **Cause**: Database error or service failure
- **Solution**: Check database connectivity and audit_logs table

## References

- [Stellar Contract Validation](https://developers.stellar.org/learn/example-contracts)
- [Soroban RPC Documentation](https://soroban.stellar.org/docs/learn/storing-data)
- [Contract ID Format](https://developers.stellar.org/learn/building-with-stellar/smart-contracts/storing-data)
