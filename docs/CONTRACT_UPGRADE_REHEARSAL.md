# Testnet contract-upgrade rehearsal

This runbook is the evidence format and operating procedure for rehearsing a
Soroban contract upgrade, storage migration, manifest update, backend refresh,
and rollback on Stellar Testnet.

## Automated rehearsal

`scripts/upgrade-rehearsal.mjs` performs the whole sequence below against
testnet and emits the evidence JSON. It refuses to run unless both
`NETWORK_PASSPHRASE` and the RPC server report the testnet passphrase.

```bash
cargo build --manifest-path apps/onchain/Cargo.toml --target wasm32-unknown-unknown --release -p upgradable-contract
npm run --prefix scripts wasm:optimize

# Advances as far as the timelock allows, then exits 75 until it can continue.
ADMIN_SECRET=S... npm run --prefix scripts rehearse:upgrade

# Or block through both 24 h delays in one invocation (~48 h).
ADMIN_SECRET=S... npm run --prefix scripts rehearse:upgrade -- --wait
```

What it does:

- **Target.** Deploys a dedicated, non-critical `upgradable_contract` instance
  at a deterministic address derived from the admin key (so re-runs find it),
  initializes it with `ADMIN_SECRET` as admin and writes a storage marker
  (`increment`). `--contract-id C...` targets an existing instance instead.
  The canonical `apps/onchain/testnet-manifest.json` is never modified.
- **Upgrade artefact.** The upgrade target is the baseline WASM plus a
  `lumenpulse_upgrade_rehearsal` custom section carrying the run ID: identical
  code, a distinct hash. Rollback re-queues the baseline hash.
- **Timelock.** Each phase records the queue transaction, the contract-reported
  `created_at`/`execute_after`/`expires_at`, a simulated early
  `execute_operation` rejected with `OperationNotReady` (`Error(Contract, #6)`),
  the ledger time `Ready` was observed and the execution transaction, ledger
  time and events.
- **Verification.** After the upgrade and after the rollback it reads the
  instance's executable WASM hash from the ledger and asserts admin, counter,
  `version` and `contract_version` are unchanged from the baseline. Any
  mismatch aborts the run; nothing is recorded as passed that did not pass.
- **Manifest and backend.** Writes `.upgrade-rehearsal/testnet-manifest.rehearsal.json`
  with the upgraded hash, then with the restored hash. When `BACKEND_URL` is
  set it records `GET /v1/contracts/manifests/active?environment=testnet`;
  otherwise `backend_verification` is recorded as `skipped` with the reason.

### Re-running is safe

Progress lives in `.upgrade-rehearsal/state.json` (git-ignored). Every
completed step and every submitted transaction hash is saved before moving on,
so a re-run resumes from the last completed step, never repeats a finished
step, and polls — never resubmits — a transaction that was sent before a crash.
A lock file stops two invocations driving the same rehearsal. Once complete,
re-running submits nothing and reports the evidence's freshness; `--new`
starts a new rehearsal (reusing the same instance). `--new` is refused while
a rehearsal is still in progress.

| Exit code | Meaning |
| --- | --- |
| 0 | Rehearsal complete and fresh; evidence written |
| 75 | A timelock is pending; re-run after the printed time |
| 2 | The last completed rehearsal is stale; run with `--new` |
| 1 | Error (nothing false is recorded) |

### Staleness

Evidence older than `--max-age-days` (default 30, or
`UPGRADE_REHEARSAL_MAX_AGE_DAYS`) is reported as stale by both the rehearsal
command and the validator.

## Repository gap (resolved)

The canonical manifest marks `upgradable_contract` as intentionally not
deployed, and the other deployed contracts do not expose the timelock
interface. **UPGRADE-REHEARSAL-001** is resolved by the automated rehearsal
deploying its own dedicated instance; no critical contract's manifest entry is
changed.

## Preconditions

Run all Rust commands from Ubuntu WSL:

```bash
cd /mnt/f/DRIPS/Lumenpulse-fork/apps/onchain
cargo test --workspace
cargo build --release --target wasm32-unknown-unknown -p upgradable-contract
```

