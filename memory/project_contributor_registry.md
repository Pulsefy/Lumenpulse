---
name: project-contributor-registry
description: Backend contributor registry API — NestJS module wrapping the Soroban contributor_registry contract with mock + real paths, caching, and gasless registration
metadata:
  type: project
---

Added `apps/backend/src/contributor-registry/` module implementing the contributor registry backend API.

**Files created:**
- `dto/contributor-registry.dto.ts` — all request/response DTOs
- `contributor-registry.service.ts` — service with mock (in-memory Map) and real (SorobanRpcClientService) paths
- `contributor-registry.controller.ts` — HTTP routes
- `contributor-registry.module.ts` — NestJS module (imports AppCacheModule + StellarModule)

**Files modified:**
- `app.module.ts` — registered ContributorRegistryModule
- `common/rate-limit/rate-limit.config.ts` — added `getRegistryReadThrottleOverride()` (delegates to crowdfundRead) and `getRegistryWriteThrottleOverride()` (delegates to portfolioWrite)

**Routes:**
- `POST /contributor-registry/register` — direct registration; mock stores immediately, real returns unsigned XDR for client signing
- `POST /contributor-registry/register-with-sig` — gasless registration; server as relayer attaches client's signed SorobanAuthorizationEntry and submits
- `GET /contributor-registry/wallet/:address` — lookup by Stellar address (60s cache)
- `GET /contributor-registry/github/:handle` — lookup by GitHub handle (60s cache)
- `GET /contributor-registry/reputation/:address` — reputation score + tier (60s cache)
- `GET /contributor-registry/nonce/:address` — registration nonce for off-chain signing (5s cache)

**Why:** Mock mode is gated by `config.featureFlags.useMockTransactions` (env `USE_MOCK_TRANSACTIONS=true` is the default in dev). Real mode uses `STELLAR_CONTRACT_CONTRIBUTOR_REGISTRY` env var for contract ID.

**How to apply:** When working on this module, note that node_modules are not installed locally — `tsc --noEmit` will show pre-existing errors for the whole project, not just these files. The pattern to verify correctness is code review, not compilation.
