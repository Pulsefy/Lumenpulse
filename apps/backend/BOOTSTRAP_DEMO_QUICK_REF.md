# Bootstrap Demo Data - Quick Reference

> **TL;DR**: One-command bootstrap for testnet reviewers

## Quick Start (60 seconds)

### 1. Get Admin Token
```bash
# Login as admin (create admin account first if needed)
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "SecurePassword123!"
  }' | jq -r '.accessToken')

echo "Token: $TOKEN"
```

### 2. Bootstrap Demo Data
```bash
# Create demo projects in one command
curl -X POST http://localhost:3000/bootstrap/demo-data \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"seed": "test-123"}' | jq '.'
```

### 3. Verify Projects Created
```bash
# List all projects
curl http://localhost:3000/crowdfund/projects | jq '.'
```

## What Gets Created?

5 demo projects with realistic data:
1. Smart Contract Audit Services (1000 XLM target)
2. Developer Tooling Enhancement (750 XLM target)
3. Infrastructure Redundancy (2000 XLM target)
4. Community Education Program (500 XLM target)
5. API Rate Limiting & Security Hardening (1200 XLM target)

## Configuration

| Environment | Bootstrap Enabled? | How to Override |
|-------------|-------------------|-----------------|
| development | ✅ Yes (default) | `BOOTSTRAP_ENABLED=false` |
| staging | ✅ Yes (default) | `BOOTSTRAP_ENABLED=false` |
| production | ❌ No (default) | `BOOTSTRAP_ENABLED=true` |

## Security Notes

- ✅ Admin-only endpoint (requires ADMIN role)
- ✅ JWT authentication required
- ✅ Disabled in production by default
- ✅ All operations logged for audit trail

## Common Commands

```bash
# Bootstrap with reproducible seed
curl -X POST http://localhost:3000/bootstrap/demo-data \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"seed": "my-consistent-seed"}'

# Bootstrap with random data
curl -X POST http://localhost:3000/bootstrap/demo-data \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'

# Get specific project details
curl http://localhost:3000/crowdfund/projects/1 | jq '.'

# Get project contributors
curl http://localhost:3000/crowdfund/projects/1/contributors | jq '.'
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| 403 Forbidden | Check user has ADMIN role, set BOOTSTRAP_ENABLED=true |
| 401 Unauthorized | Get valid JWT token by logging in |
| No projects created | Check database connection, review logs |

## Full Documentation

See [BOOTSTRAP_DEMO_DATA.md](./BOOTSTRAP_DEMO_DATA.md) for detailed usage guide.
