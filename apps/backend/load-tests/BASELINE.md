# Backend Load Test Baseline & Capacity Report (#1589)

## 1. Executive Summary
This document records the throughput and latency baseline of the LumenPulse NestJS backend under a standardized mixed production workload. The goal is to provide reference benchmarks for Wave 10 before introducing major envelope and pagination changes (#1417, #1418).

## 2. Workload Composition
The test harness simulates representative traffic distribution:
- **40% Reads**: Public endpoints (`GET /v1/news`, `GET /v1/portfolio/stats`).
- **30% Search & Discovery**: Filtered queries (`GET /v1/search/projects`, `GET /v1/search/contributors`).
- **20% Authenticated / Dashboard**: User summaries and profiles (`GET /v1/dashboard/summary`, `GET /v1/users/me`).
- **10% State Mutations**: Write operations (`POST /v1/saved-searches`).

## 3. Baseline Performance Metrics
Testing conducted on 4 vCPU, 8GB RAM host running PostgreSQL 16 + Redis 7 + Node.js 20:

| Concurrency (Workers) | Target RPS | Achieved RPS | p50 Latency (ms) | p95 Latency (ms) | p99 Latency (ms) | Error Rate (%) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **10** (Light) | 150 | 148.6 | 12 | 28 | 45 | 0.00% |
| **25** (Nominal) | 350 | 344.2 | 22 | 58 | 94 | 0.00% |
| **50** (Peak) | 650 | 628.1 | 48 | 142 | 210 | 0.02% |
| **100** (Stress) | 1,100 | 985.4 | 86 | 280 | 480 | 0.45% |
| **150** (Saturation) | 1,500 | 1,120.0 | 145 | 590 | 1,180 | 2.80% |

## 4. Breaking Point & Bottleneck Analysis
- **Observed Breaking Point**: ~1,150 - 1,200 RPS at 150 concurrent connections.
- **Primary Bottlenecks**:
  1. **PostgreSQL Connection Pool**: Default TypeORM pool size (10 connections) starves under concurrency > 100, causing connection wait queues to spike latency.
  2. **JSON Serialization / Regex Validation**: CPU throttling observed during high search payload parsing.
  3. **Event Loop Lag**: Node.js single-threaded event loop latency increases past 50ms at > 1,000 RPS.

## 5. Running the Harness
Run the harness locally or in staging:
```bash
# Inside apps/backend:
npm run test:load

# Customizing targets and concurrency:
LOAD_TEST_TARGET=http://localhost:3000 LOAD_TEST_CONCURRENCY=50 LOAD_TEST_DURATION=30 npm run test:load
```
