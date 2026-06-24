# Blockchain Audit Trail System - Documentation Index

## Overview

Welcome to the blockchain audit trail system for LumenPulse! This system provides a complete, auditable record of all admin-triggered blockchain actions.

This directory contains everything you need to understand, deploy, and maintain the system.

## Documentation Guide

### 📋 For Different Audiences

#### I'm a Developer Adding a New Endpoint
**Start here:** [`QUICK_REFERENCE.md`](./QUICK_REFERENCE.md)
- 30-second overview
- How to decorate your endpoint
- Example code
- Common gotchas

#### I'm Deploying This System
**Start here:** [`IMPLEMENTATION_GUIDE.md`](./IMPLEMENTATION_GUIDE.md)
- Complete deployment checklist
- Pre/post deployment steps
- Database setup
- Monitoring & alerts
- Performance considerations

#### I Need Complete Technical Details
**Start here:** [`BLOCKCHAIN_AUDIT.md`](./BLOCKCHAIN_AUDIT.md)
- Full architecture explanation
- Entity schema with documentation
- Service layer details
- All query examples
- Sensitive data redaction explained
- Compliance & security section

#### I Need to Verify the System Works
**Start here:** [`TESTING_GUIDE.md`](./TESTING_GUIDE.md)
- 17 verification tests
- Permission testing
- Data redaction testing
- Performance testing
- Database integrity checks

### 📊 Documentation Files

| File | Purpose | Audience | Length |
|------|---------|----------|--------|
| [`QUICK_REFERENCE.md`](./QUICK_REFERENCE.md) | Quick developer guide | Developers | 5 min read |
| [`BLOCKCHAIN_AUDIT.md`](./BLOCKCHAIN_AUDIT.md) | Complete technical docs | Technical leads | 15 min read |
| [`IMPLEMENTATION_GUIDE.md`](./IMPLEMENTATION_GUIDE.md) | Deployment guide | DevOps / Backend leads | 20 min read |
| [`TESTING_GUIDE.md`](./TESTING_GUIDE.md) | Verification tests | QA / Testers | 30 min |

### 🗂️ Source Code Files

**Core System**
- `entities/blockchain-audit-log.entity.ts` - Database entity definition
- `blockchain-audit.service.ts` - Business logic & redaction
- `blockchain-audit.controller.ts` - REST API endpoints
- `decorators/blockchain-audit.decorator.ts` - Endpoint decorator
- `interceptors/blockchain-audit.interceptor.ts` - Request interceptor

**Integration**
- `audit.module.ts` - NestJS module definition
- `../app.module.ts` - Global interceptor registration
- `../database/migrations/1801000000000-CreateBlockchainAuditLogs.ts` - Database migration

**Controllers Updated**
- `../stellar/controllers/matching-pool-admin.controller.ts`
- `../treasury/treasury.controller.ts`

## Quick Links

### Common Tasks

#### 🚀 Deploy the System
```bash
npm run typeorm migration:run
npm run build && npm start
```
→ Full guide: [`IMPLEMENTATION_GUIDE.md`](./IMPLEMENTATION_GUIDE.md)

#### 📝 Add Audit to a New Endpoint
```typescript
@BlockchainAudit({
  targetContract: 'treasury',
  functionName: 'my_function',
  description: 'What this does',
  paramsToLog: ['field1', 'field2'],
})
```
→ Details: [`QUICK_REFERENCE.md`](./QUICK_REFERENCE.md)

#### 🔍 Query Audit Logs
```bash
curl http://localhost:3000/admin/blockchain-audit \
  -H "Authorization: Bearer <JWT>"
```
→ All options: [`BLOCKCHAIN_AUDIT.md`](./BLOCKCHAIN_AUDIT.md)

#### ✅ Test the System
See section "Verify Installation" in [`IMPLEMENTATION_GUIDE.md`](./IMPLEMENTATION_GUIDE.md)
Or follow full 17-test guide: [`TESTING_GUIDE.md`](./TESTING_GUIDE.md)

## Key Features

| Feature | Status | Documentation |
|---------|--------|-----------------|
| Capture blockchain actions | ✅ | BLOCKCHAIN_AUDIT.md |
| Query audit logs | ✅ | BLOCKCHAIN_AUDIT.md |
| Sensitive data redaction | ✅ | BLOCKCHAIN_AUDIT.md |
| Admin-only access | ✅ | BLOCKCHAIN_AUDIT.md |
| Database indexes | ✅ | IMPLEMENTATION_GUIDE.md |
| Async logging | ✅ | QUICK_REFERENCE.md |

## Covered Admin Actions

