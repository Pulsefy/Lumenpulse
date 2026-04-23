# Metrics and Observability Documentation

## Overview

The LumenPulse backend now exposes application performance and health metrics through a dedicated `/metrics` endpoint. This endpoint is compatible with industry-standard monitoring tools like Prometheus and Grafana, enabling real-time visibility into application performance.

## Features

### Metrics Collected

#### HTTP Request Metrics
- **`http_requests_total`** (Counter): Total number of HTTP requests by method, route, and status code
- **`http_request_duration_seconds`** (Histogram): Request latency distribution with predefined buckets
- **`http_errors_total`** (Counter): Total number of HTTP errors (4xx and 5xx responses)

#### Job Queue Metrics (Optional)
- **`job_queue_size`** (Gauge): Current size of scheduled jobs in queue
- **`jobs_processed_total`** (Counter): Total processed jobs with success/failure status
- **`jobs_failed_total`** (Counter): Total failed jobs by queue

#### System Metrics
- **Node.js Process Metrics**: Memory usage, CPU time, GC metrics, event loop lag
- **Custom Metrics**: Applications can register additional custom gauges and counters

### Intelligent Route Normalization

The metrics system automatically normalizes routes to prevent metric cardinality explosion:
- `/users/123/posts/456` → `/users/:id/posts/:id`
- `@example.com-uuid-value` → `:id`
- Query parameters are stripped for cleaner metrics

## Endpoints

### GET /metrics
Returns application metrics in **Prometheus text format** (default).

**Content-Type**: `text/plain; version=0.0.4; charset=utf-8`

**Example Response**:
```
# HELP http_requests_total Total number of HTTP requests
# TYPE http_requests_total counter
http_requests_total{method="GET",route="/api/users",status="200"} 42
http_requests_total{method="POST",route="/api/users",status="201"} 15

# HELP http_request_duration_seconds HTTP request latency in seconds
# TYPE http_request_duration_seconds histogram
http_request_duration_seconds_bucket{method="GET",route="/api/users",status="200",le="0.01"} 10
http_request_duration_seconds_bucket{method="GET",route="/api/users",status="200",le="0.05"} 35
http_request_duration_seconds_bucket{method="GET",route="/api/users",status="200",le="5"} 42
http_request_duration_seconds_bucket{method="GET",route="/api/users",status="200",le="+Inf"} 42
http_request_duration_seconds_sum{method="GET",route="/api/users",status="200"} 0.45
http_request_duration_seconds_count{method="GET",route="/api/users",status="200"} 42
```

### GET /metrics?format=json
Returns metrics in **JSON format**.

**Example Response**:
```json
{
  "http_requests_total": {
    "name": "http_requests_total",
    "help": "Total number of HTTP requests",
    "type": "counter",
    "values": [
      {
        "labels": {
          "method": "GET",
          "route": "/api/users",
          "status": "200"
        },
        "value": 42
      }
    ]
  }
}
```

### GET /metrics/json
Alternative endpoint for JSON format.

### GET /metrics/health
Returns basic health status (unprotected).

**Example Response**:
```json
{
  "status": "ok",
  "timestamp": "2024-02-25T10:30:00.000Z",
  "uptime": 3600
}
```

## Security & Access Control

The `/metrics` endpoint is protected by IP allowlist and/or JWT authentication to prevent unauthorized access.

### Configuration

#### Option 1: IP Allowlist (Recommended)

Set the `METRICS_ALLOWED_IPS` environment variable:

```bash
# Single IP
METRICS_ALLOWED_IPS=127.0.0.1

# Multiple IPs
METRICS_ALLOWED_IPS=127.0.0.1,192.168.1.10,10.0.0.5

# CIDR notation (IPv4)
METRICS_ALLOWED_IPS=127.0.0.1,192.168.1.0/24,10.0.0.0/8

# IPv6
METRICS_ALLOWED_IPS=::1,2001:db8::/32
```

**Example `.env` file**:
```env
# For local development
METRICS_ALLOWED_IPS=127.0.0.1,::1

# For production with Prometheus on specific IPs
METRICS_ALLOWED_IPS=10.0.1.50,10.0.1.51
```

#### Option 2: JWT Authentication

If `METRICS_ALLOWED_IPS` is not set, JWT authentication is required:

```bash
curl -H "Authorization: Bearer <jwt_token>" http://localhost:3000/metrics
```

### Access Examples

**From localhost**:
```bash
curl http://localhost:3000/metrics
```

**From remote server with IP allowlist**:
```bash
curl http://backend-server:3000/metrics
```

**With JWT authentication**:
```bash
curl -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..." http://backend-server:3000/metrics
```

## Integration with Monitoring Tools

### Prometheus Integration

#### 1. Installation

