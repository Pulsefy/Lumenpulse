# Bootstrap Demo Data API

## Overview

The Bootstrap Demo Data API provides a controlled way to seed testnet environments with demo projects and metadata. This allows reviewers and contributors to quickly test the MVP without manually creating test data.

**Key Features:**
- ✅ Admin-only endpoint (requires ADMIN role)
- ✅ Environment-based security (disabled in production by default)
- ✅ Optional seed-based reproducible data generation
- ✅ Returns created project IDs for verification
- ✅ Comprehensive audit logging

## Security Considerations

### Access Control
The bootstrap endpoint is protected by:
1. **JWT Authentication**: Requires a valid JWT token
2. **Role-Based Access Control (RBAC)**: Only users with the `ADMIN` role can access this endpoint
3. **Environment Flags**: Disabled in production by default

### Production Safety
Bootstrap is **disabled by default in production**. To enable it explicitly:
```bash
BOOTSTRAP_ENABLED=true NODE_ENV=production
```

⚠️ **Warning**: Enabling bootstrap in production is not recommended and should only be done for emergency testing scenarios.

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BOOTSTRAP_ENABLED` | `false` | Explicitly enable bootstrap (overrides production check) |
| `NODE_ENV` | `development` | Runtime environment (development/staging/production) |
| `ENVIRONMENT` | `development` | Display environment name |

### Configuration Examples

**Development (enabled by default):**
```bash
NODE_ENV=development
# Bootstrap is enabled
```

**Staging (enabled by default):**
```bash
NODE_ENV=staging
ENVIRONMENT=staging
# Bootstrap is enabled
```

**Production (disabled by default):**
```bash
NODE_ENV=production
ENVIRONMENT=production
# Bootstrap is disabled unless BOOTSTRAP_ENABLED=true
```

## API Reference

### Endpoint: POST /bootstrap/demo-data

Creates demo projects and returns their IDs for verification.

#### Authentication
- **Required**: JWT Bearer Token with ADMIN role
- **Header**: `Authorization: Bearer <JWT_TOKEN>`

#### Request Body
```json
{
  "seed": "optional-seed-for-reproducible-data"
}
```

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `seed` | string | Optional | Provides reproducible test data. Omit for random data. |

#### Response (HTTP 201 Created)
```json
{
  "success": true,
  "projectsCreated": 5,
  "projects": [
    {
      "projectId": 1,
      "name": "Smart Contract Audit Services",
      "description": "Professional security audit services for Soroban smart contracts.",
      "owner": "GBRPYHIL2CI3WHZDTOOQFC6EB4LEGWRL3OHUBNRQRNYC5JLVXCW2KV4",
      "targetAmount": "1000",
      "totalContributed": "0",
      "status": "ACTIVE",
      "createdAt": "2026-05-30T10:30:00Z"
    },
    {
      "projectId": 2,
      "name": "Developer Tooling Enhancement",
      "description": "Build improved SDKs and developer tools for Stellar ecosystem.",
      "owner": "GBCCMW6JQ4H5KWVS5JYM7VL5JDLYLWYOQHVLSQNKLFP7VQKXNZTFUUV",
      "targetAmount": "750",
      "totalContributed": "0",
      "status": "ACTIVE",
      "createdAt": "2026-05-30T10:30:00Z"
    }
  ],
  "environment": "staging",
  "timestamp": "2026-05-30T10:30:00Z",
  "message": "Bootstrap completed successfully. Created 5 demo projects. Use the project IDs above for testing and verification."
}
```

#### Error Responses

**401 Unauthorized** - JWT token missing or invalid:
```json
{
  "statusCode": 401,
  "message": "Unauthorized",
  "error": "Unauthorized"
}
```

**403 Forbidden** - User is not an ADMIN or bootstrap is disabled:
```json
{
  "statusCode": 403,
  "message": "Demo data bootstrap is disabled in this environment",
  "error": "Forbidden"
}
```

**400 Bad Request** - Invalid input or bootstrap operation failed:
```json
{
  "statusCode": 400,
  "message": "Invalid request data",
  "error": "Bad Request"
}
```

## Usage Guide for Contributors

### Prerequisites
1. A valid JWT token with ADMIN role
2. Backend service running (see [INTEGRATION_GUIDE.md](../backend/INTEGRATION_GUIDE.md))
3. Database connection established

### Quick Start

**1. Get an Admin JWT Token**

First, create an admin user (in development):
```bash
# Register and login with an admin account
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "SecurePassword123!",
    "firstName": "Admin",
    "lastName": "User"
  }'

# Login to get JWT token
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "SecurePassword123!"
  }'
```

The response will include:
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "uuid",
    "role": "admin"
  }
}
```

**2. Bootstrap Demo Data**

```bash
# With a reproducible seed for consistent test data
curl -X POST http://localhost:3000/bootstrap/demo-data \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"seed": "my-test-seed-123"}'

# Or without seed for random data
curl -X POST http://localhost:3000/bootstrap/demo-data \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

**3. Verify Created Projects**

Use the returned project IDs to test:
```bash
# List all projects
curl http://localhost:3000/crowdfund/projects

# Get a specific project
curl http://localhost:3000/crowdfund/projects/1
```

### Using with Testing Tools

**cURL Command:**
```bash
#!/bin/bash

# Set variables
API_URL="http://localhost:3000"
JWT_TOKEN="your-admin-jwt-token-here"
SEED="test-seed-$(date +%s)"