### Matching Pool
- ✅ `POST /admin/matching-pool/rounds` - Create matching round
- ✅ `POST /admin/matching-pool/rounds/:roundId/approve-project` - Approve project

### Treasury
- ✅ `POST /treasury/streams` - Allocate budget & vesting stream

### Registry
- 📋 Framework ready for implementation

## API Endpoints Reference

```
GET    /admin/blockchain-audit                    # Query with filters
GET    /admin/blockchain-audit/:id                # Get single log
GET    /admin/blockchain-audit/by-tx/:txHash      # Find by transaction
GET    /admin/blockchain-audit/by-actor/:actorId  # Find by admin user
GET    /admin/blockchain-audit/by-contract/:name  # Find by contract
```

All endpoints require:
- ✅ JWT authentication
- ✅ ADMIN role

Full documentation: [`BLOCKCHAIN_AUDIT.md`](./BLOCKCHAIN_AUDIT.md)

## Database Schema

```sql
CREATE TABLE blockchain_audit_logs (
  id UUID PRIMARY KEY,
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
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);
```

Optimized with indexes on: actor_id, target_contract, tx_hash, created_at

Full details: [`BLOCKCHAIN_AUDIT.md`](./BLOCKCHAIN_AUDIT.md)

## Sensitive Data Protection

Automatically redacted before persistence:
- secret
- privateKey
- password
- token
- apiKey
- signingKey

**Recursive**: Works on nested objects and arrays

Details: [`BLOCKCHAIN_AUDIT.md`](./BLOCKCHAIN_AUDIT.md)

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Audit logs not created | Check endpoint has `@BlockchainAudit()` decorator |
| Can't query logs | Verify user is ADMIN and JWT is valid |
| Sensitive data visible | Field must match redaction patterns |
| Slow queries | Verify indexes created: `SELECT * FROM pg_indexes...` |
| Migration error | Drop table and re-run: `npm run typeorm migration:run` |

Full troubleshooting: [`IMPLEMENTATION_GUIDE.md`](./IMPLEMENTATION_GUIDE.md)

## Performance

✅ **Logging**: Asynchronous (fire-and-forget), minimal latency impact
✅ **Queries**: Indexed on frequent fields, <500ms for typical queries
✅ **Storage**: ~1KB per log entry, 1M entries = ~1GB

See performance section in [`IMPLEMENTATION_GUIDE.md`](./IMPLEMENTATION_GUIDE.md)

## Security

✅ **Access Control**: Admin-only, role-based authorization
✅ **Data Protection**: Sensitive fields redacted automatically
✅ **Audit Integrity**: Append-only, unique IDs, server-side timestamps
✅ **Verification**: Transaction hash links to immutable blockchain

See security section in [`BLOCKCHAIN_AUDIT.md`](./BLOCKCHAIN_AUDIT.md)

## Deployment Checklist

- [ ] Read [`IMPLEMENTATION_GUIDE.md`](./IMPLEMENTATION_GUIDE.md)
- [ ] Review all created/modified files
- [ ] Back up production database
- [ ] Run database migration
- [ ] Restart backend service
- [ ] Verify endpoints work (see TESTING_GUIDE)
- [ ] Set up monitoring/alerts
- [ ] Document for your team
- [ ] Update internal runbooks

## Getting Help

1. **Quick questions**: Check [`QUICK_REFERENCE.md`](./QUICK_REFERENCE.md)
2. **How it works**: Read [`BLOCKCHAIN_AUDIT.md`](./BLOCKCHAIN_AUDIT.md)
3. **Deployment issues**: See [`IMPLEMENTATION_GUIDE.md`](./IMPLEMENTATION_GUIDE.md)
4. **Testing**: Follow [`TESTING_GUIDE.md`](./TESTING_GUIDE.md)

## Related Documentation

- Stellar Security: `../STELLAR_SECURITY.md` (if exists)
- Treasury Guide: `../TREASURY.md` (if exists)
- Matching Pool Guide: `../MATCHING_POOL.md` (if exists)
- Database: `../DATABASE.md` (if exists)

## Version History

**v1.0** (2025-01-15)
- ✅ Initial implementation
- ✅ Matching pool & treasury covered
- ✅ Registry framework ready
- ✅ Complete documentation
- ✅ Ready for production

## Support

For issues or questions:
1. Check the documentation files in this directory
2. Review examples in IMPLEMENTATION_GUIDE or TESTING_GUIDE
3. Check application logs
4. Consult backend engineering team

---

**Last Updated**: 2025-01-15  
**Status**: ✅ Ready for Production  
**Maintainers**: Backend Team
