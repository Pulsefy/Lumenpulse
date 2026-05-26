# Backend Workflow Implementation Checklist

## Pre-Deployment Verification

- [ ] Review the updated [.github/workflows/backend.yml](.github/workflows/backend.yml)
- [ ] Verify Node.js 18 LTS is compatible with all backend dependencies
- [ ] Confirm pnpm is the package manager (already using `pnpm-lock.yaml` at root)
- [ ] Test environment variables don't conflict with local development settings

## Local Testing (Before Pushing)

### Option 1: Using `act` (Recommended)
```bash
# Install act: https://github.com/nektos/act
act push --job backend-checks
```

### Option 2: Manual Testing
```bash
cd apps/backend

# Install dependencies
pnpm install

# Start services (requires Docker)
docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:15-alpine
docker run -d -p 6379:6379 redis:7-alpine

# Set environment variables
export NODE_ENV=test ENVIRONMENT=test DB_HOST=localhost DB_PORT=5432
export DB_USERNAME=postgres DB_PASSWORD=postgres DB_DATABASE=lumenpulse
export REDIS_HOST=localhost REDIS_PORT=6379
export JWT_SECRET=ci-test-jwt-secret-key-for-testing-only
export STELLAR_SERVER_SECRET=SB6RIPM3GJQ7RP3Q6R5F3QIBYZHP4N27SGGCQ3R4LWA2ZKXZWQ3NU3G4
export STELLAR_NETWORK=testnet

# Run workflow steps manually
pnpm run lint
pnpm run build --noEmit
pnpm run migration:run  # Optional, may fail if schema not needed
pnpm run test -- --passWithNoTests
pnpm run build
```

## Post-Deployment Monitoring

- [ ] Verify workflow passes on next push to main
- [ ] Check coverage reports in artifacts (if generated)
- [ ] Monitor for any PostgreSQL/Redis connection timeouts
- [ ] Watch for deprecation warnings in action logs

## Troubleshooting Steps

### If workflow fails with "Exit code 1":

1. **Check the annotation details** - Click the failed step in GitHub UI
2. **Look for these common errors:**
   - `error ECONNREFUSED` → PostgreSQL/Redis not ready (check health checks)
   - `Cannot find module` → pnpm dependencies not installed (check lock file)
   - `TypeScript compilation failed` → Code errors (review type-check output)
   - `SIGTERM` → Job timeout (increase `timeout-minutes`)

3. **Enable debug mode:**
   ```bash
   # Add to workflow env section:
   DEBUG: 'jest:*'
   ```

4. **Run diagnostics step:**
   ```bash
   # Add after services start:
   - name: Diagnostics
     run: |
       echo "PostgreSQL status:"
       pg_isready -h localhost -p 5432 -v
       echo "Redis status:"
       redis-cli -h localhost -p 6379 ping
       echo "Node version: $(node --version)"
       echo "NPM version: $(npm --version)"
   ```

## Configuration Customization

### To use different Node.js version:
```yaml
- name: Setup Node.js
  uses: actions/setup-node@v4
  with:
    node-version: '20.x'  # Change here
```

### To use different PostgreSQL version:
```yaml
postgres:
  image: postgres:16-alpine  # Change version
```

### To add more environment variables:
```yaml
env:
  MY_CUSTOM_VAR: value
```

### To add additional services (e.g., MongoDB):
```yaml
services:
  mongo:
    image: mongo:7
    ports:
      - 27017:27017
```

## Security Considerations

⚠️ **IMPORTANT:** Never commit real secrets to this workflow file:
- Use GitHub Secrets for production credentials
- Keep test values non-sensitive
- Review all `env` values before committing

To use GitHub Secrets:
```yaml
env:
  JWT_SECRET: ${{ secrets.JWT_SECRET }}  # Real secret from GitHub
  # OR
  JWT_SECRET: test-secret-only-for-ci   # Test value (safe to commit)
```

## Performance Optimization

To speed up workflow:

1. **Parallelize jobs** (if multiple independent checks):
   ```yaml
   jobs:
     lint:
       runs-on: ubuntu-latest
       steps:
         - run: npm run lint
     test:
       runs-on: ubuntu-latest
       steps:
         - run: npm run test
   ```

2. **Skip unnecessary steps:**
   ```yaml
   - name: Run Tests
     if: github.event_name == 'pull_request'  # Only on PRs
     run: npm run test
   ```

3. **Cache optimization** (already implemented with pnpm)

## Maintenance Notes

- Review action versions quarterly for deprecations
- Monitor Node.js LTS timeline (current: 18.x until Apr 2025, 20.x until Apr 2026)
- Consider upgrading to Node.js 20 LTS once 18 approaches EOL
- Keep PostgreSQL/Redis images updated

## Documentation References

- [GitHub Actions checkout@v4](https://github.com/actions/checkout)
- [GitHub Actions setup-node@v4](https://github.com/actions/setup-node)
- [pnpm GitHub Action](https://github.com/pnpm/action-setup)
- [NestJS Testing](https://docs.nestjs.com/fundamentals/testing)
- [Jest Configuration](https://jestjs.io/docs/configuration)
