# Health Check Module

Comprehensive health check system for monitoring database, Redis, and Stellar Horizon availability with graceful degradation support.

## Features

✅ **Three Health Endpoints**
- Main health endpoint (`GET /health`) - graceful degradation
- Detailed status endpoint (`GET /health/detailed`) - all service info
- Readiness probe (`GET /health/ready`) - Kubernetes-compatible

✅ **Service Monitoring**
- **Database (PostgreSQL)** - Critical service [TCP connection check]
- **Redis** - Non-critical service [Cache set/get test]
- **Stellar Horizon** - Non-critical service [API ledger fetch]

✅ **Graceful Degradation**
- API stays operational (HTTP 200) even if Redis or Horizon fail
- Only database failure causes HTTP 503 (Service Unavailable)
- All service statuses included in response for visibility

✅ **Production Ready**
- Comprehensive error handling and logging
- Timeout protection on all checks
- Kubernetes integration support
- Full test coverage
- Detailed documentation

## Quick Start

### View Health Status
```bash
# Main health endpoint
curl http://localhost:3000/health

# Detailed service information
curl http://localhost:3000/health/detailed

# Readiness probe
curl http://localhost:3000/health/ready
```

### Response Examples

**Healthy (HTTP 200)**
```json
{
  "status": "ok",
  "timestamp": "2026-03-30T12:00:00Z",
  "checks": {
    "database": { "status": "up", "message": null },
    "redis": { "status": "up", "message": null },
    "horizon": { "status": "up", "message": null }
  }
}
```

**Degraded but Operational (HTTP 200)**
```json
{
  "status": "ok",
  "timestamp": "2026-03-30T12:00:00Z",
  "checks": {
    "database": { "status": "up", "message": null },
    "redis": { "status": "down", "message": "Connection timeout" },
    "horizon": { "status": "up", "message": null }
  }
}
```

**Critical Failure (HTTP 503)**
```json
{
  "status": "critical",
  "message": "Service Unavailable: Critical service down",
  "checks": {
    "database": { "status": "down", "message": "Unable to connect" },
    "redis": { "status": "up", "message": null },
    "horizon": { "status": "up", "message": null }
  },
  "timestamp": "2026-03-30T12:00:00Z"
}
```

## Architecture

### Service Classification

```
┌─────────────────────┐
│  Health Endpoints   │
└──────────┬──────────┘
           │
    ┌──────┴──────┐
    │             │
┌───▼────┐   ┌───▼──────────┐
│Critical │   │Non-Critical  │
├────────┤   ├──────────────┤
│Database │   │Redis         │
│         │   │Horizon       │
└────┬────┘   └──────┬───────┘
     │               │
     │         ┌─────▼─────┐
     │         │Async Check│
     │         │No Blocking│
     │         └─────┬─────┘
     │               │
     └────────┬──────┘
              │
         ┌────▼─────┐
         │Response  │
         │HTTP Code │
         └──────────┘
```

### Health Check Details

#### Database (Critical)
- **Method:** TCP connection attempt
- **Timeout:** 5 seconds
- **Config:** `DB_HOST`, `DB_PORT`
- **Failure:** Triggers HTTP 503

#### Redis (Non-Critical)
- **Method:** Cache set/get/delete test
- **Timeout:** Cache manager timeout (typically 5s)
- **Config:** Via `@nestjs/cache-manager`
- **Failure:** Logged, doesn't affect HTTP status

#### Stellar Horizon (Non-Critical)
- **Method:** HTTP API call (fetch latest ledger)
- **Timeout:** 5 seconds
- **Config:** `STELLAR_HORIZON_URL`
- **Failure:** Logged, doesn't affect HTTP status

## Installation

Health module is automatically integrated when added to `AppModule`:

```typescript
import { HealthModule } from './health/health.module';

@Module({
  imports: [HealthModule, /* ... other modules ... */],
})
export class AppModule {}
```

## Configuration

### Environment Variables

```bash
# Database
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=postgres
DB_DATABASE=lumenpulse

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
CACHE_TTL_MS=300000

# Stellar Horizon
STELLAR_NETWORK=testnet          # or mainnet
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
```

## API Reference

### GET /health
**Main health endpoint with graceful degradation**

- **Returns:** 200 OK (if database is up) or 503 (if database down)
- **Includes:** Status of all services
- **Use Case:** Application health monitoring

```bash
curl http://localhost:3000/health | jq .
```

### GET /health/detailed
**Detailed health status**

- **Returns:** Always 200 OK (informational)
- **Includes:** Full error messages and service URLs
- **Use Case:** Debugging and detailed monitoring

```bash
curl http://localhost:3000/health/detailed | jq .services
```

### GET /health/ready
**Readiness probe**

