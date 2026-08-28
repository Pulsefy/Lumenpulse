# Backend Contribution Guide

This guide covers app-specific standards for `apps/backend`. The backend integrates with Stellar/Soroban. For migration details, see [Stellar Migration Notes](STELLAR_MIGRATION_NOTES.md). For the committed OpenAPI spec artifact and how to regenerate it, see [OpenAPI Spec](../apps/backend/document/openapi-spec.md).

## Setup

```bash
cd apps/backend
npm install
```

## Daily Commands

```bash
# Lint and auto-fix
npm run lint

# Unit tests
npm run test

# E2E tests
npm run test:e2e

# Run in watch mode
npm run start:dev

# Regenerate the committed OpenAPI spec after changing controllers/DTOs
npm run openapi:generate
```

## Standards

- Follow NestJS module boundaries and keep business logic in services.
- Validate DTOs and keep API contracts explicit.
- Add tests for behavior changes and bug fixes.
- Keep migrations and schema-related changes coordinated.

## Done for Backend Changes

- `npm run lint` passes.
- `npm run test` passes (and `npm run test:e2e` when endpoints change).
- API-facing changes include DTO/docs updates.
- Relevant docs are updated.
- Security-facing API changes keep the standardized error contract aligned with `{ code, message, details, requestId }`.
- Public endpoint changes document any rate-limit env vars and include throttling or validation coverage when behavior changes.

## Schema Snapshotting

To prevent accidental breaking changes to client-facing APIs, we use schema snapshotting. This ensures any changes to DTOs or endpoint paths are explicitly reviewed.

- **Purpose**: Detect unintentional API contract drift during PRs.
- **Run Locally**: Run `npm run test` inside `apps/backend`. It will fail with a diff if the schema changed.
- **Intentional Updates**: If the API change is deliberate, update the snapshot by running `npm run test -- -u` inside `apps/backend` and commit the modified `.snap` file.
- **Coverage**: Currently covers the `users` route group (`apps/backend/src/users/users-schema.spec.ts`).
- **Extending Coverage**: To cover a new module, create a `<module>-schema.spec.ts` test that isolates the module's controller and snapshots its OpenAPI document, following the pattern in `users-schema.spec.ts`.
- Controller/DTO changes include a regenerated `apps/backend/openapi/openapi.json` (`npm run openapi:generate`) — CI fails if it's stale.
