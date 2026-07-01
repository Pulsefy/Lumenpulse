# Feature Flags

Lightweight feature flags for safely enabling new protocol behavior on testnet before promoting to mainnet.

---

## Overview

Feature flags gate experimental or in-progress functionality behind a toggle. Two layers are provided:

| Layer | Purpose | Storage |
|-------|---------|---------|
| **Onchain (Soroban)** | Gate smart-contract logic paths | Contract persistent storage |
| **Backend (NestJS)** | Gate API endpoints and service logic | PostgreSQL (`feature_flags` table) |

---

## Onchain: `feature_flags` Contract

A Soroban contract at `apps/onchain/contracts/feature_flags/` that stores named boolean flags.

### Deterministic defaults

Unregistered flags always evaluate to **`false`** (disabled). Callers never need to check for existence — `is_enabled` returns a deterministic `bool`.

```
is_enabled("unknown_feature")  → false  (always, no error)
```

### Observability

Every `set_flag` call emits a `FlagSetEvent` with:
- `key` (topic) — the flag name
- `enabled` — new state
- `toggled_by` — the caller address

The event is indexed by Soroban and visible in ledger metadata.

### Contract API

| Function | Auth | Description |
|----------|------|-------------|
| `initialize(admin)` | `admin` | One-time init; sets admin address and initializes unpaused |
| `set_flag(caller, key, enabled)` | `admin` | Set a flag's state; emits `FlagSetEvent` |
| `is_enabled(key)` | — | Returns `true`/`false`; `false` for unknown flags |
| `get_flag(key)` | — | Returns `Option<FlagEntry>` with full metadata |
| `list_flags()` | — | Returns all registered flag entries |
| `get_admin()` | — | Returns current admin address |
| `set_admin(current, new)` | `admin` | Transfers admin role |
| `pause(admin)` | `admin` | Pauses flag writes |
| `unpause(admin)` | `admin` | Resumes flag writes |

### Usage from another contract

```rust
use soroban_sdk::Env;
use feature_flags::FeatureFlagsContractClient;

let flags_id = …; // deployed feature_flags contract ID
let flags = FeatureFlagsContractClient::new(&env, &flags_id);
if flags.is_enabled(&symbol_short!("new_vault_logic")) {
    // new code path
} else {
    // existing code path
}
```

### Example: gating a contract method

```rust
pub fn withdraw(env: Env, user: Address, amount: i128) -> Result<(), Error> {
    let flags = FeatureFlagsContractClient::new(&env, &get_flags_id(&env));
    if flags.is_enabled(&symbol_short!("yield_vault_v2")) {
        return Self::withdraw_v2(env, user, amount);
    }
    Self::withdraw_v1(env, user, amount)
}
```

---

## Backend: `FeatureFlagsModule`

A NestJS module at `apps/backend/src/feature-flags/` that provides DB-backed flags with an in-memory cache and a guard for HTTP handlers.

### Deterministic defaults

`isEnabled()` for an unknown key returns **`false`**. Flags are created with `enabled = false` by default.

### Observability

- Every `upsert` call logs the previous and new state via `Logger`.
- The `changedBy` column records who last toggled the flag.
- The `FeatureFlagResponseDto` exposes `changedBy` and timestamps in API responses.

### API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/feature-flags` | List all flags |
| `GET` | `/feature-flags/:key` | Get a single flag's details |
| `GET` | `/feature-flags/check/:key` | Quick check (returns `{ key, enabled }`) |
| `POST` | `/feature-flags` | Create or update a flag |
| `DELETE` | `/feature-flags/:key` | Remove a flag |

### Guard usage

```typescript
@Controller('portfolio')
export class PortfolioController {
  @Get('experimental')
  @FeatureFlag('portfolio.experimental-chart')
  getExperimentalChart() {
    // only accessible when flag is enabled
  }
}
```

Apply the guard globally or per-controller:

```typescript
@UseGuards(FeatureFlagGuard)
@Controller('features')
export class FeaturesController {}
```

---

## Testnet-only Intended Usage

Both layers are designed for **testnet** environments where rapid iteration is expected.

- **Onchain flags:** Deploy the `feature_flags` contract to testnet alongside your contracts. Toggle flags during integration testing without re-deploying. Use `list_flags()` to audit current state.
- **Backend flags:** Set flags via the API in dev/staging environments. The `changedBy` field helps teams coordinate toggles.

### Promotion to mainnet

When a gated feature is stable:
1. Set the flag to `true` on testnet for final validation.
2. Merge the gated code path to replace the legacy path entirely.
3. Remove the flag check and the dead code branch.
4. Delete the flag from storage.

Flags should **not** be used as permanent configuration switches on mainnet. Long-lived protocol configuration belongs in the `protocol_registry` contract.