- **Returns:** 200 OK (if ready) or 503 (if not ready)
- **Checks:** Only critical services (database)
- **Use Case:** Kubernetes probes, load balancer health

```bash
curl http://localhost:3000/health/ready
```

## Kubernetes Integration

### Pod Probes

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: lumenpulse-api
spec:
  containers:
  - name: api
    image: lumenpulse-api:latest
    livenessProbe:
      httpGet:
        path: /health/ready
        port: 3000
      initialDelaySeconds: 30
      periodSeconds: 10
      failureThreshold: 3
    readinessProbe:
      httpGet:
        path: /health/ready
        port: 3000
      initialDelaySeconds: 10
      periodSeconds: 5
      failureThreshold: 2
    startupProbe:
      httpGet:
        path: /health/ready
        port: 3000
      failureThreshold: 30
      periodSeconds: 10
```

## Testing

### Run Tests
```bash
npm test health
npm test -- --testPathPattern=health
```

### Manual Testing

```bash
# All services up
curl http://localhost:3000/health

# Test with Redis down
docker-compose down redis
curl http://localhost:3000/health
docker-compose up redis

# Test with database down
docker-compose down db
curl http://localhost:3000/health
docker-compose up db
```

### Monitoring

```bash
# Watch health status
watch -n 1 'curl -s http://localhost:3000/health | jq .'

# Check only critical service
curl -s http://localhost:3000/health/ready

# Get HTTP status code only
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/health
```

## Performance

- **Database Check:** ~100ms (TCP connection)
- **Redis Check:** ~50-200ms (cache operations)
- **Horizon Check:** ~500-2000ms (HTTP API call)
- **Total Latency:** ~650-2300ms (parallel execution)

## File Structure

```
src/health/
├── health.module.ts                  # Module definition
├── health.controller.ts              # REST endpoints (3 routes)
├── health.service.ts                 # Health check logic
├── health.controller.spec.ts         # Unit tests
├── HEALTH_CHECK_IMPLEMENTATION.md    # Detailed documentation
├── QUICK_REFERENCE.md               # Quick reference guide
└── README.md                         # This file
```

## Behavior Matrix

| Scenario | Database | Redis | Horizon | HTTP Status | Response |
|----------|----------|-------|---------|-------------|----------|
| All Up | ✅ Up | ✅ Up | ✅ Up | 200 OK | status: "ok" |
| Redis Down | ✅ Up | ❌ Down | ✅ Up | 200 OK | status: "ok"* |
| Horizon Down | ✅ Up | ✅ Up | ❌ Down | 200 OK | status: "ok"* |
| Both Down | ✅ Up | ❌ Down | ❌ Down | 200 OK | status: "ok"* |
| Database Down | ❌ Down | ✅ Up | ✅ Up | 503 Error | status: "critical" |
| Database + Others Down | ❌ Down | ❌ Down | ❌ Down | 503 Error | status: "critical" |

*Status shown as "ok" because database is up (API operational), but checks show which services are down.

## Troubleshooting

### Problem: Health Check Hangs

**Solution:** Check database/Redis/Horizon connectivity
```bash
# Test database
nc -zv localhost 5432

# Test Redis
redis-cli ping

# Test Horizon
curl -m 5 https://horizon.stellar.org/ledgers?limit=1
```

### Problem: Redis Check Always Fails

**Solution:** Verify Redis is running
```bash
docker-compose ps redis
redis-cli ping
```

### Problem: Horizon Check Slow

**Solution:** Horizon API is external, normal latency is 500-2000ms
- Check internet connectivity
- Verify API rate limits not exceeded

## Best Practices

1. **Monitoring**
   - Monitor `/health/detailed` for service issues
   - Alert on database failures (HTTP 503)
   - Log Redis/Horizon failures at INFO level

2. **Load Balancer Configuration**
   - Use `/health/ready` for health checks
   - Remove instance from pool on HTTP 503
   - Keep instance in pool if Redis/Horizon fail

3. **Alert Thresholds**
   - Database: Alert immediately
   - Redis: Alert after 5 consecutive failures
   - Horizon: Alert after 10 consecutive failures

4. **Kubernetes**
   - Use `/health/ready` for all K8s probes
   - Set appropriate `initialDelaySeconds` (30s for DB init)
   - Use multiple replicas for HA

## See Also

- [Full Implementation Documentation](./HEALTH_CHECK_IMPLEMENTATION.md)
- [Quick Reference Guide](./QUICK_REFERENCE.md)
- [Expansion Summary](../HEALTH_CHECK_EXPANSION.md)

## Sources

- Controller: [health.controller.ts](./health.controller.ts)
- Service: [health.service.ts](./health.service.ts)
- Tests: [health.controller.spec.ts](./health.controller.spec.ts)
