# Contract-Specific Ingestion Lag Dashboard Metrics

**Issue**: #878  
**Complexity**: 150 points  
**Goal**: Measure lag per contract domain so maintainers know which ingestion path is behind.

## Overview

This feature tracks ingestion lag for specific Soroban contract domains, enabling maintainers to identify bottlenecks in the ingestion pipeline at the contract level. The system measures lag as the time delta between now and the last processed event for each contract domain.

### Supported Contract Domains

- **Registry**: Project registry contract
- **Vault**: Treasury vault contract
- **Matching Pool**: Grant matching pool contract
- **Treasury**: Treasury management contract
- **Vesting**: Vesting wallet contract

## Architecture

### Components

#### 1. Contract Lag Tracker Module (`src/ingestion/contract_lag_tracker.py`)

The core module that:
- Measures ingestion lag per contract domain
- Exposes Prometheus metrics
- Manages alert thresholds
- Provides JSON-serializable snapshots for API responses

**Key Functions**:
- `measure_contract_lag()`: Measures lag for a single contract domain
- `measure_all_contract_lags()`: Measures all domains in parallel
- `run_contract_lag_cycle()`: Orchestrates full measurement cycle with logging
- `get_contract_domain_config()`: Returns configuration for all domains

**Prometheus Metrics**:
- `lumenpulse_contract_lag_seconds`: Current lag per domain
- `lumenpulse_contract_last_ledger`: Latest processed ledger per domain
- `lumenpulse_contract_events_processed_total`: Cumulative event count per domain
- `lumenpulse_contract_ingestion_failures_total`: Failure count per domain

#### 2. Scheduler Integration

The contract lag tracking job runs periodically (configurable, default: every 5 minutes) via the APScheduler in `src/scheduler.py`.

**Job**: `_contract_lag_tracking_job()`
- Runs `run_contract_lag_cycle()` asynchronously
- Handles errors gracefully to keep scheduler alive
- Logs summary of health, warnings, and criticals

#### 3. API Endpoints (`src/api/server.py`)

##### GET `/contract-lag`

Returns current ingestion lag for all contract domains in machine-friendly JSON format.

**Response**:
```json
{
  "timestamp": "2026-07-01T12:30:45.123456+00:00",
  "total_domains": 5,
  "healthy_domains": 3,
  "warning_domains": 1,
  "critical_domains": 1,
  "contracts": {
    "registry": {
      "contract_domain": "registry",
      "lag_seconds": 45.2,
      "severity": "healthy",
      "last_processed_ledger": 1234567,
      "last_processed_timestamp": "2026-07-01T12:30:00Z",
      "event_count": 1024,
      "warning_threshold_seconds": 300,
      "critical_threshold_seconds": 900
    },
    "vault": {...},
    ...
  },
  "domain_config": {
    "registry": {
      "contract_id": "CA...",
      "configured": true,
      "warning_threshold_seconds": 300,
      "critical_threshold_seconds": 900
    },
    ...
  }
}
```

**Status Codes**:
- `200`: Success — metrics returned
- `503`: Database service unavailable
- `500`: Internal error during metric computation

**No authentication required** — metrics are considered non-sensitive operational data.

#### 4. Grafana Dashboard

Five stat panels display current lag for each domain with color-coded severity:

| Panel | Domain | Warning | Critical | Color |
|-------|--------|---------|----------|-------|
| Registry Lag | registry | 300s (5m) | 900s (15m) | Green→Yellow→Red |
| Vault Lag | vault | 600s (10m) | 1800s (30m) | Green→Yellow→Red |
| Matching Pool Lag | matching_pool | 300s (5m) | 1200s (20m) | Green→Yellow→Red |
| Treasury Lag | treasury | 600s (10m) | 1800s (30m) | Green→Yellow→Red |
| Vesting Lag | vesting | 900s (15m) | 2700s (45m) | Green→Yellow→Red |

