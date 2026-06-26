# Contract ID Rotation - Quick Reference Guide

## 📋 Quick Summary

Feature allows maintainers to safely rotate testnet contract IDs at runtime without code changes, with full audit logging and validation.

**Story Points**: 150 | **Status**: ✅ Implemented

## 🚀 Usage

### 1. Validate Contract IDs (Pre-flight Check)
```bash
curl -X POST http://localhost:3000/v1/stellar/admin/validate-contract-ids \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "contracts": {
      "lumenToken": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
      "crowdfundVault": "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"
    }
  }'
```

**Response**: `{ "valid": true, "results": [...] }`

### 2. Rotate Contract IDs
```bash
curl -X POST http://localhost:3000/v1/stellar/admin/rotate-contract-ids \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "contracts": {
      "lumenToken": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4"
    },
    "reason": "Upgrading to v2 deployment"
  }'
```

**Response**: 
```json
{
  "message": "Contracts rotated successfully",
  "updatedContracts": {
    "lumenToken": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4"
  },
  "auditLogId": "550e8400-e29b-41d4-a716-446655440000",
  "rotatedAt": "2025-05-30T14:30:00Z"
}
```

## 📁 Files Overview

### Core Implementation
| File | Purpose |
|------|---------|
| `src/stellar/services/contract-rotation.service.ts` | Validation logic |
| `src/stellar/services/stellar-contract-rotation.service.ts` | Orchestration |
| `src/stellar/dto/rotate-contract-ids.dto.ts` | Data structures |

### API
| File | Purpose |
|------|---------|
| `src/stellar/stellar.controller.ts` | HTTP endpoints |
| `src/stellar/stellar.module.ts` | Service registration |

### Configuration
| File | Purpose |
|------|---------|
| `src/config/config.service.ts` | Cache invalidation |

### Tests
| File | Purpose |
|------|---------|
| `src/stellar/services/contract-rotation.service.spec.ts` | Unit tests |
| `src/stellar/tests/contract-rotation.integration.spec.ts` | Integration tests |

### Documentation
| File | Purpose |
|------|---------|
| `FEATURE_CONTRACT_ROTATION.md` | Comprehensive guide |
| `IMPLEMENTATION_SUMMARY_CONTRACT_ROTATION.md` | Implementation details |

## 🔐 Security

✅ **Admin-only** - Requires `@Roles(UserRole.ADMIN)`  
✅ **Authenticated** - Requires JWT token  
✅ **Validated** - Contract IDs verified on-chain  
✅ **Audited** - All changes logged in database  
✅ **Atomic** - All-or-nothing transaction  

## ⚙️ Requirements

- JWT authentication configured
- Admin users created
- Audit logs table exists
- Cache manager configured
- Soroban RPC accessible

## 🧪 Testing

### Run Unit Tests
```bash
npm test -- src/stellar/services/contract-rotation.service.spec.ts
```

### Run Integration Tests
```bash
npm test -- src/stellar/tests/contract-rotation.integration.spec.ts
```

## 📊 Contract Types

All six contract types supported:
1. **lumenToken** - Validates with `decimals()`
2. **crowdfundVault** - Validates with `get_admin()`
3. **projectRegistry** - Validates with `get_admin()`
4. **contributorRegistry** - Validates with `get_multisig_config()`
5. **matchingPool** - Validates with `get_admin()`
6. **treasury** - Validates with `get_admin()`

## 🔄 Validation Flow

```
Request
  ↓
Format Validation (< 1ms)
  ↓
On-Chain Validation (100-500ms)
  ↓
If ALL valid:
  - Apply changes
  - Create audit log
  - Invalidate cache
  - Return success
↓
If ANY invalid:
  - No changes made
  - Return error
```

## 📝 Audit Log Format

```json
{
  "action": "contracts.rotate_testnet",
  "userId": "admin-user-123",
  "ipAddress": "192.168.1.1",
  "metadata": {
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
  },
  "createdAt": "2025-05-30T14:30:00Z"
}
```

## 🚨 Error Responses

### 400 Bad Request
```json
{
  "statusCode": 400,
  "message": "Contract validation failed: lumenToken: Invalid contract ID format: INVALID",
  "error": "Bad Request"
}
```

### 401 Unauthorized
```json
{
  "statusCode": 401,
  "message": "Unauthorized"
}
```

### 403 Forbidden
```json
{
  "statusCode": 403,
  "message": "Forbidden"
}
```

### 500 Internal Server Error
```json
{
  "statusCode": 500,
  "message": "Failed to connect to Soroban RPC for validation: ...",
  "error": "Internal Server Error"
}
```

## 🔧 Implementation Details

### Two-Phase Validation
1. **Format Validation** - Checks Stellar contract ID format
2. **On-Chain Validation** - Simulates read-only contract calls

### Atomic Operations
- Validates ALL contracts before making ANY changes
- Prevents partial updates
- Ensures consistency

### Cache Invalidation
- Clears config endpoint cache after rotation
- Forces clients to fetch updated values
- Prevents stale contract IDs

### Audit Trail
- Records who, when, what, and why
- Stores previous values for rollback capability
- Immutable history in database

## 📚 Related Documentation

- `FEATURE_CONTRACT_ROTATION.md` - Full feature guide
- `IMPLEMENTATION_SUMMARY_CONTRACT_ROTATION.md` - Technical details
- Backend README - General architecture

## ❓ FAQ

**Q: Can I rotate just one contract?**  
A: Yes, only the specified contracts are updated. Others are unchanged.

**Q: What if validation fails?**  
A: No changes are made. The error message explains which contracts failed.

**Q: How are changes tracked?**  
A: All changes are logged in the audit_logs table with full details.

**Q: Can I rollback a rotation?**  
A: Not automatically, but previous values are stored in audit logs for manual rollback.

**Q: Is mainnet supported?**  
A: Currently testnet only. Mainnet support planned for future release.

**Q: What happens if the network is down?**  
A: Validation fails with a 500 error. No changes are made.

**Q: How long does validation take?**  
A: Format check is instant, on-chain validation takes 100-500ms per contract.

**Q: Can regular users rotate contracts?**  
A: No, only ADMIN role users can access these endpoints.

## 🐛 Troubleshooting

### Validation fails with "Contract not found"
- Verify contract ID is deployed to testnet
- Check contract ID is correct format

### "Failed to connect to Soroban RPC"
- Check network connectivity
- Verify Soroban RPC endpoint is accessible
- Check `STELLAR_SOROBAN_RPC_URL` environment variable

### Audit log not created
- Verify audit_logs table exists
- Check database connectivity
- Verify AuditService is initialized

### Config endpoint still shows old IDs
- Wait for cache TTL (5 minutes) or manually clear cache
- Verify cache invalidation was called
- Check CacheModule is configured

## 📞 Support

For issues or questions:
1. Check `FEATURE_CONTRACT_ROTATION.md` for detailed documentation
2. Review test files for usage examples
3. Check audit logs for operation history
4. Verify environment variables and dependencies

## ✅ Acceptance Criteria Checklist

- [x] Admin-only endpoint to update contract IDs for testnet
- [x] Validates new IDs are reachable/callable before persisting
- [x] Writes audit log entry (who/when/what changed)
- [x] Updates the config endpoint output used by clients
- [x] Prevents partial updates (all-or-nothing transaction)

**Status**: ✅ All criteria met and implemented