# Bootstrap demo data
curl -X POST "$API_URL/bootstrap/demo-data" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"seed\": \"$SEED\"}" | jq '.'
```

**Postman Collection:**
```json
{
  "name": "Bootstrap Demo Data",
  "request": {
    "method": "POST",
    "url": "{{base_url}}/bootstrap/demo-data",
    "header": [
      {
        "key": "Authorization",
        "value": "Bearer {{jwt_token}}",
        "type": "text"
      },
      {
        "key": "Content-Type",
        "value": "application/json",
        "type": "text"
      }
    ],
    "body": {
      "mode": "raw",
      "raw": "{\"seed\": \"test-seed-123\"}"
    }
  }
}
```

**JavaScript/TypeScript:**
```typescript
async function bootstrapDemoData(jwtToken: string, seed?: string) {
  const response = await fetch('http://localhost:3000/bootstrap/demo-data', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwtToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ seed }),
  });

  if (!response.ok) {
    throw new Error(`Bootstrap failed: ${response.statusText}`);
  }

  const data = await response.json();
  console.log(`Created ${data.projectsCreated} demo projects:`, data.projects);
  return data;
}
```

## Demo Data Included

The bootstrap endpoint creates 5 demo projects:

1. **Smart Contract Audit Services** (ID: 1)
   - Target: 1000 XLM
   - Focus: Security auditing and vulnerability assessment

2. **Developer Tooling Enhancement** (ID: 2)
   - Target: 750 XLM
   - Focus: SDK and developer experience improvements

3. **Infrastructure Redundancy** (ID: 3)
   - Target: 2000 XLM
   - Focus: System reliability and uptime

4. **Community Education Program** (ID: 4)
   - Target: 500 XLM
   - Focus: Workshops, tutorials, and certifications

5. **API Rate Limiting & Security Hardening** (ID: 5)
   - Target: 1200 XLM
   - Focus: Security improvements and DDoS protection

Each project includes:
- Realistic description
- Roadmap with 3 milestones
- Target completion dates
- Owner Stellar public key
- On-chain status (ACTIVE)

## Testing Workflows

### Testing Contributions
Once demo projects are created, test the contribution flow:

```bash
# Contribute to a project
curl -X POST http://localhost:3000/crowdfund/contribute \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": 1,
    "senderPublicKey": "GBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    "amount": "100"
  }'

# Get project contributors
curl http://localhost:3000/crowdfund/projects/1/contributors
```

### Testing with Different Seeds
Create reproducible test scenarios for consistent testing:

```bash
# Scenario 1: Test data
curl -X POST http://localhost:3000/bootstrap/demo-data \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"seed": "scenario-1-test"}'

# Scenario 2: Production simulation
curl -X POST http://localhost:3000/bootstrap/demo-data \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"seed": "scenario-2-prod"}'
```

## Troubleshooting

### Bootstrap Endpoint Returns 403 Forbidden
**Problem:** "Demo data bootstrap is disabled in this environment"

**Solutions:**
1. Check NODE_ENV is not production
2. If in production, explicitly set `BOOTSTRAP_ENABLED=true`
3. Verify JWT token has ADMIN role: `curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/users/me`

### Bootstrap Creates Projects but They Don't Appear
**Problem:** Projects created successfully but don't show in list

**Solutions:**
1. Verify database connection is working
2. Check database logs for errors
3. Clear cache if caching is enabled: `CACHE_TTL_MS=0`

### JWT Token Invalid
**Problem:** "Unauthorized" response

**Solutions:**
1. Regenerate JWT token (login again)
2. Check token hasn't expired
3. Verify JWT_SECRET matches between auth service and backend

## Integration with CI/CD

### GitHub Actions Example
```yaml
name: Test Bootstrap API

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      
      - name: Start backend services
        run: docker-compose up -d
        
      - name: Wait for API
        run: curl --retry 10 --retry-delay 5 http://localhost:3000/health
        
      - name: Create admin user and bootstrap
        run: |
          # Create admin
          TOKEN=$(curl -X POST http://localhost:3000/auth/login \
            -H "Content-Type: application/json" \
            -d '{"email": "admin@test.com", "password": "test123"}' \
            | jq -r '.accessToken')
          
          # Bootstrap demo data
          curl -X POST http://localhost:3000/bootstrap/demo-data \
            -H "Authorization: Bearer $TOKEN" \
            -H "Content-Type: application/json" \
            -d '{"seed": "ci-test"}'
```

## FAQ

**Q: Can I use bootstrap in production?**
A: Not recommended. The feature is disabled by default in production. Only enable it for emergency testing with explicit `BOOTSTRAP_ENABLED=true`.

**Q: Does bootstrap data persist?**
A: Yes, demo projects are written to the database and persist across restarts.

**Q: Can I modify demo projects after creation?**
A: Yes, use the standard project endpoints to edit or delete projects.

**Q: How do I reset/delete demo data?**
A: Delete individual projects using the DELETE endpoint or reset the entire database.

**Q: What if I want custom demo data?**
A: Modify the `generateDemoProjects()` method in `bootstrap.service.ts` and rebuild.

**Q: Can non-admins see demo projects?**
A: Yes, demo projects are visible to all users via the public endpoints.

## Related Documentation

- [Backend Integration Guide](../backend/INTEGRATION_GUIDE.md)
- [Crowdfund API Documentation](../crowdfund/README.md)
- [Authentication & Authorization](../auth/README.md)
- [API Security Guide](../API_SECURITY_GUIDE.md)
