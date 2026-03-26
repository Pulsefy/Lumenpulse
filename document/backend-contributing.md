# Backend Contribution Guide

This guide covers app-specific standards for `apps/backend`.

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
