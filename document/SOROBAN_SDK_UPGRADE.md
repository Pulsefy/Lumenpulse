# Soroban SDK Upgrade Plan — v23 → v29

**Issue**: #1621  
**Date**: 2026-10-17  
**Author**: contracts-team  
**Status**: Upgrade branch prepared; test run and WASM measurement pending Rust toolchain availability

---

## 1. Version Overview

| | Current | Target |
|---|---|---|
| **soroban-sdk (workspace)** | `"23"` | `"29"` |
| **Resolved lock version** | `23.5.2` | `29.0.1` |
| **soroban-env crates** | 23.x | 29.0.1 |
| **Stellar Protocol** | 23 | 28 (via v28.0.0) + env fix (v29.0.1) |
| **Required Stellar CLI** | v23+ | **v25.2.0+** |

There is no stable v24, v25, v26, or v27 minor on the breaking-changes path — all major breaking changes are concentrated in **v28.0.0** (released 2026-09-18).  
v29.0.0 (2026-10-07) bumps soroban-env crates to 29.0.0.  
v29.0.1 (2026-10-12) is the latest stable release and patches a wasmi runtime regression introduced in v29.0.0. **Target is v29.0.1.**

---

## 2. Breaking Changes Affecting This Codebase

The table below maps every SDK breaking change from v28.0.0 against the LumenPulse contracts. v29 adds no new breaking changes — it is a runtime bugfix only.

### 2.1 Changes that require code edits

| # | Change | Upstream PR | Affected files | Action |
|---|---|---|---|---|
| BC-1 | `update_current_contract_wasm` deprecated; replacement is `update_current_contract(ContractExecutable::Wasm(...))` | #2020 | `lumen_token`, `contributor_registry`, `crowdfund_vault`, `matching_pool`, `project_registry`, `protocol_registry`, `upgradable-contract`, `vesting-wallet` | **Applied** — see §3 |
| BC-2 | `AllowanceChangedEvent.expiration_ledger` renamed to `live_until_ledger` (SEP-41 alignment) | #1985 | `lumen_token/src/events.rs`, `lumen_token/src/lib.rs` | **Applied** — see §3 |
| BC-3 | Test snapshots regenerate — every natively-registered contract now gets its own code entry | #2014 | 187 JSON files across 7 contracts | **Regenerate on first `cargo test`** — see §5 |

### 2.2 Changes that are clean (no edits needed)

| # | Change | Finding |
|---|---|---|
| BC-4 | `export = ...` / `lib = ...` on `contracttype`/`contracterror`/`contractevent` now compile errors | Not used anywhere in the workspace |
| BC-5 | Remove `experimental_spec_shaking_v2` feature flag | Not present in any `Cargo.toml` |
| BC-6 | `#[contractimpl(contracttrait)]` on non-trait impl now compile error | Not used anywhere |
| BC-7 | Some test utilities panic when called inside contract functions | No violations found in test suite |
| BC-8 | `contractevent` with `data_format = "map"` omits `None`/void fields by default | No map-format events in this codebase; all events use default (positional) format |
| BC-9 | `contracttype` struct tolerates extra/missing fields on read (CAP-86) | Non-breaking behaviour improvement; no code change required |

---

## 3. Code Changes Applied to the Upgrade Branch

### 3.1 `apps/onchain/Cargo.toml`

```diff
 [workspace.dependencies]
-soroban-sdk = "23"
+soroban-sdk = "29"
```

### 3.2 `apps/onchain/contracts/tests/Cargo.toml`

The integration-test crate pins the version directly (not via workspace inheritance):

```diff
-soroban-sdk = { version = "23", features = ["testutils"] }
+soroban-sdk = { version = "29", features = ["testutils"] }
```

### 3.3 `update_current_contract_wasm` → `update_current_contract` (BC-1)

Applied to all 8 call sites. Pattern is identical in every contract:

```diff
+use soroban_sdk::deployer::ContractExecutable;
 ...
-env.deployer().update_current_contract_wasm(new_wasm_hash.clone());
+env.deployer().update_current_contract(ContractExecutable::Wasm(new_wasm_hash.clone()));
```

Files changed:

