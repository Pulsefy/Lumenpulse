# Outbound Call Observability Guide

## Overview

All outbound calls to **Soroban RPC** and **Horizon API** are now instrumented with:
- ✅ Request correlation IDs (`X-Request-Id` header)
- ✅ Latency metrics (Prometheus histograms)
- ✅ Error tracking (Prometheus counters)
- ✅ Structured logging with `requestId`

This enables end-to-end tracing of requests from client → backend → external services.

---

## Architecture

### Correlation ID Flow

```
Client Request
    ↓ (X-Request-Id header or auto-generated)
RequestIdMiddleware
    ↓ (stores in AsyncLocalStorage)
RequestContextService
    ↓ (accessible anywhere)
┌─────────────────────┬──────────────────────┐
│ SorobanRpcClient    │  HorizonClient       │
│ - Logs with reqId   │  - Logs with reqId   │
│ - Records metrics   │  - Records metrics   │
└─────────────────────┴──────────────────────┘
```

### Implementation Files

| File | Purpose |
|------|---------|
| `common/services/request-context.service.ts` | AsyncLocalStorage-based context propagation |
| `common/middleware/request-id.middleware.ts` | Generates/propagates correlation IDs |
| `stellar/services/soroban-rpc-client.service.ts` | Soroban RPC client with metrics + correlation IDs |
| `stellar/services/horizon-client.service.ts` | Horizon HTTP client with metrics + correlation IDs |
| `metrics/metrics.service.ts` | Prometheus metrics registry |

---

## Prometheus Metrics

### Soroban RPC Metrics

#### `soroban_rpc_latency_ms` (Histogram)
Latency of Soroban RPC calls in milliseconds.

**Labels:**
- `method`: RPC method name (e.g., `getAccount`, `simulateTransaction`, `sendTransaction`)
- `status`: `success` or `error`

**Buckets:** `[50, 100, 250, 500, 1000, 2500, 5000]` ms

**Example Query:**
```promql
# P95 latency for all Soroban RPC calls
histogram_quantile(0.95, rate(soroban_rpc_latency_ms_bucket[5m]))

# P99 latency for getAccount method
histogram_quantile(0.99, rate(soroban_rpc_latency_ms_bucket{method="getAccount"}[5m]))
```

#### `soroban_rpc_errors_total` (Counter)
Total number of Soroban RPC errors by error code.

**Labels:**
- `code`: Error code (e.g., `SOROBAN_TIMEOUT`, `SOROBAN_SIMULATION_FAILED`, `SOROBAN_NETWORK_ERROR`)

**Example Query:**
```promql
# Error rate per second
rate(soroban_rpc_errors_total[5m])

# Errors by code
sum(rate(soroban_rpc_errors_total[5m])) by (code)
```

#### `soroban_rpc_requests_total` (Counter)
Total number of Soroban RPC requests.

**Labels:**
- `method`: RPC method name

**Example Query:**
```promql
# Request rate by method
sum(rate(soroban_rpc_requests_total[5m])) by (method)
```

---

### Horizon API Metrics

#### `horizon_http_latency_ms` (Histogram)
Latency of Horizon API calls in milliseconds.

**Labels:**
- `method`: API method name (e.g., `getTransactions`, `getOperations`)
- `status`: `success` or HTTP status code (e.g., `404`, `500`)

**Buckets:** `[50, 100, 250, 500, 1000, 2500, 5000]` ms

**Example Query:**
```promql
# P95 latency for Horizon calls
histogram_quantile(0.95, rate(horizon_http_latency_ms_bucket[5m]))

# Average latency for getTransactions
rate(horizon_http_latency_ms_sum{method="getTransactions"}[5m]) / 
rate(horizon_http_latency_ms_count{method="getTransactions"}[5m])
```

#### `horizon_http_errors_total` (Counter)
Total number of Horizon API errors.

**Labels:**
- `method`: API method name
- `status_code`: HTTP status code or `NETWORK_ERROR`

**Example Query:**
```promql
# Error rate by method and status
sum(rate(horizon_http_errors_total[5m])) by (method, status_code)

# Total 4xx errors
sum(rate(horizon_http_errors_total{status_code=~"4.."}[5m]))
```

#### `horizon_http_requests_total` (Counter)
Total number of Horizon API requests.

**Labels:**
- `method`: API method name

**Example Query:**
```promql
# Request volume by method
sum(rate(horizon_http_requests_total[5m])) by (method)
```

---

## Grafana Dashboard Queries

### 1. High Latency Alerts

```promql
# Soroban RPC P95 > 2 seconds
histogram_quantile(0.95, rate(soroban_rpc_latency_ms_bucket[5m])) > 2000

# Horizon P95 > 3 seconds
histogram_quantile(0.95, rate(horizon_http_latency_ms_bucket[5m])) > 3000
```

### 2. Error Rate Monitoring

```promql
# Soroban error rate > 10% per minute
(
  sum(rate(soroban_rpc_errors_total[1m])) / 
  sum(rate(soroban_rpc_requests_total[1m]))
) > 0.1

# Horizon error rate > 5% per minute
(
  sum(rate(horizon_http_errors_total[1m])) / 
  sum(rate(horizon_http_requests_total[1m]))
) > 0.05
```

### 3. Request Volume

```promql
# Soroban RPC requests per minute
sum(rate(soroban_rpc_requests_total[1m])) by (method)

# Horizon API requests per minute
sum(rate(horizon_http_requests_total[1m])) by (method)
```

### 4. Availability SLA

