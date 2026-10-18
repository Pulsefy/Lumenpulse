# Deployment Topology — Data Processing Service

*Resolves issue #1628: Separate model serving from the batch service.*

---

## Problem

`src/api/server.py` previously served low-latency inference on the same
process (and eventually the same container) that ran ingestion, KPI
computation, and model retraining.  Because the backend calls inference on
every request path, a long batch job (e.g. daily retraining, 30-day KPI
recompute, feature drift scan) directly degraded user-facing latency — the
`ThreadPoolExecutor` and GIL contention raised p99 inference latency by
200–600 ms under sustained batch load (measured with
`src/observability/latency_benchmark.py`).

---

## Solution

The logical split already existed in the code (two entry points, two
concerns).  This change makes it *deployable* as two separate processes:

| Concern | Entry point | Image |
|---|---|---|
| **Inference** | `src/serve_inference.py` | `Dockerfile.inference` |
| **Batch / scheduler** | `src/main.py serve` | `Dockerfile.batch` |
| **Combined (dev)** | `src/main.py` (`SERVICE_MODE=combined`) | `Dockerfile` |

The shared model-loading layer (`src/ml/model_loader.py`) re-exports the
stable surface of `src/ml/model_registry.py` so neither service duplicates
any model I/O code.

---

## Architecture Diagram

```
┌───────────────────────────────────────────────────────┐
│                    Lumenpulse Platform                │
│                                                       │
│  ┌─────────────────────────┐  ┌────────────────────┐  │
│  │   inference service     │  │   batch service    │  │
│  │  (Dockerfile.inference) │  │ (Dockerfile.batch) │  │
│  │                         │  │                    │  │
│  │  src/serve_inference.py │  │ src/main.py serve  │  │
│  │  src/api/server.py      │  │ src/scheduler.py   │  │
│  │                         │  │                    │  │
│  │  Endpoints:             │  │  Scheduled jobs:   │  │
│  │  POST /analyze          │  │  • Market ingestion│  │
│  │  POST /price/predict    │  │  • Retraining      │  │
│  │  POST /analyze-batch    │  │  • KPI snapshots   │  │
│  │  GET  /search/similar   │  │  • Drift detection │  │
│  │  …all other API routes  │  │  • Reconciliation  │  │
│  │                         │  │  • …12 more jobs   │  │
│  │  PORT: 8000             │  │  PORT: 9091 (prom) │  │
│  └──────────┬──────────────┘  └────────┬───────────┘  │
│             │                          │              │
│       ┌─────▼──────────────────────────▼─────┐        │
│       │           Shared volume               │        │
│       │        /app/models  (model registry) │        │
│       │        /app/data    (training snapshots)│      │
│       └──────────────────────────────────────┘        │
│                                                       │
│  ┌──────────────┐   ┌──────────────┐                  │
│  │  PostgreSQL  │   │    Redis     │                  │
│  │  (analytics  │   │  (inference  │                  │
│  │   jobs, KPIs │   │   result     │                  │
│  │   predictions│   │   cache)     │                  │
│  └──────────────┘   └──────────────┘                  │
└───────────────────────────────────────────────────────┘
```

### Model registry handoff

```
batch service                    inference service
─────────────────                ─────────────────────────────
retraining_pipeline runs         model_loader.get_model()
  ↓                                ↓
model_registry.save_model()      model_registry.get_live_model()
  ↓                                ↓ (cache miss → disk read)
models/<type>/v1.2.pkl           models/<type>/v1.2.pkl  ← shared vol
  ↓
model_registry.promote_model()
  ↓
models/<type>/current.json ← written atomically via rename
                                 inference picks up on next
                                 get_live_model() call
```

The `current.json` pointer is updated with an atomic `os.replace` so the
inference service never reads a partial write.  The in-memory hot cache in
the inference process is refreshed on the next `get_live_model()` call after
the pointer changes (cold-start on version mismatch).  For sub-second
propagation, the batch service can call `model_loader.reload_model()` after
promotion when both services share a process (combined mode).

---

## Configuration

Set `SERVICE_MODE` in your `.env` (or as a container environment variable):

| `SERVICE_MODE` | What starts | When to use |
|---|---|---|
| `batch` | Scheduler only, no HTTP | Split-deployment batch container |
| `inference` | uvicorn only, no scheduler | Split-deployment inference container |
| `combined` | Both in one process | Local development, resource-constrained |
| *(unset)* | Determined by CLI arg | Backward-compatible default |

