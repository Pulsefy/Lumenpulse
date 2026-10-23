# Local stack: clone to working service

One command starts the data-processing service with everything it depends on:
Postgres, Redis, the database schema, seeded sentiment labels and a trained,
promoted model set. No external API keys are needed to serve requests.

## Prerequisites

- Docker with Compose v2 (`docker compose version`)
- Internet access for the first build (it downloads the FinBERT, NER and
  embedding model weights, so expect several minutes)
- Port 8000 free (or set `SERVICE_PORT`)

## Run it

```bash
git clone https://github.com/Pulsefy/Lumenpulse.git
cd Lumenpulse/apps/data-processing
docker compose -f docker-compose.local.yml up -d --build
```

`up` blocks until the one-shot `bootstrap` service has finished, then starts
the API on `http://localhost:8000`.

## Smoke test

```bash
python scripts/local_smoke.py
# or, without a local Python:
docker compose -f docker-compose.local.yml run --rm smoke
```

The script waits for `GET /health`, then sends an authenticated request and
checks that the text was scored:

```bash
curl -s -X POST http://localhost:8000/analyze \
  -H "Content-Type: application/json" -H "X-API-Key: local-dev-key" \
  -d '{"text": "Stellar adoption is growing and investors feel bullish and optimistic"}'
```

A passing run ends with `Smoke test passed.` (exit code 0).

## Stop / reset

```bash
docker compose -f docker-compose.local.yml down      # stop, keep data
docker compose -f docker-compose.local.yml down -v   # stop and wipe volumes
```

## What gets provisioned

| Piece | How |
| --- | --- |
| Postgres, Redis | Compose services with healthchecks |
| Schema + seed data (sentiment labels, sample analytics records) | `scripts/bootstrap_local.py` |
| Models | Bootstrap trains and promotes `sentiment` and `price_predictor` (seed `BOOTSTRAP_MODEL_SEED`, default 42) when the registry has none; reruns skip this |
| NER / embedding / FinBERT weights | Baked into the image by `Dockerfile.inference` |

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `API_KEY` | `local-dev-key` | Value for the `X-API-Key` header |
| `SERVICE_PORT` | `8000` | Host port (bound to `127.0.0.1`) |
| `LOG_LEVEL` | `info` | Service log level |

Ingestion (the batch scheduler) needs real provider keys such as
`COINGECKO_API_KEY`; it is not part of this stack. Use the profiles in
`docker-compose.yml` for that.

## Use in CI

```yaml
- name: Start local stack
  working-directory: apps/data-processing
  run: docker compose -f docker-compose.local.yml up -d --build
- name: Smoke test
  working-directory: apps/data-processing
  run: docker compose -f docker-compose.local.yml run --rm smoke
- name: Logs on failure
  if: failure()
  working-directory: apps/data-processing
  run: docker compose -f docker-compose.local.yml logs
- name: Tear down
  if: always()
  working-directory: apps/data-processing
  run: docker compose -f docker-compose.local.yml down -v
```

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `port is already allocated` | `SERVICE_PORT=8001 docker compose ... up -d`, then `python scripts/local_smoke.py --url http://localhost:8001` |
| Smoke returns 401/403 | `API_KEY` differs between the stack and the smoke run; unset it or export the same value |
| `up` exits with `bootstrap` failed | `docker compose -f docker-compose.local.yml logs bootstrap` |
| Stale state after a failed run | `docker compose -f docker-compose.local.yml down -v`, then `up` again |
