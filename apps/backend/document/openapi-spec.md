# Committed OpenAPI Specification

## Artifact path

The full OpenAPI 3 document for the backend is committed at:

```
apps/backend/openapi/openapi.json
```

Any tool that needs a static description of the API — most notably the
webapp's client/type generation script — should read the spec from this
path rather than fetching it from a running server. This keeps client
generation reproducible in CI and in local builds that don't have a backend
process running.

## Regenerating the spec

The spec is produced from the same `DocumentBuilder` config the running
server uses to serve `/api/docs` (see `src/bootstrap/swagger.config.ts`), so
it always matches what `SwaggerModule` would emit at runtime.

```bash
cd apps/backend
npm run openapi:generate
```

This boots the full Nest application (without calling `app.listen`), builds
the document via `SwaggerModule.createDocument`, and writes it to
`openapi/openapi.json`. Because it boots the real DI graph, it needs a
reachable Postgres and Redis — see the root `docker-compose.yml` for the
expected local services, or rely on the CI service containers described
below.

Whenever a controller, DTO, or the Swagger config changes, regenerate and
commit the updated `openapi/openapi.json` alongside the code change.

## CI freshness check

`.github/workflows/backend.yml` runs `npm run openapi:check` after the build
step. That script regenerates the spec and then runs
`git diff --exit-code -- openapi/openapi.json`, so CI fails whenever the
committed artifact is stale relative to the code that produced it. The job
provisions ephemeral Postgres and Redis service containers (matching the
credentials in `test/setup-env.ts`) so the app can boot far enough to build
the document.

## Authentication schemes described in the spec

| Scheme | Type | Used by |
|---|---|---|
| `JWT-auth` | HTTP bearer (`Authorization: Bearer <token>`) | Most authenticated user/admin endpoints (`@ApiBearerAuth('JWT-auth')`) |
| `soroban-ingest-secret` | API key header `x-ingest-secret` | Soroban event ingestion (`POST /soroban-events/ingest`) |
| `webhook-signature` | API key header `x-webhook-signature` | Inbound webhook delivery verification |

Additionally, every mutating endpoint (`POST`/`PUT`/`PATCH`/`DELETE`)
documents the optional `Idempotency-Key` request header handled globally by
`IdempotencyInterceptor`, along with the `409` (duplicate request in
flight) and `422` (key reused with a different body) responses it can
produce. See `src/common/decorators/api-idempotency.decorator.ts`.