Additional panels:
- **Contract Ingestion Lag — Trend**: Time series showing lag evolution per domain
- **Contract Last Ledger Processed**: Monotonically increasing ledger heights (stalling = lag increase)
- **Contract Events Processed — Rate**: Events processed per minute by domain and status

## Configuration

### Environment Variables

All contract addresses and thresholds are configurable via environment variables.

#### Contract Addresses (required for tracking)

```bash
CONTRACT_REGISTRY=CA...        # Project registry contract address
CONTRACT_VAULT=CA...           # Vault contract address
CONTRACT_MATCHING_POOL=CA...   # Matching pool contract address
CONTRACT_TREASURY=CA...        # Treasury contract address
CONTRACT_VESTING=CA...         # Vesting contract address
```

**Note**: If a contract address is not configured, that domain is skipped with a warning.

#### Alert Thresholds (optional, with sensible defaults)

**Registry** (default: 5m warning / 15m critical):
```bash
REGISTRY_LAG_WARNING_SECONDS=300    # 5 minutes
REGISTRY_LAG_CRITICAL_SECONDS=900   # 15 minutes
```

**Vault** (default: 10m warning / 30m critical):
```bash
VAULT_LAG_WARNING_SECONDS=600       # 10 minutes
VAULT_LAG_CRITICAL_SECONDS=1800     # 30 minutes
```

**Matching Pool** (default: 5m warning / 20m critical):
```bash
MATCHING_POOL_LAG_WARNING_SECONDS=300
MATCHING_POOL_LAG_CRITICAL_SECONDS=1200
```

**Treasury** (default: 10m warning / 30m critical):
```bash
TREASURY_LAG_WARNING_SECONDS=600
TREASURY_LAG_CRITICAL_SECONDS=1800
```

**Vesting** (default: 15m warning / 45m critical):
```bash
VESTING_LAG_WARNING_SECONDS=900
VESTING_LAG_CRITICAL_SECONDS=2700
```

#### Scheduler Configuration (optional)

```bash
CONTRACT_LAG_INTERVAL_MINUTES=5     # Measurement frequency (default: 5 minutes)
```

### Example `.env` Configuration

```bash
# Stellar testnet contracts (example)
CONTRACT_REGISTRY=CAAA...AAAA
CONTRACT_VAULT=CABB...BBBB
CONTRACT_MATCHING_POOL=CACC...CCCC
CONTRACT_TREASURY=CADD...DDDD
CONTRACT_VESTING=CAEE...EEEE

# Use defaults for thresholds (5m/15m, 10m/30m, etc.)
# Or override individual thresholds:
REGISTRY_LAG_WARNING_SECONDS=180      # 3 minutes (tighter SLA)
REGISTRY_LAG_CRITICAL_SECONDS=600     # 10 minutes

# Run measurements every 2 minutes instead of 5
CONTRACT_LAG_INTERVAL_MINUTES=2
```

## Alerting

### Severity Levels

Severity is determined by comparing current lag against thresholds:

| Severity | Condition | Action |
|----------|-----------|--------|
| **HEALTHY** | lag < warning_threshold | Green panel; no alert |
| **WARNING** | warning_threshold ≤ lag < critical_threshold | Yellow panel; log warning |
| **CRITICAL** | lag ≥ critical_threshold | Red panel; log error + alert |

### Log Integration

When measurements complete, structured logs are emitted:

```json
{
  "level": "warning",
  "message": "Contract lag: domain=vault, lag=742.3s, severity=warning, ledger=12345, events=456",
  "timestamp": "2026-07-01T12:30:45.123Z",
  "domain": "vault",
  "lag_seconds": 742.3,
  "severity": "warning"
}
```

**Critical alerts** are logged at ERROR level for integration with external alerting systems (e.g., Elasticsearch, Splunk, DataDog).

### Prometheus Alerting Rules

Example Prometheus alert rule (add to `prometheus-rules.yml`):

