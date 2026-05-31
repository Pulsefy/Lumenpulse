# Contract Rotation Feature - Environment Setup

## Prerequisites

Before deploying the contract rotation feature, ensure the following are in place:

## 1. Database Setup

### Create Audit Logs Table
The `audit_logs` table must exist. If not already created, run:

```sql
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  userId UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,
  ipAddress VARCHAR(45),
  metadata JSONB,
  createdAt TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_audit_logs_userId ON audit_logs(userId);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_createdAt ON audit_logs(createdAt DESC);
```

### Verify Table Structure
```sql
-- Check table exists
SELECT * FROM information_schema.tables WHERE table_name = 'audit_logs';

-- Check columns
SELECT column_name, data_type FROM information_schema.columns 
WHERE table_name = 'audit_logs';

-- Check indexes
SELECT indexname FROM pg_indexes WHERE tablename = 'audit_logs';
```

## 2. Environment Variables

### Required Variables
Ensure these are configured in your `.env` file:

```bash
# Database (existing)
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=your_password
DB_DATABASE=lumenpulse

# Stellar Configuration (existing)
STELLAR_NETWORK=testnet  # or mainnet
STELLAR_SERVER_SECRET=your_server_secret_key
STELLAR_CONTRACT_LUMEN_TOKEN=CAAAA...
STELLAR_CONTRACT_CROWDFUND_VAULT=CBBBBB...
STELLAR_CONTRACT_PROJECT_REGISTRY=CCCCCC...
STELLAR_CONTRACT_CONTRIBUTOR_REGISTRY=CDDDD...
STELLAR_CONTRACT_MATCHING_POOL=CEEEE...
STELLAR_CONTRACT_TREASURY=CFFFF...

# JWT Configuration (existing)
JWT_SECRET=your_jwt_secret
JWT_EXPIRES_IN=24h

# Cache Manager (existing)
# Using default in-memory cache or configure Redis:
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_URL=redis://localhost:6379

# Optional: Custom Soroban RPC URL
STELLAR_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org  # optional
```

### Verify Variables
```bash
# Check all required variables are set
echo "STELLAR_SERVER_SECRET: ${STELLAR_SERVER_SECRET}"
echo "STELLAR_NETWORK: ${STELLAR_NETWORK}"
echo "JWT_SECRET: ${JWT_SECRET:0:10}..."  # Only show first 10 chars
```

## 3. Stellar Configuration

### Contract IDs
Ensure all six contract IDs are configured:

```bash
# Verify contract IDs are set
npx ts-node -e "import { config } from './src/lib/config'; console.log(config.stellar.contracts)"
```

### Soroban RPC
Verify Soroban RPC is accessible:

```bash
# Test testnet RPC
curl -s https://soroban-testnet.stellar.org/health | jq .

# Test mainnet RPC
curl -s https://soroban.stellar.org/health | jq .

# Or test custom RPC if configured
curl -s $STELLAR_SOROBAN_RPC_URL/health | jq .
```

### Server Secret Key
The server secret key is used for contract validation:

```bash
# Verify the server public key matches your infrastructure
npx ts-node -e "
import { Keypair } from '@stellar/stellar-sdk';
const keypair = Keypair.fromSecret(process.env.STELLAR_SERVER_SECRET);
console.log('Public Key:', keypair.publicKey());
"
```

## 4. Authentication Setup

### Admin Users
Ensure admin users are created in the system:

```sql
-- Check for admin users
SELECT id, email, role FROM users WHERE role = 'ADMIN' LIMIT 5;

-- Create admin user if needed
INSERT INTO users (id, email, password, role, createdAt, updatedAt)
VALUES (
  gen_random_uuid(),
  'admin@example.com',
  'hashed_password',
  'ADMIN',
  NOW(),
  NOW()
);
```

### JWT Token Generation
Generate a test JWT token for testing:

