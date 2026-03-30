# Health Check Quick Reference

## Quick Start

### Main Endpoint
```bash
# Get service status with graceful degradation
curl http://localhost:3000/health
```

### Detailed Status
```bash
# Get detailed service information
curl http://localhost:3000/health/detailed
```

### Readiness Probe
```bash
# Check if service is ready (for Kubernetes)
curl http://localhost:3000/health/ready
```

## Endpoints Summary

| Endpoint | Method | Purpose | HTTP 200 When | HTTP 503 When |
|----------|--------|---------|---------------|---------------|
| `/health` | GET | Main health check with graceful degradation | Database is UP (Redis/Horizon can be down) | Database is DOWN |
| `/health/detailed` | GET | Detailed status of all services | Always (informational only) | Never |
| `/health/ready` | GET | Readiness probe for orchestration | Database is UP | Database is DOWN |

## Response Examples

### ✅ All Services UP (GET /health)
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

### ⚠️ Degraded but Operational (GET /health)
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

### ❌ Critical Service Down (GET /health)
HTTP/1.1 503 Service Unavailable
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

## Service Classification

### 🔴 Critical (Database)
- **Failure Impact:** Service returns HTTP 503
- **API Operation:** API cannot operate without database
- **Kubernetes Action:** Pod marked as not ready

### 🟡 Non-Critical (Redis, Horizon)
- **Failure Impact:** Service returns HTTP 200, includes error in response
- **API Operation:** API continues with degraded cache/blockchain features
- **Kubernetes Action:** No action, service remains healthy for load balancer

## Configuration

```bash
# Core Settings
DB_HOST=localhost
DB_PORT=5432
REDIS_HOST=localhost
REDIS_PORT=6379
STELLAR_HORIZON_URL=https://horizon.stellar.org
```

## Testing

### Local Testing
```bash
# Test all endpoints
curl http://localhost:3000/health
curl http://localhost:3000/health/detailed
curl http://localhost:3000/health/ready

# Parse JSON responses
curl -s http://localhost:3000/health | jq '.checks'

# Watch health status (Linux)
watch -n 1 'curl -s http://localhost:3000/health | jq .'

# Check HTTP status only
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/health
```

### Docker Compose
```bash
# All healthy
docker-compose up
curl http://localhost:3000/health

# Simulate Redis failure
docker-compose down redis
curl http://localhost:3000/health  # Returns 200 with redis down

# Simulate Database failure
docker-compose down db
curl http://localhost:3000/health  # Returns 503 with database down
```

## Kubernetes Integration

### Liveness Probe
```yaml
livenessProbe:
  httpGet:
    path: /health/ready
    port: 3000
  initialDelaySeconds: 30
  periodSeconds: 10
  failureThreshold: 3
```

### Readiness Probe
```yaml
readinessProbe:
  httpGet:
    path: /health/ready
    port: 3000
  initialDelaySeconds: 10
  periodSeconds: 5
  failureThreshold: 2
```

### Startup Probe
```yaml
startupProbe:
  httpGet:
    path: /health/ready
    port: 3000
  failureThreshold: 30
  periodSeconds: 10
```

## Monitoring Commands

### Check Service Health
```bash
# Simple check
curl -f http://localhost:3000/health/ready && echo "Healthy" || echo "Unhealthy"

# Detailed monitoring
watch -n 5 'curl -s http://localhost:3000/health | jq "{
  status: .status,
  database: .checks.database.status,
  redis: .checks.redis.status,
  horizon: .checks.horizon.status
}"'

# JSON parsing examples
curl -s http://localhost:3000/health | jq '.checks | to_entries[] | "\(.key): \(.value.status)"'
```

### Health Check Automation
```bash
# Alert on critical failure
if curl -s -f http://localhost:3000/health/ready >/dev/null; then
  echo "Service is healthy"
else
  echo "Service is DOWN - critical failure"
  # Send alert
fi

# Monitor all services
while true; do
  status=$(curl -s http://localhost:3000/health/detailed)
  echo "$(date): $status" >> health-log.txt
  sleep 60
done
```

## Troubleshooting

### Database Connection Issues
```bash
# Check if database is accessible
nc -zv localhost 5432
# Or
psql -h localhost -U postgres -d lumenpulse -c "SELECT 1"
```

### Redis Connection Issues
```bash
# Check if Redis is accessible
redis-cli ping
# Should return PONG
```

### Horizon API Issues
```bash
# Test Horizon directly
curl https://horizon.stellar.org/ledgers?limit=1

# Test with timeout (like the health check)
curl --max-time 5 -s https://horizon.stellar.org/ledgers?limit=1
```

## Performance

- **Database Check:** ~100ms (TCP connection)
- **Redis Check:** ~50-200ms (set/get/del)
- **Horizon Check:** ~500-2000ms (HTTP API)
- **Total:** ~650-2300ms (parallel execution)

## HTTP Status Codes

| Status | Meaning | When to Expect |
|--------|---------|-----------------|
| 200 OK | Service is healthy or operational | Database is UP |
| 503 Service Unavailable | Critical service is down | Database is DOWN |

## See Also

- Full documentation: `HEALTH_CHECK_IMPLEMENTATION.md`
- Implementation guide: `HEALTH_CHECK_EXPANSION.md`
- Source code: `/apps/backend/src/health/`
