# Local stack

The full Lumenpulse stack in one command. This is the Docker path;
[LOCAL_SETUP.md](LOCAL_SETUP.md) covers running each service directly from source.

| | |
|---|---|
| Compose file | [`docker-compose.yml`](../docker-compose.yml) at the repository root |
| Images | [`apps/backend/Dockerfile`](../apps/backend/Dockerfile), [`apps/webapp/Dockerfile`](../apps/webapp/Dockerfile), [`apps/data-processing/Dockerfile`](../apps/data-processing/Dockerfile) |

## What comes up

```
                       ┌──────────────┐
  browser :3000 ──────▶│    webapp    │  Next.js, production build
                       └──────┬───────┘
                              │ server-side only, in-network
                              ▼
                       ┌──────────────┐
  :3001 ──────────────▶│   backend    │  NestJS API — 63 controllers, auth, tx signing
                       └──┬────────┬──┘
                          │        │
             PYTHON_API_URL│        │DB_HOST, REDIS_HOST
                          ▼        ▼
              ┌──────────────┐  ┌────────────────┐
              │ data-        │  │ postgres :5433 │
              │ processing   │─▶│ redis    :6379 │
              │ :8000        │  └────────────────┘
              └──────────────┘
```

| Service | Host port | Container port | Profile |
|---|---|---|---|
| webapp | 3000 | 3000 | default |
| backend | 3001 | 3000 | default |
| postgres | 5433 | 5432 | default |
| redis | 6379 | 6379 | default |
| data-processing | 8000 | 8000 | default |
| data-processing metrics | 9091 | 9091 | default |
| seed | — | — | `demo` |

Postgres is published on **5433**, not 5432, so it does not collide with a
Postgres already running on your machine.

## Start it

```bash
docker compose up -d --build
```

Then watch the health columns rather than guessing at timings:

```bash
docker compose ps
```

Every service should reach `healthy`. The first build is slow — the backend and
webapp install their dependency trees, and the data-processing image downloads
the CPU-only torch wheel and bakes the pinned FinBERT weights.

### Smoke test

```bash
curl -s localhost:3001/health | jq
```

A minimal, dependency-free check if you would rather not parse JSON:

```bash
curl -fsS localhost:3001/health/live   # liveness — always 200 once bound
curl -fsS localhost:3001/health        # readiness — checks every dependency
```

`/health/live` returns as soon as the HTTP server is bound. `/health` additionally
probes Postgres, Redis, Horizon, Soroban RPC and data-processing, and returns
`503` if a critical one is down. `200` from `/health` is the real "the stack
works" signal.

Then, in a browser:

- <http://localhost:3000> — the webapp
- <http://localhost:3001/api/docs> — Swagger UI for all 63 controllers

### Stop it

```bash
docker compose down          # stop, keep the database
docker compose down -v       # stop and delete the database volume
```

`down -v` destroys the volume. There is no backup.

---

## How the ordering works

Nothing in this file uses `sleep`. Every application service waits on a **health
check**, not on a container having started:

```yaml
backend:
  depends_on:
    postgres:
      condition: service_healthy
    redis:
      condition: service_healthy
    migrate:
      condition: service_completed_successfully   # not service_healthy
    data-processing:
      condition: service_healthy
```

`service_completed_successfully` is the important one. `migrate` is a one-shot
job: it applies every migration and exits. Waiting for it to have *succeeded* —
rather than merely to have started — is what stops the API booting against a
half-migrated schema.

### Re-running migrations after pulling new ones

A completed one-shot container is not recreated by `docker compose up`, so a new
migration added on `main` will not be applied by the next `up`. Run it
explicitly:

```bash
docker compose run --rm migrate
docker compose restart backend
```

Or force a full pass:

```bash
docker compose up -d --force-recreate migrate backend
```

---

## Configuration

Everything is read from the environment, with working defaults for local
development. To override, put the variables in a `.env` next to
`docker-compose.yml` — Compose reads it automatically.

| Variable | Default | Notes |
|---|---|---|
| `WEBAPP_HOST_PORT` | `3000` | Where the browser reaches the webapp |
| `BACKEND_HOST_PORT` | `3001` | Matches `apps/webapp/.env.local.example` |
| `POSTGRES_PORT` | `5433` | Container listens on 5432 |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `lumenpulse` | |
| `JWT_SECRET` | dev placeholder | **Change it.** Anything set here signs tokens. |
| `STELLAR_SERVER_SECRET` | testnet dev key | Testnet only. Never put a mainnet key here. |
| `STELLAR_NETWORK` | `testnet` | |
| `NODE_ENV` / `ENVIRONMENT` | `development` / `local` | `production` switches on the CORS and `PYTHON_API_URL` requirements in `config.ts` |
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001` | **Build-time.** Changing it needs `docker compose build webapp` |
| `BACKEND_API_URL` | `http://backend:3000` | Runtime, server-side only |
| `SERVICE_MODE` | `combined` | Inference API + batch scheduler in one process |
| `RUN_IMMEDIATELY` | `false` | Run the pipeline once at startup |
| `BOOTSTRAP_DEMO_DATA_ENABLED` | `false` | Required by the `demo` profile |
| `DEMO_SEED_ADMIN_JWT` | — | Required by the `demo` profile |

### Build-time versus runtime in the webapp

Next.js inlines every `NEXT_PUBLIC_*` value into the JavaScript bundle during
`next build`. After that, setting the variable on a running container does
nothing — the value is already baked into the bytes the browser downloads.

