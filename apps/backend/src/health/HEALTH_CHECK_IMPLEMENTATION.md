# Health Check Implementation

This document describes the expanded `/health` endpoint for the LumenPulse API, which now includes monitoring for database, Redis, and Stellar Horizon availability with graceful degradation support.

## Overview

The health check system provides three main endpoints to support different use cases:

1. **`GET /health`** - Main health endpoint with graceful degradation
2. **`GET /health/detailed`** - Detailed dependency status
3. **`GET /health/ready`** - Readiness probe (Kubernetes-compatible)

## Architecture

### Service Classification

Services are classified into two categories based on criticality:

#### Critical Services
- **Database (PostgreSQL)**: Required for API operation
  - Failure: Returns HTTP 503 Service Unavailable
  - Status: Must be "up" for service to be operational

#### Non-Critical Services
- **Redis**: Used for caching and job queues
  - Failure: Does not affect HTTP response code
  - Status: Monitored and reported, but not blocking
  
- **Stellar Horizon**: External blockchain service
  - Failure: Does not affect HTTP response code
  - Status: Monitored and reported, but not blocking

### Graceful Degradation

The API implements graceful degradation to ensure service availability:

```
┌─────────────────────────────────────────────┐
│        /health Endpoint Request             │
└──────────────────┬──────────────────────────┘
                   │
         ┌─────────┴─────────┐
         │                   │
    ┌────▼────┐         ┌────▼────┐
    │ Database │         │Non-Critical
    │  Check   │         │Services
    └────┬─────┘         └────┬─────┘
         │                    │
         │                    │
    ┌────▼──────────┐   ┌─────▼─────────┐
    │UP (200 OK)    │   │Async Checks   │
    │Response       │   │(Don't Block)  │
    └───────────────┘   └───────────────┘
         │
         │
    ┌────▼──────────┐
    │DOWN (503)     │
    │Response       │
    └───────────────┘
```

## API Endpoints

### 1. Main Health Endpoint

**Endpoint:** `GET /health`