Prometheus is typically run as a separate service. See [Prometheus Getting Started](https://prometheus.io/docs/prometheus/latest/getting_started/)

#### 2. Configuration

Add the backend as a scrape target in `prometheus.yml`:

```yaml
global:
  scrape_interval: 15s
  scrape_timeout: 10s

scrape_configs:
  - job_name: 'lumenpulse-backend'
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: '/metrics'
    # If using IP allowlist, configure Prometheus IP as allowed
    # If using JWT, you'll need custom authentication setup
```

#### 3. Docker Compose Example

```yaml
version: '3.8'

services:
  backend:
    image: lumenpulse-backend:latest
    ports:
      - "3000:3000"
    environment:
      # Allow Prometheus service to access metrics
      METRICS_ALLOWED_IPS: "127.0.0.1,prometheus:9090"

  prometheus:
    image: prom/prometheus:latest
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
```

Run with: `docker-compose up -d`

#### 4. Verify Metrics Collection

- Access Prometheus UI: http://localhost:9090
- In the Graph page, search for `http_requests_total`
- Execute a query to see metrics

### Grafana Integration

#### 1. Installation

```bash
# Using Docker
docker run -d -p 3000:3000 grafana/grafana:latest
```

#### 2. Add Prometheus Data Source

1. Open Grafana: http://localhost:3000 (default login: admin/admin)
2. Go to **Configuration** → **Data Sources**
3. Click **Add data source** and select **Prometheus**
4. Set URL: `http://prometheus:9090`
5. Click **Save & Test**

#### 3. Create Dashboard

Create a new dashboard with the following panels:

**Panel 1: Request Rate**
```
rate(http_requests_total[5m])
```

**Panel 2: Error Rate**
```
rate(http_errors_total[5m])
```

**Panel 3: P95 Latency**
```
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))
```

**Panel 4: Total Requests**
```
http_requests_total
```

**Panel 5: Error Count**
```
http_errors_total
```

### Hosting Provider Dashboards

#### AWS CloudWatch

If running on AWS, you can integrate with CloudWatch:

1. Use AWS Lambda extension or EC2 agent to push metrics
2. Create custom metrics from the Prometheus endpoint
3. Build CloudWatch dashboards

#### DigitalOcean Monitoring

1. Use DigitalOcean App Platform's metrics integration
2. Configure monitoring alerts based on metric thresholds

#### Azure Monitor

1. Deploy Prometheus using Azure Container Instances
2. Create alerts based on metric rules

## PromQL Query Examples

Common queries for monitoring:

```promql
# Request rate (requests per second)
rate(http_requests_total[5m])

# Error rate (%)
100 * (rate(http_errors_total[5m]) / rate(http_requests_total[5m]))

# P95 latency
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))

# P99 latency
histogram_quantile(0.99, rate(http_request_duration_seconds_bucket[5m]))

# Requests by status
http_requests_total by (status)

# Failed requests by path
http_errors_total by (route)

# Average response time
rate(http_request_duration_seconds_sum[5m]) / rate(http_request_duration_seconds_count[5m])

# Queue size
job_queue_size

# Job failure rate
rate(jobs_failed_total[5m])
```

## Alerting Setup

### Prometheus Alerts

Create `prometheus-rules.yml`:

```yaml
groups:
  - name: lumenpulse_alerts
    rules:
      - alert: HighErrorRate
        expr: |
          (rate(http_errors_total[5m]) / rate(http_requests_total[5m])) > 0.05
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High error rate detected"
          description: "Error rate > 5% for last 5 minutes"

      - alert: HighLatency
        expr: |
          histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High latency detected"
          description: "P95 latency > 1 second"

      - alert: QueueBacklog
        expr: job_queue_size > 1000
        for: 10m
        labels:
          severity: critical
        annotations:
          summary: "Job queue backlog"
          description: "Queue size exceeds 1000 jobs"
```

## Performance Considerations

- **Low overhead**: Metrics collection adds <1ms latency per request
- **Memory efficient**: Default metrics use ~10MB of memory
- **Thread-safe**: All metrics operations are thread-safe
- **Sampling buckets**: Histogram uses 10ms to 5s buckets for accurate latency tracking

## Troubleshooting

### Metrics endpoint returns 403 Forbidden

**Solution**: 
1. Check `METRICS_ALLOWED_IPS` environment variable is set
2. Verify your IP address matches the allowlist
3. Or provide valid JWT token in Authorization header

### High cardinality metrics

**Issue**: Too many unique label combinations causing memory bloat

**Solution**:
- The system automatically normalizes routes to prevent this
- Avoid adding high-cardinality labels (user IDs, request IDs)
- Use low-cardinality labels (status, method, route)

### Metrics not appearing

**Solution**:
1. Verify MetricsModule is imported in AppModule
2. Check that requests are being made to the application
3. Verify metrics endpoint is accessible: `curl http://localhost:3000/metrics`
4. Check application logs for any errors

## Custom Metrics

Applications can register custom metrics:

```typescript
// In any service
import { MetricsService } from './metrics/metrics.service';

@Injectable()
export class MyService {
  constructor(private metricsService: MetricsService) {
    // Create custom gauge
    const customGauge = this.metricsService.getOrCreateGauge(
      'my_custom_queue_size',
      'Size of my custom queue',
      ['queue_name']
    );
    
    // Use the gauge
    customGauge.labels('priority-queue').set(42);
    
    // Create custom counter
    const customCounter = this.metricsService.getOrCreateCounter(
      'my_custom_events',
      'Custom events processed',
      ['event_type']
    );
    
    // Use the counter
    customCounter.labels('user-signup').inc();
  }
}
```

## API Documentation

See the interactive API documentation at `/api/docs` (Swagger UI) for live endpoint testing.

## References

- [Prometheus Documentation](https://prometheus.io/docs/)
- [Grafana Documentation](https://grafana.com/docs/)
- [prom-client Library](https://github.com/siimon/prom-client)
- [PromQL Query Language](https://prometheus.io/docs/prometheus/latest/querying/basics/)

## Contributing

To add new metrics:

1. Extend `MetricsService` with new metric definitions
2. Use the appropriate metric type (Counter, Gauge, Histogram, Summary)
3. Add documentation for new metrics
4. Include example PromQL queries
5. Test with Prometheus scraping

## License

Part of LumenPulse project - see main LICENSE file
