# Version Introspection

Every core Lumenpulse contract exposes a `version()` method that returns a
`ContractVersion` struct.  This document explains the schema, semantics, and
conventions that govern how versions evolve.

---

## Quick start

```bash
# Read the version of any deployed contract via Stellar CLI
stellar contract invoke \
  --network testnet \
  --id <CONTRACT_ID> \
  -- version
```

Example response (XDR decoded to JSON):

```json
{
  "contract":      "lumen_token",
  "major":         1,
  "minor":         0,
  "patch":         0,
  "min_interface": 1
}
```

---

## `ContractVersion` schema

| Field           | Type     | Description |
|-----------------|----------|-------------|
| `contract`      | `Symbol` | Short ASCII name identifying the contract (e.g. `"lumen_token"`). Max 32 chars, alphanumeric + `_`. |
| `major`         | `u32`    | Breaking-change counter. Clients compiled against a **different** major are **incompatible**. |
| `minor`         | `u32`    | Additive, backwards-compatible feature increments. Safe for existing clients to ignore. |
| `patch`         | `u32`    | Backwards-compatible bug-fix increments. Always safe to upgrade. |
| `min_interface` | `u32`    | The oldest `major` version this deployment can still inter-operate with. A client whose `major` is **less than** `min_interface` **must upgrade** before calling the contract. |

The struct is defined in the shared `contracts/version` crate and carries the
`#[contracttype]` attribute, making it part of the on-chain ABI.

---

## `min_interface` semantics

`min_interface` answers the question: *"Do I need to upgrade my client before
calling this contract?"*

```
if client_major < deployed_min_interface:
    # client MUST upgrade — contract behaviour is incompatible
    raise UpgradeRequired

if client_major == deployed_major:
    # perfect match
    proceed()

if client_major > deployed_major:
    # client is newer — backwards compat path only (may miss new features)
    proceed_with_caution()
```

When no backwards-compatibility window is offered, `min_interface == major`.
Both start at `1` for every contract in the initial release.

---

## Upgrade conventions

| Change type                                       | Bump |
|---------------------------------------------------|------|
| New or changed method signature or data type      | `major` (raise `min_interface` if old clients are broken) |
| New optional method or additive feature            | `minor` |
| Internal fix with no observable interface change  | `patch` |
| Storage migration required                        | `major` (align with `CURRENT_STORAGE_VERSION` in `crowdfund_vault`) |

> **Rule:** `min_interface` must never exceed `major`.  The CI check
> (`assert!(v.min_interface <= v.major)`) enforces this for every test run.

---

## Deployed versions (initial release)

| Contract                | `contract` Symbol   | `major` | `minor` | `patch` | `min_interface` |
|-------------------------|---------------------|---------|---------|---------|-----------------|
| `lumen_token`           | `lumen_token`       | 1       | 0       | 0       | 1               |
| `project_registry`      | `project_registry`  | 1       | 0       | 0       | 1               |
| `yield_vault`           | `yield_vault`       | 1       | 0       | 0       | 1               |
| `matching_pool`         | `matching_pool`     | 1       | 0       | 0       | 1               |
| `crowdfund_vault`       | `crowdfund_vault`   | 1       | 0       | 0       | 1               |
| `contributor_registry`  | `contributor_reg`   | 1       | 0       | 0       | 1               |
| `treasury`              | `treasury`          | 1       | 0       | 0       | 1               |

> **Note on `contributor_registry` symbol:** Soroban `Symbol` values are capped
> at 32 ASCII characters. `"contributor_registry"` is 20 characters and fits,
> but `"contributor_reg"` was chosen as a shorter, unambiguous identifier.
> This is the canonical name for cross-contract and backend use.

---

## Backend config and release validation

### Pattern 1 — Pre-flight version check

```typescript
const v = await contract.version();
if (v.major !== EXPECTED_MAJOR) {
  throw new Error(`Incompatible contract version: expected major=${EXPECTED_MAJOR}, got ${v.major}`);
}
if (v.major < v.min_interface) {
  throw new Error('Contract invariant violated: min_interface > major');
}
```

### Pattern 2 — Release validation script

```bash
#!/usr/bin/env bash
# validate-versions.sh
CONTRACTS=("lumen_token" "project_registry" "yield_vault" "matching_pool" "crowdfund_vault" "treasury")
EXPECTED_MAJOR=1

for contract in "${CONTRACTS[@]}"; do
  ID=$(jq -r ".contracts.${contract}.id" testnet-manifest.json)
  MAJOR=$(stellar contract invoke --network testnet --id "$ID" -- version | jq '.major')
  if [[ "$MAJOR" != "$EXPECTED_MAJOR" ]]; then
    echo "FAIL: $contract major=$MAJOR (expected $EXPECTED_MAJOR)"
    exit 1
  fi
  echo "OK: $contract v$MAJOR"
done
```

### Pattern 3 — Distinguishing incompatible upgrades

When a breaking upgrade is deployed (`major` increments), backends that call
`version()` before any transaction will receive a `major` that differs from
their compiled expectation.  They can surface a human-readable error to
operators before any funds move, rather than failing mid-transaction.

---

## Implementation notes

- `version()` is a **pure, read-only** function.  It requires no
  authentication and reads no ledger storage.  The version constant is baked
  in at **compile time** inside the WASM binary.
- No on-chain storage slot is consumed.  TTL and rent costs are zero.
- The `ContractVersion` type lives in the shared `contracts/version` crate so
  all seven contracts reference an identical ABI definition.  Cross-contract
  callers can deserialise the response with the same type.
- Because the version is compile-time constant, it is **always** consistent
  with the deployed WASM hash in the off-chain `testnet-manifest.json`.

---

## Shared crate location

```
apps/onchain/contracts/version/
├── Cargo.toml
└── src/
    └── lib.rs   ← ContractVersion struct + ContractVersion::new()
```

All core contracts declare `version = { workspace = true }` in their
`Cargo.toml` and expose:

```rust
pub fn version(env: Env) -> ContractVersion {
    ContractVersion::new(&env, "<contract_name>", MAJOR, MINOR, PATCH, MIN_INTERFACE)
}
```