**Graceful Degradation:** Enabled (non-critical service failures don't cause 503)

**Response (200 OK - Healthy):**
```json
{
  "status": "ok",
  "timestamp": "2026-03-30T12:00:00Z",
  "checks": {
    "database": {
      "status": "up",
      "message": null
    },
    "redis": {
      "status": "up",
      "message": null
    },
    "horizon": {
      "status": "up",
      "message": null
    }
  }
}
```

**Response (200 OK - Degraded but Operational):**
```json
{
  "status": "ok",
  "timestamp": "2026-03-30T12:00:00Z",
  "checks": {
    "database": {
      "status": "up",
      "message": null
    },
    "redis": {
      "status": "down",
      "message": "Connection timeout"
    },
    "horizon": {
      "status": "up",
      "message": null
    }
  }
}
```

**Response (503 Service Unavailable - Critical Service Down):**
```json
{
  "status": "critical",
  "message": "Service Unavailable: Critical service down",
  "checks": {
    "database": {
      "status": "down",
      "message": "Unable to connect to database at localhost:5432"
    },
    "redis": {
      "status": "up",
      "message": null
    },
    "horizon": {
      "status": "up",
      "message": null
    }
  },
  "timestamp": "2026-03-30T12:00:00Z"
}
```

### 2. Detailed Health Endpoint

**Endpoint:** `GET /health/detailed`

Always returns HTTP 200 with detailed status of all dependencies.

**Response (200 OK):**
```json
{
  "timestamp": "2026-03-30T12:00:00Z",
  "services": {
    "database": {
      "status": "up"
    },
    "redis": {
      "status": "down",
      "message": "Connection refused"
    },
    "horizon": {
      "status": "up",
      "url": "https://horizon.stellar.org"
    }
  }
}
```

### 3. Readiness Probe Endpoint

**Endpoint:** `GET /health/ready`

Kubernetes-compatible readiness probe. Returns 200 only if critical services are ready.

**Response (200 OK - Ready):**
```json
{
  "status": "ready",
  "timestamp": "2026-03-30T12:00:00Z"
}
```

**Response (503 Service Unavailable - Not Ready):**
```json
{
  "status": "not_ready",
  "message": "Service not ready: database unavailable",
  "timestamp": "2026-03-30T12:00:00Z"
}
```

## Health Checks Implementation

### Database Check

**Method:** TCP connection attempt to PostgreSQL

**Configuration:**
- Environment Variables: `DB_HOST`, `DB_PORT`
- Timeout: 5 seconds
- Type: Critical

**How it works:**
1. Reads database connection parameters from config
2. Attempts to establish a TCP connection
3. Returns `up` if successful, `down` if timeout or refused

### Redis Check

**Method:** Get/Set operation on cache manager

**Configuration:**
- Uses existing `@nestjs/cache-manager` instance
- Environment Variables: `REDIS_HOST`, `REDIS_PORT`
- Timeout: Depends on cache manager configuration (typically 5 seconds)
- Type: Non-critical

**How it works:**
1. Creates a test key with UUID value
2. Sets it in Redis with 5-second TTL
3. Retrieves the value to verify retrieval works
4. Deletes the test key
5. Returns `up` if all operations succeed, `down` otherwise

### Stellar Horizon Check

**Method:** API call to fetch ledger information

**Configuration:**
- Environment Variable: `STELLAR_HORIZON_URL` (defaults to mainnet)
- Default URLs:
  - Testnet: `https://horizon-testnet.stellar.org`
  - Mainnet: `https://horizon.stellar.org`
- Timeout: 5 seconds
- Type: Non-critical

**How it works:**
1. Creates a Horizon.Server instance
2. Attempts to fetch the latest ledger (limit 1)
3. Returns `up` if successful, `down` if timeout or error

## Environment Variables

```bash
# Database (Critical)
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=postgres
DB_DATABASE=lumenpulse

# Redis (Non-Critical)
REDIS_HOST=localhost
REDIS_PORT=6379
CACHE_TTL_MS=300000

# Stellar Horizon (Non-Critical)
STELLAR_NETWORK=testnet  # or mainnet
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
```

## Kubernetes Integration

### Liveness Probe

Use the readiness endpoint for liveness detection:

```yaml
livenessProbe:
  httpGet:
    path: /health/ready
    port: 3000
  initialDelaySeconds: 30
  periodSeconds: 10
  timeoutSeconds: 5
  failureThreshold: 3
```

### Readiness Probe

Use the same readiness endpoint:

```yaml
readinessProbe:
  httpGet:
    path: /health/ready
    port: 3000
  initialDelaySeconds: 10
  periodSeconds: 5
  timeoutSeconds: 3
  failureThreshold: 2
```

### Startup Probe (Optional)

For slower startups:

```yaml
startupProbe:
  httpGet:
    path: /health/ready
    port: 3000
  failureThreshold: 30
  periodSeconds: 10
```

## Usage Examples

### Monitoring All Dependencies

```bash
curl http://localhost:3000/health | jq
```

### Checking if Service is Ready

```bash
curl -i http://localhost:3000/health/ready
# Returns 200 if ready, 503 if not
```

### Getting Detailed Service Status

```bash
curl http://localhost:3000/health/detailed | jq
```

### Health Check with TTL (Caching)

Health checks are not cached by default. Each request performs fresh checks. If caching is desired, it must be implemented at a reverse proxy or load balancer level.

## Best Practices

### 1. **Monitoring**
- Monitor `/health/detailed` endpoint for non-critical service failures
- Alert on database failures (HTTP 503 from `/health`)
- Log warnings for Redis/Horizon failures at appropriate intervals

### 2. **Load Balancer Configuration**
- Use `/health/ready` for load balancer health checks
- Database failure will be detected and traffic removed
- Non-critical service failures won't affect traffic routing

### 3. **Alert Thresholds**
- **Database**: Alert immediately (critical path)
- **Redis**: Alert after 5 minutes of consecutive failures (caching layer)
- **Horizon**: Alert after 10 minutes of consecutive failures (external service)

### 4. **Integration with Prometheus/Grafana**
Consider adding metrics endpoints for detailed monitoring:
```
health_check_database{status="up"|"down"} 1|0
health_check_redis{status="up"|"down"} 1|0
health_check_horizon{status="up"|"down"} 1|0
health_check_response_time_ms 42
```

## Testing

### Health Check Tests

```bash
npm test -- health
```

### Manual Testing

```bash
# All healthy
curl http://localhost:3000/health

# With Redis down (simulate by stopping Redis)
docker-compose down redis
curl http://localhost:3000/health

# Restore Redis
docker-compose up redis
```

## Troubleshooting

### Problem: Database Check Always Fails

**Solution:** Verify database connection parameters:
```bash
# Check environment variables
echo $DB_HOST $DB_PORT

# Test connectivity
nc -zv $DB_HOST $DB_PORT
```

### Problem: Redis Check Hangs

**Solution:** Verify Redis is running and accessible:
```bash
redis-cli ping
# Should return PONG
```

### Problem: Horizon Check Returns Down

**Solution:** Verify internet connectivity and API rate limits:
```bash
curl https://horizon.stellar.org/ledgers?limit=1
# Check if accessible and not rate-limited
```

## Performance Impact

- **Health Check Latency**: 
  - Database: ~100ms (TCP connection only)
  - Redis: ~50-200ms (set/get/del operations)
  - Horizon: ~500-2000ms (HTTP API call)
  - Total: ~650-2300ms (parallel execution)

- **Resource Usage**:
  - Memory: Minimal (single health check key in Redis)
  - CPU: Negligible
  - Network: 3 TCP/HTTP connections per check

## Future Enhancements

1. **Custom Health Checks**: Add checks for external APIs used by the system
2. **Health Check History**: Store historical health data for analysis
3. **Metrics Export**: Expose health status in Prometheus format
4. **Conditional Checks**: Skip checks based on environment or feature flags
5. **Dependency Graph**: Show how service failures cascade through the system
