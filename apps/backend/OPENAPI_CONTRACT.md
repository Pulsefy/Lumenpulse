# OpenAPI Contract

The backend's HTTP contract is committed as a generated artifact:

```
apps/backend/openapi.json
```

This file is the single source of truth for client code generation (the webapp's
`npm run generate:api-types` reads it from `../backend/openapi.json`) and for
external integrators. Do not edit it by hand.

## Commands (run in `apps/backend`)

| Command | What it does |
| --- | --- |
| `npm run build` | `nest build`, then regenerates `openapi.json`. |
| `npm run openapi:generate` | Regenerates `openapi.json` from the last build in `dist/`. |
| `npm run openapi:check` | Exits non-zero if `openapi.json` differs from what the current `dist/` would produce. |
| `npm run openapi:baseline` | Rewrites `openapi-lint-baseline.json` after you fix documentation gaps. |

Generation doesn't need a database, Redis or Stellar RPC. The generator
(`scripts/generate-openapi.ts`) scans the module and controller graph without
instantiating providers, and uses fixed placeholder env values
(`scripts/openapi-env.ts`), so a local `.env` never changes the output.

It runs from `dist/` because DTO schemas come from the `@nestjs/swagger`
compiler plugin (configured in `nest-cli.json`), and that plugin only runs
inside `nest build`.

## CI

`.github/workflows/backend.yml` runs `npm run build` and then:

1. **Fails if `openapi.json` changed**, which means the committed spec is stale
   relative to the code. To fix it, run `npm run build` locally and commit
   `openapi.json`.
2. **Fails if the webapp's generated types are stale**
   (`apps/webapp/scripts/generate-api-types.mjs --check`). To fix it, run
   `npm run generate:api-types` in `apps/webapp` and commit `generated/`.

The build also fails if the lint (`src/openapi/openapi.lint.ts`) finds a problem.

### Security (always enforced)

Every operation must declare exactly the security its guards enforce.
`src/openapi/route-guards.ts` collects the guards for each route from
`@UseGuards` on the controller and handler, plus every global guard
registered with `APP_GUARD`. The lint then rejects:

- a route guarded by `JwtAuthGuard`, `RolesGuard` or `ContractAdminGuard` that
  doesn't declare `JWT-auth`; by `ContractAdminTrustedCallerGuard` that doesn't
  declare `api-key`; or by `WebhookVerificationGuard` or
  `SorobanEventIngestionGuard` that doesn't declare `webhook-signature`
- a route whose guards need several schemes but which declares them as
  separate alternatives. `[{JWT-auth}, {api-key}]` means "either", but
  guards need both, so use `@ApiSecurity({ 'JWT-auth': [], 'api-key': [] })`
- a declared scheme that no guard on the route enforces, or a scheme that
  isn't defined (e.g. the `bearer` scheme an unnamed `@ApiBearerAuth()` emits)
- a guard that is in neither `GUARD_SECURITY_SCHEMES` nor
  `NON_CREDENTIAL_GUARDS`. A new auth guard must be classified before it
  can ship.
- a route the controller-graph scan can't find, whose guards therefore can't be
  checked

Register global guards with `{ provide: APP_GUARD, ... }`, not
`app.useGlobalGuards()`, which the scan can't see. `route-guards.spec.ts`
fails if `main.ts` or `app.setup.ts` calls `useGlobalGuards`. The same spec
runs the lint against fixture routes that use the real JWT, API-key and
webhook-signature guards, and against the real `AppModule`.

Two DTO classes that publish the same schema name are also fatal, because
Swagger silently keeps one shape. Rename one with `@ApiSchema({ name })`.

### Documentation (ratcheted)

The lint also rejects operations without `@ApiTags` or an `@ApiOperation`
summary, 2xx responses (other than 204) without a body schema, untyped request
bodies, and component schemas with no properties.

Gaps that already existed when the lint was introduced are listed in
`openapi-lint-baseline.json`. A **new** gap fails the build. When you fix a
baselined gap, the build fails until you remove it with
`npm run openapi:baseline`, so the list only shrinks. Don't add entries by
hand to get past the lint.

Each violation names the route and `Controller_method` to fix.

## What the generator adds automatically

`src/openapi/openapi.document.ts` adds the parts of the contract that come
from global infrastructure rather than individual controllers:

| Concern | Source in code | In the spec |
| --- | --- | --- |
| Error envelope | `GlobalExceptionFilter` | Every 4xx/5xx response uses `#/components/schemas/ErrorResponseDto` (`code`, `message`, `details?`, `requestId`). |
| Standard errors | validation pipe, guards, rate limiter | `400` if the operation takes input, `401`/`403` if it is secured, `404` for path parameters, and `429`/`500` everywhere. |
| Idempotency | `IdempotencyInterceptor` (global) | Optional `Idempotency-Key` header on every `POST`/`PUT`/`PATCH`/`DELETE`, plus `409` (still in progress) and `422` (key reused with a different body). |
| Correlation id | `RequestIdMiddleware` | `X-Request-Id` response header on every response. |

## Security schemes

| Scheme | Transport | Used by |
| --- | --- | --- |
| `JWT-auth` | `Authorization: Bearer <jwt>` | User and admin routes (`@ApiBearerAuth(JWT_SECURITY_SCHEME)`) |
| `api-key` | `X-API-Key: <key>` | Contract admin trusted callers (`@ApiSecurity(API_KEY_SECURITY_SCHEME)`) |
| `webhook-signature` | `X-Webhook-Signature` (+ timestamp/nonce headers per route) | Inbound webhooks and Soroban event ingestion |

Constants live in `src/openapi/openapi.constants.ts`. Import them instead of
using string literals.

## Adding or changing an endpoint

1. Use DTO classes in `*.dto.ts` files for bodies, queries and responses. The
   compiler plugin documents their properties; add `@ApiProperty` for
   descriptions and examples.
2. Add `@ApiTags`, `@ApiOperation({ summary })` and a typed success response
   (`@ApiOkResponse({ type: Dto })`).
3. If the route is guarded, declare the matching security decorator
   (`@ApiBearerAuth(JWT_SECURITY_SCHEME)`, or `@ApiSecurity(...)` for the
   others). If it needs several schemes, put them in one `@ApiSecurity({...})`.
4. Run `npm run build` and commit the updated `openapi.json`. If schemas the
   webapp uses changed, also run `npm run generate:api-types` in `apps/webapp`.

The same document is served at runtime at `/api/docs` (Swagger UI) and
`/api/docs-json`.