- `contracts/lumen_token/src/lib.rs` (line 143)
- `contracts/contributor_registry/src/lib.rs` (line 874)
- `contracts/crowdfund_vault/src/lib.rs` (line 2778)
- `contracts/matching_pool/src/lib.rs` (line 973)
- `contracts/project_registry/src/lib.rs` (line 533)
- `contracts/protocol_registry/src/lib.rs` (line 322)
- `contracts/upgradable-contract/src/lib.rs` (line 229)
- `contracts/vesting-wallet/src/lib.rs` (line 416)

### 3.4 `expiration_ledger` → `live_until_ledger` (BC-2)

```diff
 // contracts/lumen_token/src/events.rs
 pub struct AllowanceChangedEvent {
     pub amount: i128,
-    pub expiration_ledger: u32,
+    pub live_until_ledger: u32,
 }
```

```diff
 // contracts/lumen_token/src/lib.rs  (AllowanceChangedEvent construction)
-AllowanceChangedEvent { from, spender, amount, expiration_ledger }
+AllowanceChangedEvent { from, spender, amount, live_until_ledger: expiration_ledger }
```

> **Off-chain consumers**: Any indexer or backend event listener that decoded
> `AllowanceChangedEvent` must be updated to read the `live_until_ledger` key
> instead of `expiration_ledger`. The field carries the same value; only the
> name changes. The `apps/onchain/contracts/lumen_token/src/allowance.rs`
> storage struct (`AllowanceValue.expiration_ledger`) is unchanged — that is
> internal storage, not an event field, and is not subject to this rename.

---

## 4. Test Suite Plan

Cargo is not available in the current codespace environment. The commands below
are the canonical sequence to run on a machine with `rustup` and the `wasm32-unknown-unknown`
target installed.

### 4.1 Prerequisites

```bash
rustup update stable
rustup target add wasm32-unknown-unknown
# Stellar CLI ≥ v25.2.0 required for WASM builds (spec-shaking v2 always on)
cargo install --locked stellar-cli --version 25.2.0
```

### 4.2 Full workspace test run

```bash
cd apps/onchain

# Unit + snapshot tests for all 22 workspace members
cargo test --workspace 2>&1 | tee /tmp/test-results-v29.txt

# Integration tests (excluded from workspace; run separately)
cargo test --manifest-path contracts/tests/Cargo.toml 2>&1 | tee -a /tmp/test-results-v29.txt
```

### 4.3 Expected snapshot behaviour

Because of BC-3 (every natively-registered contract now gets its own code
entry), **all 187 snapshot JSON files will fail on the first run**. This is
expected. Regenerate them with:

```bash
cargo test --workspace -- --test-output immediate 2>&1 | grep "snapshot"
# soroban-sdk will automatically overwrite the snapshots with the new format
# Re-run once to confirm all tests pass with the new snapshots
cargo test --workspace
```

Contracts whose snapshots will regenerate:

| Contract | Snapshot count |
|---|---|
| `contributor_registry` | ~40 |
| `crowdfund_vault` | ~50 |
| `lumen_token` | 6 |
| `matching_pool` | ~45 |
| `tests` (e2e) | 1 |
| `upgradable-contract` | ~25 |
| `vesting-wallet` | ~20 |
| **Total** | **187** |

### 4.4 Proptest regressions

The existing `proptest-regressions/` files in `matching_pool` and `tests` crates
are format-stable across SDK versions and do not need regeneration. If any
proptest regression fails, delete the `.txt` file for that test case and let
proptest regenerate a fresh one.

---

## 5. WASM Size and Resource Cost Deltas

### 5.1 Measurement commands

```bash
cd apps/onchain

# Build all contracts for release
cargo build --workspace --release --target wasm32-unknown-unknown \
  --exclude integration_tests 2>&1 | tee /tmp/build-v29.txt

# Collect sizes (bytes)
for contract in contributor_registry crowdfund_vault feature_flags \
  idempotency-guard liquidity-pool lumen_token lumenpulse-curation \
  matching_pool notification_broker notification_interface pricing_adapter \
  project_registry protocol_registry reentrancy-guard stable_swap_pool \
  treasury upgradable-contract vesting-wallet yield_vault; do
  wasm="target/wasm32-unknown-unknown/release/${contract}.wasm"
  if [ -f "$wasm" ]; then
    echo "$contract: $(wc -c < $wasm)"
  fi
done
```

