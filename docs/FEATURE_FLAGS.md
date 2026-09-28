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

### Percentage targeting

A flag can target a percentage of users instead of flipping everyone at once, so a risky migration can be canaried before a full cutover.

| Column | Type | Description |
|--------|------|-------------|
| `rolloutPercentage` | `integer` (nullable) | 0-100. `null` means no rollout. |
| `allowList` | `jsonb` | Principal IDs always granted the flag. |
| `denyList` | `jsonb` | Principal IDs always denied the flag. |

**Stable bucketing.** Each principal is hashed to one of 10 000 buckets with FNV-1a over `"<flagKey>:<principalId>"`, and is included when `bucket < rolloutPercentage * 100`. The bucket depends on nothing but those two strings, so it is identical across evaluations, across processes, and after a restart — a user cannot flip between states as a rollout is widened. The flag key is part of the hash input, so two flags rolled out to the same percentage select *different* users instead of stacking every canary on the same slice.

**Precedence.** Highest first:

| Order | Rule | Result |
|-------|------|--------|
| 1 | `deny_list` | off |
| 2 | `allow_list` | on |
| 3 | `percentage_included` (`bucket < threshold`) | on |
| 4 | `percentage_excluded` | off |
| 5 | `default_state` (no percentage configured) | `enabled` |

Deny beats allow, so a principal mistakenly on both lists cannot be granted. Both lists beat the percentage, so support can hand a flag to one user or pull it from one user without disturbing the rollout.

**`rolloutPercentage` is authoritative when set.** While it is non-null, `enabled` is *not* consulted — and `0` is a real value meaning "serve nobody", not a synonym for "unset". This makes the kill switch a single field: setting `rolloutPercentage: 0` serves nobody regardless of `enabled`, so an admin cannot believe they have disabled a live canary while a percentage keeps serving part of the population. To return a flag to plain on/off, set the percentage back to `null`.

```jsonc
// Serve a migration to 5% of users:
{ "key": "risky.migration", "enabled": true, "rolloutPercentage": 5 }
// Widen:  { "rolloutPercentage": 25 } → { "rolloutPercentage": 100 }
// Finish: { "rolloutPercentage": null }   → plain on/off on `enabled`
// Kill:   { "rolloutPercentage": 0 }     → serves nobody, `enabled` ignored
```

**Anonymous callers.** Bucketing needs a principal, so a request with no resolvable identity falls back to the flag's `enabled` state (reason `no_principal`) rather than receiving a bucket-based answer. `FeatureFlagGuard` resolves the principal from the authenticated user id, falling back to email for service callers.

**Malformed data.** The lists and the percentage live in `jsonb`/`integer` and can be written by hand. A non-array list or an out-of-range percentage is normalized away at evaluation time and treated as "no targeting", so a bad row degrades to plain on/off instead of throwing on the request path. Check constraints in the migration additionally reject a percentage outside 0-100 and a non-array list.

### Caching and performance

`FeatureFlagsService` maintains a **short-TTL in-memory cache** (default: 30 s) keyed by flag name:

- Warm on module start — all flags are loaded from PostgreSQL once at boot.
- Subsequent evaluations return in-memory results without a DB round-trip.
- On every `upsert` or `remove` the affected cache entry is **invalidated immediately** so the new state is visible on the very next call within the same process.
- If a flag is not in the cache (new key, or TTL expired), one DB lookup is performed and the result is cached with a fresh TTL.

### Observability

- Every `upsert` call logs the previous and new state via `Logger`, including the rollout percentage when one is set.
- The `changedBy` column records who last toggled the flag.
- The `FeatureFlagResponseDto` exposes `changedBy` and timestamps in API responses.

#### Prometheus metrics

Four metrics are exported to the shared `MetricsService` registry and appear at `/metrics`:

| Metric | Type | Description |
|--------|------|-------------|
| `feature_flag_cache_hits_total` | Counter | Incremented whenever a flag evaluation is served from cache. |
| `feature_flag_cache_misses_total` | Counter | Incremented whenever a cache miss forces a DB round-trip. |
| `feature_flag_evaluations_by_reason_total{reason}` | Counter | Evaluations split by the rule that resolved them (`percentage_included`, `allow_list`, `deny_list`, …), so rollout coverage is visible without per-user label cardinality. |
| `feature_flag_evaluation_duration_seconds` | Histogram | End-to-end wall-clock latency of every `isEnabled()`/`evaluate()` call. |