```bash
# Using Node.js
npx ts-node -e "
import jwt from 'jsonwebtoken';
const token = jwt.sign(
  { userId: 'admin-user-id', role: 'ADMIN' },
  process.env.JWT_SECRET,
  { expiresIn: '24h' }
);
console.log('Test JWT Token:', token);
"
```

## 5. Cache Manager Setup

### For In-Memory Cache (Development)
```bash
# Default configuration, no setup needed
# Uses @nestjs/cache-manager with in-memory store
```

### For Redis Cache (Production)
```bash
# Install Redis
# macOS
brew install redis

# Linux
sudo apt-get install redis-server

# Windows
# Download from https://github.com/microsoftarchive/redis/releases

# Verify Redis is running
redis-cli ping  # Should return PONG
```

### Configure Cache Manager
The application already imports CacheModule globally:
```typescript
import { CacheModule } from '@nestjs/cache-manager';

@Module({
  imports: [
    CacheModule.register({
      isGlobal: true,
      ttl: 300000, // 5 minutes default
    }),
  ],
})
export class AppModule {}
```

## 6. Verification Steps

### Step 1: Start the Application
```bash
cd apps/backend
npm install
npm run start:dev
```

### Step 2: Test Database Connection
```bash
npm run typeorm migration:show  # Should show migrations

# Or check directly
psql -h localhost -U postgres -d lumenpulse -c "SELECT COUNT(*) FROM audit_logs;"
```

### Step 3: Test Stellar Connection
```bash
# Get contract health status
curl http://localhost:3000/v1/health/contracts

# Expected response includes contract status
```

### Step 4: Test Validation Endpoint
```bash
# Get JWT token (see section 4)
JWT_TOKEN="your_jwt_token_here"

# Test validation endpoint
curl -X POST http://localhost:3000/v1/stellar/admin/validate-contract-ids \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "contracts": {
      "lumenToken": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4"
    }
  }'

# Expected response:
# { "valid": false, "results": [...], "error": "Some contracts failed validation" }
# (Normal - test contract ID is invalid)
```

### Step 5: Test Rotation Endpoint
```bash
# Test with valid contract format but non-existent contract
curl -X POST http://localhost:3000/v1/stellar/admin/rotate-contract-ids \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "contracts": {
      "lumenToken": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4"
    },
    "reason": "Testing rotation endpoint"
  }'

# Expected response: 400 Bad Request with validation error
# (Normal - test contract ID doesn't exist)
```

### Step 6: Verify Audit Logging
```bash
# Check audit logs were created
psql -h localhost -U postgres -d lumenpulse << EOF
SELECT action, userId, metadata 
FROM audit_logs 
WHERE action = 'contracts.rotate_testnet' 
ORDER BY createdAt DESC 
LIMIT 5;
EOF
```

### Step 7: Check Configuration Endpoint
```bash
# Verify config endpoint still works
curl http://localhost:3000/v1/config/stellar | jq .

# Should return current contract IDs
```

## 7. Troubleshooting

### Issue: Database Connection Error
```bash
# Check database is running
psql -h localhost -U postgres -c "SELECT 1"

# Check migrations are applied
npm run typeorm migration:show

# Run migrations if needed
npm run typeorm migration:run
```

### Issue: JWT Token Invalid
```bash
# Verify JWT_SECRET is set
echo $JWT_SECRET

# Verify token wasn't expired
# Re-generate with longer expiration
jwt_token_generator=$(cat <<'EOF'
const jwt = require('jsonwebtoken');
const token = jwt.sign(
  { userId: 'test-user', role: 'ADMIN' },
  process.env.JWT_SECRET,
  { expiresIn: '7d' }
);
console.log(token);
EOF
)
node -e "$jwt_token_generator"
```

### Issue: Soroban RPC Unreachable
```bash
# Verify RPC URL is correct
echo $STELLAR_SOROBAN_RPC_URL

# Test connectivity
curl -s https://soroban-testnet.stellar.org/health | jq .

# Check network connectivity
ping soroban-testnet.stellar.org

# Try custom RPC if configured
curl -s $STELLAR_SOROBAN_RPC_URL/health | jq .
```

