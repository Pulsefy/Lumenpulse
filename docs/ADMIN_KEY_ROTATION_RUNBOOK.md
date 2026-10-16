# Admin Key Rotation Runbook (Testnet)

**Issue:** [#1626 — Contracts: Test admin key rotation against live deployments](https://github.com/Pulsefy/Lumenpulse/issues/1626)
**Scope:** Stellar testnet deployments listed in `apps/onchain/testnet-manifest.json`
**Status:** Rotation flow (Wave 9) is implemented; this runbook makes it exercisable end to end and documents its blast radius.

## 1. Background

Wave 9 added two admin rotation paths in `apps/onchain/contracts/upgradable-contract/src/lib.rs`:

| Path | Functions | Timing | Use when |
|---|---|---|---|
| Timelock rotation (production) | `queue_operation(SetAdmin)` → `execute_operation` | 24h delay (`MIN_DELAY_SECONDS`), 7d grace (`GRACE_PERIOD_SECONDS`) | Production rotation of the template contract and any contract fronted by the timelock |
| Two-step rotation | `propose_admin_rotation` → `accept_admin_rotation` / `cancel_admin_rotation` | Immediate once the new admin accepts | Fast handoff where the incoming admin can sign; also the cancellation test path |

Helpers:

- `get_admin()` — current admin (used by smoke harness and `GET /health/contracts`).
- `get_proposed_admin()` — pending two-step target (`None` when no rotation is pending). Added for issue #1626 so operators can verify pending/cancelled state with a read-only call.
- `get_operation_status()` — `Pending` / `Ready` / `Expired` for a queued timelock operation.

`testnet-manifest.json` currently reuses **one** `admin_address` (`GDPBZZ…`) across contracts. Rotating that key therefore affects every contract that trusts it (see blast radius).

Backend pickup (fixed for #1626):

- `DeploymentManifestService.refreshManifest()` watches `apps/onchain/testnet-manifest.json` (5s `watchFile`) and `POST /v1/contracts/manifests/refresh`, and now tracks top-level `admin_address` plus per-contract `admin_address` alongside contract IDs.
- On change it calls `ConfigService.setStellarAdminAddress()` / `setStellarContractAdminOverrides()`, then `invalidateCache()` — **no restart required**.
- `GET /v1/config/stellar` exposes the live value as `adminAddress`. `GET /v1/contracts/manifests/active` exposes the persisted manifest (metadata carries `admin_address`).

Manifest validation (`apps/onchain/scripts/validate-manifest.js`) now enforces:

- top-level `admin_address` is a valid `G…` Stellar account,
- any per-contract `admin_address` is a valid `G…` account.

## 2. Preconditions

1. `ADMIN_SECRET` is a **testnet** secret; `NETWORK_PASSPHRASE` is `Test SDF Network ; September 2015`. Never commit secrets or paste them into issues.
2. Both the current admin (`OLD_ADMIN`) and the incoming admin (`NEW_ADMIN`) are funded (friendbot) and their public keys are known.
3. Working tree clean; record `git rev-parse HEAD`, network (`testnet`), RPC URL, contract ID, current `admin_address`, and WASM hash before starting.
4. Backend reachable; you can call `GET /health/contracts` and `GET /v1/config/stellar`.

Generate the incoming key (example):

```bash
soroban keys generate rotation-target --network testnet
export NEW_ADMIN=$(soroban keys address rotation-target)
export OLD_ADMIN=$(soroban keys address testnet-admin)
echo "OLD=$OLD_ADMIN NEW=$NEW_ADMIN"
```

## 3. E2E rotation procedure (timelock path)

> The `upgradable-contract` template is intentionally **not deployed** on public testnet (`reason` in the manifest). Perform the live rotation against a **dedicated non-critical rehearsal instance** of the same WASM, or against the deployed contract that owns the admin you intend to rotate. Do not retarget a critical manifest entry to work around this — file a follow-up if no rehearsal instance exists (cf. `docs/CONTRACT_UPGRADE_REHEARSAL.md`).

```bash
CONTRACT_ID=<rehearsal-contract-id>
soroban contract invoke --id $CONTRACT_ID --source testnet-admin --network testnet \
  -- get_admin
# expect OLD_ADMIN

# 1. Queue rotation
soroban contract invoke --id $CONTRACT_ID --source testnet-admin --network testnet \
  -- queue_operation --proposer $OLD_ADMIN \
  --action '{"SetAdmin":"'$NEW_ADMIN'"}'
# record: operation id, tx hash, ledger, created_at, execute_after, expires_at

# 2. Status must be Pending
soroban contract invoke --id $CONTRACT_ID --source testnet-admin --network testnet \
  -- get_operation_status --operation_id <id>
# expect Pending

# 3. Early execution must fail
soroban contract invoke --id $CONTRACT_ID --source testnet-admin --network testnet \
  -- execute_operation --executor $OLD_ADMIN --operation_id <id>
# expect OperationNotReady

# 4. Wait until execute_after (24h), then confirm Ready
soroban contract invoke --id $CONTRACT_ID --source testnet-admin --network testnet \
  -- get_operation_status --operation_id <id>
# expect Ready

# 5. Execute
soroban contract invoke --id $CONTRACT_ID --source testnet-admin --network testnet \
  -- execute_operation --executor $OLD_ADMIN --operation_id <id>

# 6. Verify on-chain
soroban contract invoke --id $CONTRACT_ID --source rotation-target --network testnet \
  -- get_admin
# expect NEW_ADMIN
```

Two-step path (same verification shape):

```bash
soroban contract invoke --id $CONTRACT_ID --source testnet-admin --network testnet \
  -- propose_admin_rotation --proposer $OLD_ADMIN --new_admin $NEW_ADMIN
soroban contract invoke --id $CONTRACT_ID --source testnet-admin --network testnet \
  -- get_proposed_admin
# expect NEW_ADMIN
soroban contract invoke --id $CONTRACT_ID --source rotation-target --network testnet \
  -- accept_admin_rotation --new_admin $NEW_ADMIN
soroban contract invoke --id $CONTRACT_ID --source rotation-target --network testnet \
  -- get_admin
# expect NEW_ADMIN
soroban contract invoke --id $CONTRACT_ID --source rotation-target --network testnet \
  -- get_proposed_admin
# expect None
```

Offline rehearsal (no network): `cargo test -p upgradable-contract test_admin_rotation_e2e_timelock_then_cancelled_rotation` exercises the same sequence (queue → Pending → early-reject → Ready → execute → old-admin revoked → propose → cancel → intact).

## 4. Manifest update + backend pickup (no restart)

1. Update `apps/onchain/testnet-manifest.json`:
   - top-level `admin_address` → `NEW_ADMIN`,
   - any per-contract `admin_address` (e.g. `treasury`) that rotated → `NEW_ADMIN`.
2. Validate:
   ```bash
   node apps/onchain/scripts/validate-manifest.js
   ```
3. Backend pickup — either wait ≤5s for the file watcher **or** force refresh:
   ```bash
   curl -X POST https://<backend>/v1/contracts/manifests/refresh \
     -H "Authorization: Bearer $ADMIN_JWT" -H "X-API-Key: $ADMIN_KEY"
   ```
4. Verify without restart:
   ```bash
   curl https://<backend>/v1/config/stellar | jq .adminAddress
   # expect NEW_ADMIN
   curl "https://<backend>/v1/contracts/manifests/active?environment=testnet" | jq '.metadata.admin_address, .contracts.treasury.admin_address'
   npm run smoke --prefix scripts
   curl https://<backend>/health/contracts
   curl https://<backend>/health/smoke
   ```
   If `adminAddress` still shows the old value, check backend logs for `Manifest admin changed` / `Manifest changes detected`; do not restart to work around it — file a bug with the logs.

Automated coverage: `apps/backend/src/contracts/deployment-manifest.admin-rotation.spec.ts` asserts `refreshManifest()` propagates an `admin_address` edit to `ConfigService` and invalidates caches without a restart.

## 5. Verify the previous admin lost privileges

After rotation, **all** of these must hold (record output):

```bash
soroban contract invoke --id $CONTRACT_ID --source testnet-admin --network testnet \
  -- queue_operation --proposer $OLD_ADMIN --action '{"SetAdmin":"'$OLD_ADMIN'"}'
# expect Unauthorized (Contract #2)

soroban contract invoke --id $CONTRACT_ID --source testnet-admin --network testnet \
  -- propose_admin_rotation --proposer $OLD_ADMIN --new_admin $OLD_ADMIN
# expect Unauthorized

soroban contract invoke --id $CONTRACT_ID --source testnet-admin --network testnet \
  -- cancel_admin_rotation --canceller $OLD_ADMIN
# expect Unauthorized (or OperationNotFound if nothing pending — never success)

soroban contract invoke --id $CONTRACT_ID --source rotation-target --network testnet \
  -- get_admin
# expect NEW_ADMIN
```

Contract tests: `test_two_step_rotation_revokes_previous_admin` and `test_old_admin_cannot_execute_after_rotation` assert the same revocation offline.

## 6. Cancelled rotation (must leave original admin intact)

Timelock cancel:

```bash
soroban contract invoke --id $CONTRACT_ID --source testnet-admin --network testnet \
  -- queue_operation --proposer $CURRENT_ADMIN --action '{"SetAdmin":"'$CANDIDATE'"}'
soroban contract invoke --id $CONTRACT_ID --source testnet-admin --network testnet \
  -- cancel_operation --canceller $CURRENT_ADMIN --operation_id <id>
soroban contract invoke --id $CONTRACT_ID --source testnet-admin --network testnet \
  -- get_admin
# expect CURRENT_ADMIN (unchanged)
```

Two-step cancel:

```bash
soroban contract invoke --id $CONTRACT_ID --source testnet-admin --network testnet \
  -- propose_admin_rotation --proposer $CURRENT_ADMIN --new_admin $CANDIDATE
soroban contract invoke --id $CONTRACT_ID --source testnet-admin --network testnet \
  -- get_proposed_admin
# expect CANDIDATE
soroban contract invoke --id $CONTRACT_ID --source testnet-admin --network testnet \
  -- cancel_admin_rotation --canceller $CURRENT_ADMIN
soroban contract invoke --id $CONTRACT_ID --source testnet-admin --network testnet \
  -- get_admin
# expect CURRENT_ADMIN
soroban contract invoke --id $CONTRACT_ID --source testnet-admin --network testnet \
  -- get_proposed_admin
# expect None
soroban contract invoke --id $CONTRACT_ID --source <candidate-key> --network testnet \
  -- propose_admin_rotation --proposer $CANDIDATE --new_admin $CANDIDATE
# expect Unauthorized — candidate never gained privileges
```

Contract tests: `test_timelock_cancel_leaves_original_admin_intact`, `test_cancelled_two_step_rotation_leaves_original_admin_intact`, and the pre-existing `test_admin_rotation_cancel` cover this offline.

## 7. Blast radius

Because the manifest reuses one admin key:

- **All contracts trusting that key are affected at once.** Rotating `admin_address` changes who can `upgrade`, `set_admin`, `pause`/`unpause`, `allocate_budget`/`cancel_stream`/`emergency_stop`, `freeze`, and multisig proposal execution (see `docs/threat-model.md` §6.3).
- **Timelock delay is the safety window.** A queued `SetAdmin` cannot execute for 24h and expires after 7d. Monitor `OperationQueued` events; `cancel_operation` (timelock) or `cancel_admin_rotation` (two-step) within the window aborts a suspicious rotation.
- **Instant paths bypass the window.** Legacy `upgrade()`/`set_admin()` on the template contract execute immediately (accepted risk AR-2). Treasury `set_admin_via_multisig` requires quorum but no timelock. Prefer the timelock path on testnet and gate/remove instant paths before mainnet.
- **Backend + clients.** Until the manifest is updated **and** the backend picks it up (§4), health/smoke checks and admin-gated UIs still reference the old admin. Update the manifest, verify `GET /v1/config/stellar`, then run smoke + `GET /health/contracts` + `GET /health/smoke` before announcing completion.
- **Rollback.** If the new key is lost or compromised: re-queue `SetAdmin(old-or-fresh-admin)` from the **current** admin while it is still valid. If the current admin is already compromised, fall back to the incident runbook (`docs/CONTRACT_DEPLOYMENT_ROLLBACK_PLAYBOOK.md` §8): pause affected contracts, freeze rogue token holders, redeploy only if state is corrupted, and record a new manifest.

## 8. Evidence to capture

For the live run, record (no secrets):

```text
Date / operator / git commit / network / RPC URL
Contract ID / WASM hash / contract version
OLD_ADMIN / NEW_ADMIN (public keys only)
Queue tx hash / operation id / created_at / execute_after / expires_at
Pending status output / early-execution rejection output
Ready status output / execute tx hash / AdminChanged + OperationExecuted events
Post-rotation get_admin output (NEW_ADMIN)
Old-admin rejection outputs (queue + propose + cancel)
Manifest diff (admin_address old -> new)
validate-manifest.js output
POST /v1/contracts/manifests/refresh output
GET /v1/config/stellar adminAddress output
GET /v1/contracts/manifests/active output
smoke harness output, /health/contracts, /health/smoke outputs
Cancelled-rotation outputs (get_admin unchanged, get_proposed_admin None, candidate Unauthorized)
```

## 9. Related docs

- `docs/CONTRACT_DEPLOYMENT_ROLLBACK_PLAYBOOK.md` — deployment, manifest sync, upgrade/rollback, emergency halt.
- `docs/TESTNET_OPERATIONS_RUNBOOK.md` — release gates, health/smoke endpoints.
- `docs/CONTRACT_UPGRADE_REHEARSAL.md` — timelock upgrade rehearsal evidence format (same pattern as §3 here).
- `docs/threat-model.md` §6.3 / §7 (AR-2) — key-handling matrix and accepted timelock-bypass risk.
- `apps/backend/src/contracts/deployment-manifest.service.ts` — file watcher + refresh logic.
- `apps/backend/src/config/config.service.ts` — in-memory admin overrides + `GET /v1/config/stellar`.