```yaml
groups:
  - name: contract_ingestion
    rules:
      - alert: ContractIngestionLagCritical
        expr: lumenpulse_contract_lag_seconds > on(contract_domain) group_left() (1900 * (contract_domain == "vault"))
        for: 5m
        annotations:
          summary: "{{ $labels.contract_domain }} contract ingestion is critically behind"
          description: "{{ $labels.contract_domain }} lag is {{ $value }}s"
      
      - alert: ContractIngestionLagWarning
        expr: lumenpulse_contract_lag_seconds > on(contract_domain) group_left() (700 * (contract_domain == "vault"))
        for: 10m
        annotations:
          summary: "{{ $labels.contract_domain }} contract ingestion is degraded"
          description: "{{ $labels.contract_domain }} lag is {{ $value }}s"
```

## Usage

### Local Development

1. **Configure environment**:
   ```bash
   cp apps/data-processing/.env.example apps/data-processing/.env
   # Edit .env and add your contract addresses (testnet recommended)
   ```

2. **Start data processing service**:
   ```bash
   cd apps/data-processing
   python src/main.py serve
   ```

3. **Query metrics**:
   ```bash
   # JSON endpoint
   curl http://localhost:8000/contract-lag | jq

   # Prometheus text format
   curl http://localhost:9090/metrics | grep lumenpulse_contract_lag
   ```

4. **Monitor in Grafana**:
   - Add data source: `http://localhost:9090` (Prometheus)
   - Import dashboard: [See Dashboard JSON in repo](../../lumenpulse-grafana-dashboard.json)
   - View "Contract Ingestion Lag" panels

### Hosted Environment

1. **Deploy with contract configuration**:
   ```bash
   # In your deployment (k8s, Docker, etc.), set environment:
   CONTRACT_REGISTRY=CA...
   CONTRACT_VAULT=CA...
   # ... other contracts
   
   # Customize thresholds for production SLAs
   REGISTRY_LAG_CRITICAL_SECONDS=1200  # Stricter than default 15m
   ```

2. **Verify metrics are exposed**:
   ```bash
   curl https://data-processing.example.com/contract-lag
   ```

3. **Configure Grafana datasource** to point to your Prometheus:
   ```
   URL: https://prometheus.example.com
   ```

4. **Set up alerting** in Prometheus or Grafana:
   - Configure notification channels (Slack, PagerDuty, etc.)
   - Attach alert rules (see Alerting section above)

## Query Examples

### PromQL Queries

**Current lag per contract**:
```promql
lumenpulse_contract_lag_seconds
```

**Show only critical domains**:
```promql
lumenpulse_contract_lag_seconds > on(contract_domain) group_left() (900 * (contract_domain == "registry"))
```

**Average lag per domain (5-minute average)**:
```promql
avg_over_time(lumenpulse_contract_lag_seconds[5m])
```

**Rate of event processing per minute**:
```promql
sum by (contract_domain) (rate(lumenpulse_contract_events_processed_total[5m])) * 60
```

### REST API Queries

**Get current status**:
```bash
curl http://localhost:8000/contract-lag
```

**Get only critical domains** (client-side filtering):
```bash
curl http://localhost:8000/contract-lag | jq '.contracts | map(select(.severity == "critical"))'
```

**Monitor specific domain**:
```bash
curl http://localhost:8000/contract-lag | jq '.contracts.vault'
```

## Troubleshooting

### No metrics appearing

**Symptom**: `/metrics` endpoint returns empty or no `lumenpulse_contract_*` metrics.

**Causes**:
1. Contract addresses not configured in `.env`
2. No contract events exist in the database for a domain
3. Scheduler job hasn't run yet (wait for next interval)

**Solution**:
- Check `.env`: `echo $CONTRACT_REGISTRY`
- Verify contract events exist: `SELECT COUNT(*) FROM contract_events WHERE contract_id = 'CA...';`
- Check logs: `grep "contract_lag" logs/data_processor.log`

### Lag always increasing

**Symptom**: `lag_seconds` increases over time without reset.

**Causes**:
1. No new events are being ingested for that domain
2. Ingestion job is stalled
3. Contract address is wrong (pointing to empty contract)

