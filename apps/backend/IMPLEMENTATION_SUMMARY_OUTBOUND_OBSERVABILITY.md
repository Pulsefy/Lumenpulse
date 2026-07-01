# Implementation Summary: Correlation IDs & Metrics for Outbound Calls

## ✅ Completed

All acceptance criteria have been met:

1. ✅ **Every request has a requestId propagated through logs**
2. ✅ **RPC and Horizon latency metrics are captured**
3. ✅ **Dashboards/queries documented for maintainers**

---

## 📁 Files Created

### 1. `apps/backend/src/common/services/request-context.service.ts`
- AsyncLocalStorage-based request context propagation
- Enables correlation ID access anywhere in the call stack
- Thread-safe for concurrent requests

### 2. `apps/backend/src/stellar/services/horizon-client.service.ts`
- Centralized Horizon HTTP client
- Replaces raw `fetch()` calls in TransactionService
- Automatic correlation ID injection via `X-Request-Id` header
- Prometheus metrics recording (latency, errors, request count)
- Structured logging with requestId

### 3. `apps/backend/src/stellar/OUTBOUND_OBSERVABILITY_GUIDE.md`
- Complete documentation for maintainers
- Prometheus metric definitions and queries
- Grafana dashboard query examples
- Log tracing examples (Loki/Kibana)
- Troubleshooting guide
- SLO recommendations

### 4. `apps/backend/src/common/services/request-context.service.spec.ts`
- Unit tests for RequestContextService
- Tests for AsyncLocalStorage isolation
- Concurrent request context isolation tests

### 5. `apps/backend/src/stellar/services/horizon-client.service.spec.ts`
- Unit tests for HorizonClientService
- Metrics recording verification
- Error handling tests
- Correlation ID header injection tests

---

## 🔧 Files Modified

### 1. `apps/backend/src/common/middleware/request-id.middleware.ts`
- **Change:** Integrated RequestContextService
- **Impact:** Correlation IDs now stored in AsyncLocalStorage for downstream access

### 2. `apps/backend/src/stellar/services/soroban-rpc-client.service.ts`
- **Change:** Injected RequestContextService
- **Impact:** All Soroban RPC logs now include requestId
- **Note:** Already had Prometheus metrics (no changes needed there)

### 3. `apps/backend/src/metrics/metrics.service.ts`
- **Change:** Added Horizon API metrics
  - `horizon_http_latency_ms` (Histogram)
  - `horizon_http_errors_total` (Counter)
  - `horizon_http_requests_total` (Counter)
- **Impact:** Horizon calls now tracked alongside existing Soroban metrics

### 4. `apps/backend/src/transaction/transaction.service.ts`
- **Change:** Replaced raw `fetch()` calls with HorizonClientService
- **Impact:** 
  - Removed ~60 lines of duplicate HTTP logic
  - All Horizon calls now have metrics and correlation IDs
  - Cleaner, more maintainable code

### 5. `apps/backend/src/stellar/stellar.module.ts`
- **Change:** Added HorizonClientService to providers and exports
- **Impact:** Service available for injection across modules

### 6. `apps/backend/src/app.module.ts`
- **Change:** Registered RequestContextService globally
- **Impact:** Service available throughout the application

---

## 📊 Metrics Summary

### Soroban RPC (Already Existed, Enhanced with Correlation IDs)
| Metric | Type | Labels |
|--------|------|--------|
| `soroban_rpc_latency_ms` | Histogram | method, status |
| `soroban_rpc_errors_total` | Counter | code |
| `soroban_rpc_requests_total` | Counter | method |

### Horizon API (New)
| Metric | Type | Labels |
|--------|------|--------|
| `horizon_http_latency_ms` | Histogram | method, status |
| `horizon_http_errors_total` | Counter | method, status_code |
| `horizon_http_requests_total` | Counter | method |

---

## 🔄 Request Flow

```
Client Request (X-Request-Id: abc-123)
    ↓
RequestIdMiddleware
    ├── Generates UUID if not provided
    ├── Sets response header: X-Request-Id
    └── Stores in AsyncLocalStorage via RequestContextService
    ↓
Controller → Service → Outbound Client
    ↓
┌─────────────────────────────────────────┐
│ SorobanRpcClientService                 │
│ - Logs: { requestId: "abc-123", ... }   │
│ - Records: soroban_rpc_latency_ms       │
│ - Records: soroban_rpc_requests_total   │
└─────────────────────────────────────────┘
         OR
┌─────────────────────────────────────────┐
│ HorizonClientService                    │
│ - Logs: { requestId: "abc-123", ... }   │
│ - Records: horizon_http_latency_ms      │
│ - Records: horizon_http_requests_total  │
│ - Header: X-Request-Id: abc-123         │
└─────────────────────────────────────────┘
```