```bash
# Wrong: reads the new value, serves the old bundle.
NEXT_PUBLIC_API_URL=https://api.example.com docker compose up -d webapp

# Right: rebuilds the bundle with the new value.
NEXT_PUBLIC_API_URL=https://api.example.com docker compose up -d --build webapp
```

`BACKEND_API_URL` is the opposite: read at request time by server components and
API routes, so it can be changed with a plain restart. It points at the
in-network hostname `http://backend:3000` because the browser never sees it —
that name only resolves inside the compose network.

---

## Images

### Backend

Multi-stage. `builder` installs dev dependencies and compiles TypeScript;
`runtime` copies the compiled `dist/` and a production-only `node_modules`, so
the TypeScript compiler, Jest and ESLint never reach the shipped image. Runs as
uid 10001 with `tini` as PID 1, so `docker stop` drains in-flight requests
instead of severing them.

A third stage, `migrate`, exists because the migration toolchain is a
devDependency (`migration:run` shells out to `typeorm-ts-node-commonjs`, which
needs `typeorm`, `ts-node` and `tsconfig-paths`). Rather than ship those three
packages inside the long-running service image, the one-shot migration job builds
from the builder stage and exits. Nothing serves traffic from it.

Build and run it alone:

```bash
docker build -f apps/backend/Dockerfile -t lumenpulse-backend apps/backend
docker run --rm -p 3000:3000 \
  -e DB_HOST=host.docker.internal -e DB_USERNAME=lumenpulse \
  -e DB_PASSWORD=lumenpulse -e DB_DATABASE=lumenpulse \
  -e JWT_SECRET=dev -e STELLAR_SERVER_SECRET=SB6RIPM3GJQ7RP3Q6R5F3QIBYZHP4N27SGGCQ3R4LWA2ZKXZWQ3NU3G4 \
  lumenpulse-backend
```

### Webapp

Multi-stage. The builder installs all dependencies and runs `next build`; the
runtime stage installs `--omit=dev` and copies `.next`, `public/` and
`next.config.js`. Runs as uid 10001 on port 3000.

```bash
docker build -f apps/webapp/Dockerfile -t lumenpulse-webapp apps/webapp
docker run --rm -p 3000:3000 -e BACKEND_API_URL=http://host.docker.internal:3001 lumenpulse-webapp
```

### Measuring size and cold start

Both are recorded in the pull requests that introduced these images. To
re-measure after a dependency bump:

```bash
# Image size
docker images --format '{{.Repository}}:{{.Tag}}\t{{.Size}}' | grep lumenpulse

# Cold start: time from `docker run` to the first successful /health response.
# Warm it first so the measurement is container start-up, not image pull.
docker compose build
docker compose up -d
docker compose restart backend webapp

for svc in backend webapp; do
  port=$([ "$svc" = backend ] && echo 3001 || echo 3000)
  path=$([ "$svc" = backend ] && echo /health/live || echo /manifest.json)
  start=$(date +%s%N)
  until curl -fsS "localhost:$port$path" > /dev/null 2>&1; do sleep 0.1; done
  end=$(date +%s%N)
  echo "$svc: $(( (end - start) / 1000000 )) ms"
done
```

Measure on an otherwise idle machine. The first measurement after a build
includes lazy page compilation for the webapp, which is why the run above
restarts the containers first.

---

## Demo data

The backend has no seeding CLI. `POST /v1/demo-bootstrap/seed` is an
admin-guarded endpoint that only runs when `BOOTSTRAP_DEMO_DATA_ENABLED=true`
and `STELLAR_NETWORK=testnet`, so it needs a real admin JWT — which no compose
configuration can mint for you.

```bash
BOOTSTRAP_DEMO_DATA_ENABLED=true \
DEMO_SEED_ADMIN_JWT=<admin token> \
  docker compose --profile demo up -d
```

It sits behind the `demo` profile so the default stack never fails on a missing
token. The seeding call is safe to repeat; it resets first by default.

---

## Using this stack from CI

The same file works for an integration job — it needs no host-specific state:

```yaml
- run: docker compose up -d --build --wait
  working-directory: .
- run: |
    for i in $(seq 1 60); do
      curl -fsS localhost:3001/health && break
      sleep 5
    done
- run: docker compose logs --no-color backend
  if: failure()
```

`--wait` blocks until every service with a health check reports healthy, which
removes the sleep-and-hope step. Note the one-shot `migrate` service: `--wait`
waits for health, not for completion, so poll `/health` rather than assuming the
schema is ready when the containers are up.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `backend` never leaves `created` | `migrate` failed | `docker compose logs migrate` — usually a `DB_*` mismatch |
| New migration not applied | one-shot container already exited | `docker compose run --rm migrate` then `docker compose restart backend` |
| Backend exits at boot | required env var missing | `config.ts` throws at import time; `docker compose logs backend` names the variable |
| `data-processing` never healthy | pinned models missing or still downloading | `docker compose logs data-processing`; the first build fetches FinBERT weights |
| Webapp shows no data | `NEXT_PUBLIC_API_URL` points at the in-network hostname | it must be the **host** address, `http://localhost:3001` |
| Port already in use | another service holds 3000/3001/5433/6379 | set the matching `*_HOST_PORT` variable in `.env` |

## See also

- [LOCAL_SETUP.md](LOCAL_SETUP.md) — running the services from source, no Docker
- [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md) — the full variable reference
- [ci-timeouts.md](ci-timeouts.md) — CI budgets for the workflows this stack feeds