**Cache hit rate** can be computed as:
```
feature_flag_cache_hits_total / (feature_flag_cache_hits_total + feature_flag_cache_misses_total)
```

### Audit history

Every mutation to a feature flag is persisted as an immutable row in the `feature_flag_audit_logs` table via `FlagAuditLog` entity:

| Column | Description |
|--------|-------------|
| `flagKey` | The flag that was mutated. |
| `action` | `'upsert'` or `'remove'`. |
| `previousEnabled` | Boolean state before the change; `null` for brand-new flags. |
| `newEnabled` | Boolean state after the change; `null` for removals. |
| `previousTargeting` | Rollout percentage + allow/deny lists before the change; `null` for brand-new flags. |
| `newTargeting` | Rollout percentage + allow/deny lists after the change; `null` for removals. |
| `actor` | The `changedBy` identifier of the requester, or `null`. |
| `changedAt` | UTC timestamp of the mutation (auto-set by TypeORM). |

The targeting snapshots are plain objects, so a change to *who* a flag targets is as reviewable as a change to *whether* it is on. The "before" snapshot is taken as a copy before the entity is mutated, so a later in-process change cannot rewrite recorded history.

Audit history is retrievable via the admin endpoint:

```
GET /feature-flags/:key/history
```

Returns all audit entries for the specified key, ordered newest-first.

### Debugging a single principal

```
GET /feature-flags/:key/evaluate?principalId=user-123     (admin)
```

Returns the decision together with the rule that produced it and the principal's hash bucket, which is what makes a canary debuggable — it distinguishes "outside the 5% bucket" from "suppressed by the deny list" from "flag does not exist":

```jsonc
{
  "key": "risky.migration",
  "principalId": "user-123",
  "enabled": true,
  "reason": "percentage_included",   // flag_not_found | deny_list | allow_list
                                      // percentage_included | percentage_excluded
                                      // default_state | no_principal
  "bucket": 412,                     // [0, 10000), null when no bucket was needed
  "rolloutPercentage": 5,
  "allowList": [],
  "denyList": []
}
```

### API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/feature-flags` | List all flags |
| `GET` | `/feature-flags/:key` | Get a single flag's details |
| `GET` | `/feature-flags/check/:key` | Quick check (returns `{ key, enabled }`); pass `?principalId=` to apply targeting |
| `GET` | `/feature-flags/:key/evaluate?principalId=` | Full decision + reason for one principal (admin) |
| `GET` | `/feature-flags/:key/history` | Audit history for a flag |
| `POST` | `/feature-flags` | Create or update a flag, including its targeting |
| `DELETE` | `/feature-flags/:key` | Remove a flag |

`POST /feature-flags` accepts `rolloutPercentage`, `allowList`, and `denyList` alongside `key` and `enabled`. **Omitting all three leaves any existing rollout untouched**, so an on/off-only update cannot silently clear a live canary. Send `rolloutPercentage: null` explicitly to return a flag to plain on/off.

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

The guard resolves the calling principal from the request and applies percentage and list targeting, so a guarded route serves only the slice of users a rollout includes. For a route that should respect targeting but not be hidden entirely, call the service directly:

```typescript
const { enabled, reason } = await this.flags.evaluate('risky.migration', userId);
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

---

## Authoritativeness: On-chain vs Backend

The two layers are **independent** and serve different scopes:

| Concern | Authoritative layer | Rationale |
|---------|--------------------|-----------| 
| **Smart-contract logic paths** | **On-chain (`feature_flags` contract)** | The Soroban contract stores the flag in ledger-persistent storage. Any contract that imports the `FeatureFlagsContractClient` queries it directly. The backend has no ability to alter ledger state. |
| **API endpoints and service logic** | **Backend (`FeatureFlagsModule`)** | The NestJS module reads from PostgreSQL. The on-chain contract does not communicate with the backend. |

### They do NOT sync automatically

The two layers are deliberately decoupled:

- Enabling a flag on-chain does **not** automatically enable it in the backend, and vice-versa.
- Teams that need a feature gated in both layers must toggle both independently.
- This is intentional: smart-contract deployments and API deployments have different release cadences and authorization requirements.

### Which to use?

| Gate target | Use |
|-------------|-----|
| Contract function (Rust / Soroban) | On-chain `feature_flags` contract |
| HTTP route / NestJS service method | Backend `FeatureFlagsModule` |
| Both a contract function and a backend endpoint | Both layers, toggled independently |