**Solution**:
- Verify contract address is correct
- Check ingestion job logs: `tail -f logs/data_processor.log | grep "ingestion"`
- Manually ingest a test event to trigger metric update

### Thresholds not applying

**Symptom**: Lag is above threshold but severity stays green.

**Causes**:
1. Environment variable not reloaded after `.env` change
2. Threshold variable name is incorrect
3. Service restarted without new env vars

**Solution**:
- Restart data processing service: `python src/main.py serve`
- Verify env vars: `python -c "import os; print(os.getenv('REGISTRY_LAG_WARNING_SECONDS'))"`
- Check logs for configuration load: `grep "thresholds" logs/data_processor.log`

## Testing

### Unit Tests

```bash
cd apps/data-processing
pytest tests/test_contract_lag_tracker.py -v
```

**Test scenarios**:
- Lag calculation correctness
- Severity assignment logic
- Threshold override from environment
- Metric publication to Prometheus
- API endpoint responses
- Error handling for missing contracts

### Integration Tests

```bash
# Start test database
docker-compose -f docker-compose.test.yml up

# Run integration tests
pytest tests/integration/test_contract_lag_e2e.py -v
```

**Scenarios**:
- Measure lag from live database
- Verify metrics in Prometheus
- Test API response format
- Verify scheduler job execution

### Manual Testing

```bash
# 1. Insert test contract events
python scripts/insert_test_contract_events.py --domain registry --count 10

# 2. Trigger lag measurement
curl -X POST http://localhost:8000/admin/trigger-contract-lag-cycle

# 3. Query metrics
curl http://localhost:8000/contract-lag | jq

# 4. Verify Prometheus scraped metrics
curl http://localhost:9090/api/v1/query?query=lumenpulse_contract_lag_seconds | jq
```

## Performance Considerations

### Database Query Optimization

The contract lag tracking uses efficient database queries:
- **Single query per domain**: `SELECT * FROM contract_events WHERE contract_id=? ORDER BY ledger DESC LIMIT 1`
- **Indexed columns**: `contract_id`, `ledger`, `timestamp` are all indexed
- **Async execution**: Measurement cycle uses asyncio for parallel domain queries
- **Measurement frequency**: Default 5 minutes = ~288 measurements/day per domain

**Expected performance**:
- Latency: <100ms per domain (on typical infrastructure)
- Total cycle time: <500ms for all 5 domains
- Database load: Negligible (<0.1% CPU)

### Prometheus Cardinality

Metrics use 2-3 label dimensions:
- `lumenpulse_contract_lag_seconds`: 2 labels (contract_domain, environment)
- `lumenpulse_contract_events_processed_total`: 2 labels (contract_domain, status)
- `lumenpulse_contract_ingestion_failures_total`: 2 labels (contract_domain, failure_type)

**Cardinality**: ~10-15 unique series (5 domains × 2-3 variants)  
**Impact**: Minimal (<1% Prometheus cardinality for typical workloads)

## Future Enhancements

- **Event latency percentiles**: p50/p95/p99 latency per domain
- **Backpressure detection**: Alert when events are queued but not processed
- **Ledger finality lag**: Track finality vs. ingestion separately
- **Contract state verification**: Cross-check ingested state against on-chain
- **Cost analysis**: Track ingestion cost per domain (RPC calls, compute)
- **Custom domain grouping**: Alert on aggregates (e.g., "all contracts" or "critical contracts")

## References

- **Issue**: [#878 Data-processing: Contract-specific ingestion lag dashboard metrics](https://github.com/Pulsefy/Lumenpulse/issues/878)
- **Related**: [#745 Indexer lag metrics & alerts](https://github.com/Pulsefy/Lumenpulse/issues/745)
- **Related**: [#882 Metadata drift detection](https://github.com/Pulsefy/Lumenpulse/issues/882)
- **Prometheus Metrics**: [METRICS_DOCUMENTATION.md](apps/backend/METRICS_DOCUMENTATION.md)
- **Grafana Dashboard**: [lumenpulse-grafana-dashboard.json](lumenpulse-grafana-dashboard.json)