### Issue: Cache Not Invalidating
```bash
# Check Redis is running (if using Redis)
redis-cli ping

# Clear cache manually
redis-cli FLUSHALL  # WARNING: Clears all cache!

# Or check in-memory cache
# Verify application loaded cache manager
curl http://localhost:3000/v1/health
```

### Issue: Audit Logs Not Created
```bash
# Check audit_logs table exists
psql -h localhost -U postgres -d lumenpulse -c "\dt audit_logs"

# Check table is empty
psql -h localhost -U postgres -d lumenpulse -c "SELECT COUNT(*) FROM audit_logs"

# Check for database errors in application logs
tail -f logs/application.log | grep -i audit
```

## 8. Pre-Deployment Checklist

- [ ] Database table `audit_logs` created with proper schema
- [ ] All environment variables configured
- [ ] Stellar contract IDs validated and accessible
- [ ] Soroban RPC endpoint accessible
- [ ] Cache manager configured (Redis or in-memory)
- [ ] Admin users created in database
- [ ] JWT secret configured and documented
- [ ] Validation endpoint tested
- [ ] Rotation endpoint tested (with test data)
- [ ] Audit logging verified
- [ ] Configuration endpoint verified
- [ ] All tests passing locally
- [ ] Documentation reviewed
- [ ] Security review completed

## 9. Post-Deployment Verification

After deploying to production:

```bash
# Monitor application startup
tail -f logs/application.log | grep -i "contract\|stellar\|rotate"

# Test endpoints in production
curl https://api.example.com/v1/stellar/admin/validate-contract-ids \
  -H "Authorization: Bearer $PROD_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"contracts": {"lumenToken": "C..."}}'

# Monitor audit logs for suspicious activity
psql $PROD_DATABASE_URL -c "
  SELECT COUNT(*) as total_logs, 
         COUNT(DISTINCT userId) as unique_admins,
         COUNT(DISTINCT action) as unique_actions
  FROM audit_logs 
  WHERE action = 'contracts.rotate_testnet'
  AND createdAt > NOW() - INTERVAL '24 hours'
"

# Check for errors in logs
grep -i "error\|failed\|exception" logs/application.log | grep -i "contract\|rotate"
```

## 10. Support & Debugging

### Enable Debug Logging
```bash
# Set debug flag in environment
export DEBUG=*
export NEST_DEBUG=true

# Restart application
npm run start:dev
```

### Check Application Logs
```bash
# View recent logs
tail -n 100 logs/application.log

# Search for specific issues
grep -i "contract\|rotate" logs/application.log

# Monitor logs in real-time
tail -f logs/application.log
```

### Database Debugging
```bash
# Check recent audit logs
psql $DATABASE_URL -c "
  SELECT * FROM audit_logs 
  ORDER BY createdAt DESC 
  LIMIT 10
"

# Analyze audit log metadata
psql $DATABASE_URL -c "
  SELECT action, COUNT(*) as count 
  FROM audit_logs 
  WHERE createdAt > NOW() - INTERVAL '24 hours'
  GROUP BY action
"
```

### API Debugging
```bash
# Enable request/response logging
export LOGGING_ENABLED=true
export LOGGING_INCLUDE_BODY=true
export LOGGING_INCLUDE_RESPONSE=true

# Test with verbose curl
curl -v -X POST http://localhost:3000/v1/stellar/admin/validate-contract-ids \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"contracts": {"lumenToken": "C..."}}'
```

## Need Help?

Refer to:
1. `FEATURE_CONTRACT_ROTATION.md` - Comprehensive feature guide
2. `IMPLEMENTATION_SUMMARY_CONTRACT_ROTATION.md` - Technical details
3. `CONTRACT_ROTATION_QUICK_REFERENCE.md` - Quick reference
4. Backend README - General architecture
5. Application logs - Specific error messages