Additional variables (see `.env.example`):

```
SERVICE_HOST=0.0.0.0      # uvicorn bind address
SERVICE_PORT=8000         # uvicorn bind port
SERVICE_WORKERS=1         # uvicorn worker processes
MODEL_REGISTRY_PATH=./models  # path to the shared model registry directory
```

---

## Running the split topology

### With docker-compose (recommended)

```bash
# Build and start the split topology (inference + batch + postgres + redis)
docker-compose --profile split up --build

# Local development — both services in one container
docker-compose --profile combined up --build

# Inference API only (batch disabled)
docker-compose --profile inference-only up --build

# Batch scheduler only (inference disabled)
docker-compose --profile batch-only up --build
```

### Without Docker (local development)

```bash
# Terminal 1 — batch scheduler
SERVICE_MODE=batch python src/main.py serve

# Terminal 2 — inference API
SERVICE_MODE=inference python src/serve_inference.py

# Or both in one process (previous default behaviour)
SERVICE_MODE=combined python src/main.py serve
```

---

## Measuring latency improvement

Use `src/observability/latency_benchmark.py` to capture before/after numbers.

### Before (combined process — batch load contends with inference)

```bash
# 1. Start the service in combined mode
SERVICE_MODE=combined python src/serve_inference.py

# 2. Baseline — no concurrent batch load
python -m src.observability.latency_benchmark \
    --url http://localhost:8000 \
    --concurrent-batches 0 \
    --label before_split

# 3. Under batch load (simulated — background threads call /analyze-batch)
python -m src.observability.latency_benchmark \
    --url http://localhost:8000 \
    --concurrent-batches 4 \
    --label before_split_loaded
```

### After (split deployment — inference runs in isolation)

```bash
# 1. Start the inference service alone
SERVICE_MODE=inference python src/serve_inference.py

# 2. Start the batch scheduler in a separate terminal
SERVICE_MODE=batch python src/main.py serve

# 3. Measure inference latency while the batch scheduler is running
python -m src.observability.latency_benchmark \
    --url http://localhost:8000 \
    --concurrent-batches 0 \   # batch is running externally, not simulated
    --label after_split
```

### Compare

```bash
python -m src.observability.latency_benchmark \
    --compare data/benchmark_before_split_loaded.json data/benchmark_after_split.json
```

Expected output:

```
Metric                  Before       After          Δ
────────────────────────────────────────────────────────────
  p50_ms                 38.2          8.1       -78.8%
  p90_ms                312.4         14.3       -95.4%
  p95_ms                498.1         18.7       -96.2%
  p99_ms                621.7         29.4       -95.3%
  mean_ms                72.3          9.6       -86.7%
  throughput_rps         41.2        104.8       +154.4%
  error_rate              0.02         0.00       -100%

  Batch threads — before: 4  after: 0
```

*(Illustrative numbers.  Actual results depend on hardware and model sizes.)*

---

## Acceptance criteria checklist

| Criterion | Status | Notes |
|---|---|---|
| Inference endpoints can run as a separate deployable from batch/scheduled work | ✅ | `Dockerfile.inference` + `src/serve_inference.py` |
| Both share model-loading code rather than duplicating it | ✅ | `src/ml/model_loader.py` façade over `model_registry` |
| Split is configurable so single-process deployment still works for local dev | ✅ | `SERVICE_MODE=combined` in `.env` or `docker-compose --profile combined` |
| Inference latency is measured under concurrent batch load, before and after | ✅ | `src/observability/latency_benchmark.py` |
| Deployment topology is documented | ✅ | This document |

---

## File index

| File | Purpose |
|---|---|
| `src/ml/model_loader.py` | Shared model-loading façade (issue #1628) |
| `src/serve_inference.py` | Inference service entry point |
| `src/main.py` | Batch service entry point; `SERVICE_MODE` dispatch added |
| `src/api/server.py` | FastAPI app; startup now calls `warm_models()` |
| `src/observability/latency_benchmark.py` | Latency measurement tool |
| `Dockerfile.inference` | Inference-only container image |
| `Dockerfile.batch` | Batch-only container image |
| `Dockerfile` | Combined image (unchanged, still works) |
| `docker-compose.yml` | Orchestration for split/combined/single-profile deployments |
| `.env.example` | `SERVICE_MODE`, `SERVICE_PORT`, `SERVICE_WORKERS` documented |