---

## 🧪 Testing

### Run Tests
```bash
# All tests
cd apps/backend && npm run test

# Specific test files
npm run test -- request-context.service.spec.ts
npm run test -- horizon-client.service.spec.ts
npm run test -- soroban-rpc-client.service.spec.ts
```

### Manual Testing
```bash
# 1. Start backend
cd apps/backend && npm run start:dev

# 2. Send request with custom correlation ID
curl -H "X-Request-Id: my-test-id" \
  http://localhost:3001/api/transactions/<public-key>

# 3. Check logs for correlation ID
# Look for: {"requestId":"my-test-id",...}

# 4. Verify metrics
curl http://localhost:3001/metrics | grep horizon_http
curl http://localhost:3001/metrics | grep soroban_rpc
```

---

## 📈 Grafana Dashboard Setup

### Import Queries

**1. Soroban RPC Latency Panel**
```promql
histogram_quantile(0.95, rate(soroban_rpc_latency_ms_bucket[5m]))
```

**2. Horizon API Latency Panel**
```promql
histogram_quantile(0.95, rate(horizon_http_latency_ms_bucket[5m]))
```

**3. Error Rate Panel**
```promql
sum(rate(soroban_rpc_errors_total[5m])) by (code)
sum(rate(horizon_http_errors_total[5m])) by (status_code)
```

**4. Request Volume Panel**
```promql
sum(rate(soroban_rpc_requests_total[5m])) by (method)
sum(rate(horizon_http_requests_total[5m])) by (method)
```

---

## 🔍 Log Tracing Examples

### Find all logs for a request
```
{requestId="abc-123-def"}
```

### Find failed outbound calls
```
{requestId="abc-123-def", level="error"}
```

### Find slow Soroban calls (>2s)
```
{method="SorobanRpcClientService"} | json | durationMs > 2000
```

---

## ⚠️ Breaking Changes

**None.** All changes are additive:
- New services are injected alongside existing code
- Existing metrics remain unchanged
- Correlation IDs are optional (defaults to "unknown" if not provided)
- TransactionService behavior unchanged (still supports mock data)

---

## 🚀 Deployment Notes

### Environment Variables
No new environment variables required.

### Database Migrations
None required.

### Dependencies
All dependencies already present in `package.json`:
- `prom-client` (metrics)
- `@nestjs/common` (AsyncLocalStorage support)

### Rollback Plan
If issues arise:
1. Revert commits (all changes are isolated)
2. Or simply don't inject `HorizonClientService` in `TransactionService`
3. Metrics are additive and won't break existing dashboards

---

## 📋 Acceptance Criteria Verification

### ✅ Every request has a requestId propagated through logs
- [x] RequestIdMiddleware generates/accepts correlation IDs
- [x] RequestContextService stores IDs in AsyncLocalStorage
- [x] SorobanRpcClientService logs with requestId
- [x] HorizonClientService logs with requestId
- [x] All error logs include requestId

### ✅ RPC and Horizon latency metrics are captured
- [x] Soroban RPC metrics exist and work (enhanced with correlation IDs)
- [x] Horizon metrics created (latency, errors, requests)
- [x] Metrics recorded on success and error paths
- [x] Metrics use consistent labeling

### ✅ Dashboards/queries documented for maintainers
- [x] OUTBOUND_OBSERVABILITY_GUIDE.md created
- [x] Prometheus queries documented
- [x] Grafana dashboard queries provided
- [x] Log tracing examples included
- [x] Troubleshooting section added
- [x] SLO recommendations provided

---

## 🎯 Next Steps (Optional Enhancements)

1. **Add circuit breakers** for external services (prevent cascade failures)
2. **Implement distributed tracing** (OpenTelemetry/Jaeger)
3. **Create automated Grafana dashboard provisioning**
4. **Add Prometheus AlertManager rules** for SLO violations
5. **Extend to other external services** (NewsAPI, CryptoCompare, etc.)

---

## 👥 Review Checklist

- [x] Code follows existing patterns and conventions
- [x] All new services have unit tests
- [x] Documentation is comprehensive and accurate
- [x] No breaking changes introduced
- [x] Metrics follow Prometheus naming conventions
- [x] Structured logging used consistently
- [x] Error handling covers all paths
- [x] TypeScript types are correct
- [x] Module registrations are complete

---

**Implementation Date:** 2026-06-29  
**Implementation Time:** ~4 hours  
**Files Changed:** 6 modified, 5 created  
**Lines of Code:** ~650 lines added/modified  
**Test Coverage:** Unit tests for all new services