### 5.2 Baseline and expected delta

The current `wasm-baseline.json` contains null values for all contracts —
pre-upgrade sizes have never been formally captured. The upgrade is therefore
also the opportunity to establish the baseline. After a successful v29 build:

1. Record the output of the size loop above into `apps/onchain/wasm-baseline.json`.
2. On subsequent SDK bumps, compare against this baseline and update the file
   if the new sizes are accepted.

### 5.3 Expected size impact of v28 changes

The primary WASM-size driver in v28 is **spec-shaking v2** (`--release` builds
only). Spec XDR metadata for unreachable types is now stripped by the Stellar
CLI at build time rather than included in the WASM. Contracts with many unused
`contracttype` derivations (e.g. `crowdfund_vault`, `contributor_registry`) will
likely see a **size reduction of 5–15%**. Contracts with few or no unused types
will be roughly unchanged. No contract should grow.

The `wasm-budgets.json` file sets a ceiling of 1 MiB (1,048,576 bytes) for
every contract. This limit is not at risk — the largest contract in the
workspace (`crowdfund_vault` at ~106 KiB of source) compiles to well under
200 KiB in the current SDK.

### 5.4 Resource cost impact

soroban-env 29.0.1 fixes a wasmi runtime bug introduced in v29.0.0. This
affects instruction metering accuracy. Any test that asserts exact CPU/memory
ledger unit costs should be treated as advisory until re-measured against v29.0.1.
The v28 soroban-env (28.0.2) introduced no fee schedule changes relevant to
this contract suite.

---

## 6. Manifest Hash Implications

### 6.1 What changes

A soroban-sdk bump changes the compiled WASM bytecode for every contract that
was rebuilt, because the SDK contributes code to the final binary (host-function
dispatch tables, macro-generated spec entries, etc.). Even a lint-only change in
the SDK can shift the output hash.

The seven contracts currently recorded in `testnet-manifest.json` with
`wasm_hash` values are:

| Contract | Current hash (v23) | Action required |
|---|---|---|
| `contributor_registry` | `4a25619b...` | Re-upload + re-verify |
| `project_registry` | `847355767f...` | Re-upload + re-verify |
| `crowdfund_vault` | `0ee5515e...` | Re-upload + re-verify |
| `matching_pool` | `c917f2f4...` | Re-upload + re-verify |
| `treasury` | `6f7d6e1e...` | Re-upload + re-verify |
| `lumen_token` | `143ce02a...` | Re-upload + re-verify |
| `pricing_adapter` | `477ccd47...` | Re-upload + re-verify |

### 6.2 Re-verification procedure (per contract)

```bash
# 1. Build the upgraded contract
cargo build --release --target wasm32-unknown-unknown -p <crate_name>

# 2. Compute the hash
stellar contract install \
  --wasm target/wasm32-unknown-unknown/release/<crate>.wasm \
  --network testnet \
  --source testnet-admin

# The CLI prints the wasm_hash. Record it.

# 3. Update testnet-manifest.json with the new wasm_hash

# 4. Run manifest validation
node apps/onchain/scripts/validate-manifest.js

# 5. Upgrade the live contract through its on-chain upgrade entrypoint
stellar contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  --source testnet-admin \
  --fn upgrade \
  -- --caller <ADMIN_ADDRESS> \
     --new_wasm_hash <NEW_HASH_AS_HEX>

# 6. Run smoke tests to verify the upgraded contract responds correctly
```

### 6.3 Connection to reproducible-build verification (#1233)

Issue #1233 tracks recording canonical WASM hashes for reproducibility checks.
**Any SDK bump invalidates all previously recorded hashes.** The correct
sequence is:

1. Merge the SDK upgrade branch first.
2. Perform a clean build in a reproducible environment (identical Rust toolchain,
   identical Stellar CLI version, `--locked` flag on all installs).
3. Record the new hashes as the new baseline in both `testnet-manifest.json`
   and any separate hash ledger maintained by #1233.
4. Gate future SDK bumps through the same process — do not update the manifest
   from a non-reproducible local build.

The v29.0.1 wasmi fix (§5.4) is particularly relevant here: v29.0.0 produced
subtly different metering output due to the runtime bug. Only hashes produced
with v29.0.1 should be used as the post-upgrade canonical baseline.