```promql
# Soroban RPC availability (last 1 hour)
1 - (
  sum(rate(soroban_rpc_errors_total[1h])) / 
  sum(rate(soroban_rpc_requests_total[1h]))
)

# Horizon API availability (last 1 hour)
1 - (
  sum(rate(horizon_http_errors_total[1h])) / 
  sum(rate(horizon_http_requests_total[1h]))
)
```

### 5. Slow Requests Breakdown

```promql
# Count of Soroban RPC calls > 1 second
sum(
  increase(soroban_rpc_latency_ms_bucket{le="+Inf"}[5m])
) - sum(
  increase(soroban_rpc_latency_ms_bucket{le="1000"}[5m])
)

# Count of Horizon calls > 2 seconds
sum(
  increase(horizon_http_latency_ms_bucket{le="+Inf"}[5m])
) - sum(
  increase(horizon_http_latency_ms_bucket{le="2000"}[5m])
)
```

---

## Log Tracing

### Structured Log Format

All outbound calls log in JSON format with `requestId`:

**Soroban RPC Example:**
```json
{
  "level": "warn",
  "requestId": "abc-123-def-456",
  "method": "getAccount",
  "attempt": 2,
  "maxRetries": 3,
  "retrying": true,
  "error": "ECONNRESET",
  "message": "Soroban RPC call failed"
}
```

**Horizon API Example:**
```json
{
  "level": "error",
  "requestId": "abc-123-def-456",
  "method": "getTransactions",
  "status": 500,
  "error": "Internal server error",
  "message": "Horizon API error"
}
```

### Querying Logs (Grafana Loki / Kibana)

**Find all logs for a specific request:**
```
{requestId="abc-123-def-456"}
```

**Find failed outbound calls:**
```
{requestId="abc-123-def-456", level="error"}
```

**Trace a request through all services:**
```
{requestId="abc-123-def-456"} | json
| sort by timestamp
```

**Find slow Soroban RPC calls:**
```
{method="SorobanRpcClientService"}
| json
| durationMs > 2000
```

---

## HTTP Headers

### Request Headers

When the backend makes outbound calls, it includes:

```
X-Request-Id: <uuid>
Content-Type: application/json
```

### Response Headers

The backend includes the correlation ID in all responses:

```
X-Request-Id: <uuid>
```

This allows clients to correlate their requests with server-side logs.

---

## Testing

### Local Testing

1. **Start the backend:**
   ```bash
   cd apps/backend
   npm run start:dev
   ```

2. **Send a test request:**
   ```bash
   curl -H "X-Request-Id: test-123" http://localhost:3001/api/transactions/G...
   ```

3. **Check logs for correlation ID:**
   ```bash
   # Logs should include:
   # {"requestId":"test-123","method":"getTransactions",...}
   ```

4. **Check metrics endpoint:**
   ```bash
   curl http://localhost:3001/metrics | grep horizon_http
   curl http://localhost:3001/metrics | grep soroban_rpc
   ```

### Metrics Verification

```bash
# Verify Soroban metrics are being recorded
curl http://localhost:3001/metrics | grep -A 5 "soroban_rpc_latency_ms"

# Verify Horizon metrics are being recorded
curl http://localhost:3001/metrics | grep -A 5 "horizon_http_latency_ms"

# Check error counters
curl http://localhost:3001/metrics | grep "errors_total"
```

---

## Troubleshooting

### Issue: `requestId` is "unknown" in logs

**Cause:** Code is executing outside the request context (e.g., background jobs, cron).

**Solution:**
- For background jobs: Manually set context using `RequestContextService.run()`
- Example:
  ```typescript
  requestContextService.run({ requestId: `job-${jobId}` }, () => {
    // Your code here
  });
  ```

### Issue: Metrics not showing up

**Cause:** Metrics service not injected or registry mismatch.

**Solution:**
- Ensure `MetricsService` is injected into the client service
- Check that all metrics use the same registry (injected via constructor)
- Verify `/metrics` endpoint is accessible

### Issue: Correlation ID not propagated to external services

**Cause:** `instrumentedFetch` not being used or headers not set.

**Solution:**
- Ensure all outbound calls use `HorizonClientService` or `SorobanRpcClientService`
- Check that `X-Request-Id` header is included in fetch options

---

## Best Practices

1. **Always use the client services:**
   - ✅ `horizonClient.getTransactions()`
   - ✅ `sorobanRpcClient.getAccount()`
   - ❌ `fetch('https://horizon...')`

2. **Include requestId in all logs:**
   ```typescript
   const requestId = this.requestContextService.getRequestId();
   this.logger.log({ requestId, ... }, 'Message');
   ```

3. **Use structured logging:**
   ```typescript
   // ✅ Good
   this.logger.error({ requestId, method, error }, 'Failed');
   
   // ❌ Bad
   this.logger.error(`Failed: ${error.message}`);
   ```

4. **Record metrics in finally blocks:**
   ```typescript
   try {
     // ... operation
   } finally {
     this.metricsService.recordHorizonRequest(method, status, durationMs);
   }
   ```

---

## SLO Recommendations

Based on Stellar network characteristics:

| Metric | Warning | Critical |
|--------|---------|----------|
| Soroban RPC P95 Latency | > 2s | > 5s |
| Horizon P95 Latency | > 3s | > 8s |
| Soroban Error Rate | > 5% | > 15% |
| Horizon Error Rate | > 3% | > 10% |
| Availability (both) | < 99.5% | < 99% |

---

## Future Enhancements

- [ ] Add distributed tracing (OpenTelemetry/Jaeger)
- [ ] Implement circuit breakers for external services
- [ ] Add request/response payload logging (sanitized)
- [ ] Create automated Grafana dashboard provisioning
- [ ] Add alerting rules to Prometheus AlertManager

---

**Last Updated:** 2026-06-29  
**Maintained By:** Backend Engineering Team
