# ADR-0001: Monorepo layout

- Status: Accepted
- Date: 2026-08-25

## Context

The platform spans web application code, backend APIs, data-processing workflows, and on-chain Soroban contracts. These systems have overlapping tooling, shared environment conventions, and occasional cross-cutting concerns, but they also evolve at different speeds and with different technology constraints.

A single repository was needed to keep product, backend, and contract work aligned without forcing every team to ship from isolated repositories. At the same time, the codebase needed clear boundaries so backend, Python services, and on-chain contracts could be versioned and tested independently.

## Options considered

1. Single application repository with everything mixed together.
   - Pros: simplest setup and shared tooling.
   - Cons: high coupling, poor isolation, slower CI, and unclear ownership boundaries between application layers.

2. Separate repositories for each domain.
   - Pros: strong isolation and independent releases.
   - Cons: duplicated config, slower cross-domain changes, harder contract-to-backend coordination, and less visibility into the full system.

3. Monorepo with workspaces and toolchain boundaries.
   - Pros: shared root tooling, reuse of common scripts, independent package execution, and a single place to reason about the full platform.
   - Cons: requires stronger conventions around dependency boundaries and repo hygiene.

## Decision

We use a monorepo rooted at the repository, with package boundaries enforced by `pnpm` workspaces and TurboRepo for JavaScript/TypeScript areas, while contract and Python code remain as explicit workspace or service boundaries rather than ad hoc script folders.

The monorepo is the default unit of delivery, but each product area still has its own build, test, and deployment workflow. This keeps the repo cohesive without collapsing distinct runtime concerns into a single deployable unit.

## Consequences

- We get a single source of truth for the platform, which lowers onboarding and review friction.
- Changes that span multiple areas are easier to coordinate because code, docs, and config live in one repository.
- CI and local execution must be organized carefully to avoid cross-service coupling and accidental dependency drift.
- Contributors must respect workspace boundaries; infrastructure changes may affect multiple packages and require broader validation.

## Related implementation summaries

- [README.md](../../README.md)
- [apps/backend/IMPLEMENTATION_SUMMARY.md](../../apps/backend/IMPLEMENTATION_SUMMARY.md)
- [apps/onchain/IMPLEMENTATION_SUMMARY.md](../../apps/onchain/IMPLEMENTATION_SUMMARY.md)