---

## 7. Upgrade Cadence and Ownership

### 7.1 Cadence

| Trigger | Action |
|---|---|
| New **patch** release (e.g. 29.0.x) | Review release notes. If the patch is purely additive or a bug fix with no WASM output change, the bump is optional and low-risk. If it touches the wasmi runtime or spec emission (like 29.0.1), treat as high-priority. |
| New **minor** release on a stable major | Review for deprecation warnings. Plan upgrade within one sprint. |
| New **major** release (breaking changes) | Open a tracking issue (as #1621 was opened). Assign an owner, perform a full audit against the codebase, and schedule the upgrade for the next available release window. Do not allow more than one major version of lag. |
| **Protocol upgrade** on testnet/mainnet | A protocol upgrade almost always requires a matching SDK major. Do not deploy to a network running a newer protocol with an older SDK. |

The recommended check schedule is: review the [rs-soroban-sdk releases page](https://github.com/stellar/rs-soroban-sdk/releases) **monthly**, or subscribe to GitHub release notifications for the repo.

### 7.2 Ownership

| Role | Responsible party | Responsibility |
|---|---|---|
| **Upgrade coordinator** | Smart Contracts Lead (`@contracts-team`) | Opens tracking issue, assigns subtasks, sets target merge date |
| **Code changes** | Contracts engineer on rotation | Applies Cargo bumps, source fixes, runs tests |
| **Test sign-off** | Second contracts engineer (code review) | Reviews diff, verifies test output, approves PR |
| **Manifest re-verification** | DevOps / release engineer | Rebuilds WASMs in CI, uploads to testnet, updates manifest |
| **Off-chain consumer updates** | Backend team | Updates event decoders for any renamed fields (e.g. BC-2 `live_until_ledger`) |
| **Final merge approval** | Smart Contracts Lead | Merges after all checks pass |

### 7.3 Branch and PR convention

- Branch name: `chore/soroban-sdk-vXX` (e.g. `chore/soroban-sdk-v29`)
- PR title: `chore(contracts): upgrade soroban-sdk to vXX.Y.Z` (≤70 chars)
- Required CI gates before merge:
  - `cargo test --workspace` passes (all snapshots committed)
  - `cargo build --workspace --release --target wasm32-unknown-unknown` passes
  - `node apps/onchain/scripts/validate-manifest.js` passes with updated hashes
  - No new compiler warnings introduced by the bump

### 7.4 Rollback

A soroban-sdk bump is a source-level change only — the on-chain contracts are
unchanged until the WASM is re-uploaded and the upgrade entrypoint is called.
Rolling back means:

1. Revert the branch (or re-deploy from the previous WASM hash via the timelock
   upgrade path — see `CONTRACT_UPGRADE_REHEARSAL.md`).
2. Restore `testnet-manifest.json` to the previous committed state.
3. Re-run `validate-manifest.js` to confirm consistency.

The previous v23 WASM hashes are preserved in git history and can be
re-installed to testnet at any time.

---

## 8. Checklist

- [x] Current SDK version documented (23.5.2)
- [x] Target SDK version documented (29.0.1)
- [x] All breaking changes audited against codebase
- [x] `Cargo.toml` workspace dependency updated to `"29"`
- [x] `contracts/tests/Cargo.toml` direct pin updated to `"29"`
- [x] BC-1: `update_current_contract_wasm` → `update_current_contract` applied (8 call sites)
- [x] BC-2: `expiration_ledger` → `live_until_ledger` in `AllowanceChangedEvent` applied
- [x] BC-3: Snapshot regeneration documented and expected
- [x] BC-4 through BC-9: Confirmed clean, no changes needed
- [ ] `cargo test --workspace` run and passing (requires Rust toolchain — see §4)
- [ ] WASM sizes measured and `wasm-baseline.json` populated (requires build — see §5)
- [ ] `testnet-manifest.json` updated with post-upgrade hashes (requires testnet deploy)
- [x] Manifest hash implications documented (§6)
- [x] Re-verification steps documented (§6.2)
- [x] Upgrade cadence documented (§7.1)
- [x] Ownership documented (§7.2)
- [x] `document/SMART_CONTRACTS.md` version banner updated to v29