From PowerShell, install JavaScript dependencies without committing generated
directories:

```powershell
pnpm install --no-frozen-lockfile
npm ci --prefix apps\backend
npm ci --prefix apps\webapp
npm ci --prefix apps\mobile
npm ci --prefix scripts
```

Before any signed transaction, verify that `ADMIN_SECRET` is a Stellar
**testnet** secret and that `NETWORK_PASSPHRASE` is
`Test SDF Network ; September 2015`. Never place the secret in evidence.

## Rehearsal sequence

The automated command performs these steps; they remain the reference for
what each evidence step means.


1. Save the current manifest, commit SHA, contract ID, contract WASM hash,
   contract version, and read-only state into the evidence file.
2. Upload the upgraded WASM and record its hash. The upgraded hash must differ
   from the baseline hash.
3. Queue `TimelockAction::Upgrade(upgraded_wasm_hash)` as the admin. Record the
   transaction hash, operation ID, ledger, `created_at`, `execute_after`, and
   `expires_at`.
4. Query `get_operation_status`. Record `Pending`.
5. Attempt `execute_operation` before `execute_after`. Record the rejected
   transaction and `OperationNotReady`.
6. Wait until the recorded `execute_after` timestamp, then query status and
   record `Ready`.
7. Execute the operation and record the transaction hash and emitted
   `Upgraded`/`OperationExecuted` events.
8. Verify the upgraded behavior and persistent state with read-only calls.
   If the upgraded contract changes storage schema, execute its migration
   entrypoint and record the migration output before declaring success.
9. Update `apps/onchain/testnet-manifest.json` with the new `wasm_hash` (or
   contract ID when the rehearsal uses a dedicated replacement instance).
10. Run manifest validation, backend contract drift detection, and the smoke
    harness. Record their complete output. Restarting the backend or creating
    a new manifest through the protected API verifies backend pickup; the
    active-manifest endpoint must return the new metadata.
11. Queue the previous known-good WASM hash through the same timelock.
12. Repeat the pending, early-rejection, ready, execution, and state
    verification steps for rollback.
13. Restore the manifest to the verified rollback hash and rerun backend and
    smoke verification.

## Evidence file

[`upgrade-rehearsal.evidence.example.json`](upgrade-rehearsal.evidence.example.json)
is the schema: the validator requires every key it lists, with the same JSON
type, and every step it names, in its order. Each step records `status`
(`passed`, or `skipped` for `backend_verification` only), `started_at`,
`completed_at` and the captured `output`; `timelock.upgrade` and
`timelock.rollback` record the on-chain timestamps.

The rehearsal command writes `.upgrade-rehearsal/upgrade-rehearsal.evidence.json`
(override with `--out`) and validates it before writing. To check any
evidence file:

```bash
npm run validate:upgrade-rehearsal --prefix scripts -- .upgrade-rehearsal/upgrade-rehearsal.evidence.json
#   --max-age-days N   stale threshold (default 30)
#   --strict           a skipped backend_verification is an error
```

Beyond schema conformance the validator rejects placeholder or empty output,
an upgrade artefact equal to the original, a rollback that does not restore
the original hash, `execute_after - queued_at` differing from
`timelock_delay_seconds`, an early-rejection not before `execute_after`, an
execution before `execute_after` or after `expires_at`, and out-of-order
timestamps. It exits 0 when valid and fresh, 2 when valid but stale and 1 when
invalid. To satisfy the mainnet-readiness check, commit a passing evidence
file as `docs/upgrade-rehearsal.evidence.<date>.json`; never commit
`ADMIN_SECRET` or the state directory.

## Follow-up issue register

- **UPGRADE-REHEARSAL-001** — *Resolved:* `scripts/upgrade-rehearsal.mjs`
  deploys a dedicated non-critical `upgradable_contract` instance.
- **UPGRADE-REHEARSAL-002** — The existing strict backend drift check reports
  missing crowdfund environment variables in the web and mobile example files.
  Resolve this configuration drift before using that check as the final
  rehearsal gate.
- Add any operational gaps discovered during the live run here and file each
  one as a separate issue with the captured evidence attached.
