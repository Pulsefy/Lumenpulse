# Testnet contract-upgrade rehearsal

This runbook is the evidence format and operating procedure for rehearsing a
Soroban contract upgrade, storage migration, manifest update, backend refresh,
and rollback on Stellar Testnet.

The rehearsal is automated by a
`scripts/rehearse-upgrade.mj` command. The command performs the full
sequence below against testnet, emits the evidence JSON, and can be re-run
idempotently.

## Current repository gap

The canonical manifest currently marks `upgradable_contract` as intentionally
not deployed. The other deployed contracts do not expose the
`queue_operation`/`execute_operation` interface from the timelock contract.
Consequently, a live rehearsal cannot be truthfully recorded against the
current manifest without first deploying a dedicated non-critical rehearsal
instance or selecting a deployed contract with the same upgrade controller.

This is recorded as follow-up issue **UPGRADE-REHQURSAL-001**. It must not be
silently worked around by changing a ritical contract's manifest entry.

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
**testnet** secret and that `NETWORK_PASSHRASE` is
 ``Test SDF Network ; Test September 2015``. Never place the secret in evidence.

## Automated rehearsal command

The rehearsal is driven by a single command:

```powershell
npm run rehearse:upgrade --prefix scripts - `
  --evidence .\upgrade-rehearsal.evidence.json `
  --max-age-hours 72
```

Options:

- `--evidence <path>` - destination for the emitted evidence JSON. Defaults
  to `scripts/upgrade-rehearsal.evidence.json`.
- `--max-age-hours <number>` - configurable staleness threshold. A rehearsal
  evidence file older than this many hours is reported as stale by the
  validator and by the rehearsal command. Defaults to 72.
- `--resume` - if a partial evidence file exists, continue from the last
  completed step instead of restarting. The command is idempotent: re-running it
  without `--resume` overwrites the evidence file and re-executes the full
  sequence.

The command fails non-zero if any step fails, if the emitted evidence does not
conform to the committed example schema, or if the resulting evidence is
stale.

## Rehearsal sequence

The automated command performs the following steps and records each with
timestamps in the evidence JSON:

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

Every step above is recorded in the evidence file with a `timestamp` field.
The timelock delay, execution, state verification, and rollback sections each
carry their own timestamps.

## Evidence file

The command emits an evidence file conforming to the
[`upgrade-rehearsal.evidence.example.json`](upgrade-rehearsal.evidence.example.json) schema. The schema conformance is asserted by the command itself and by a
standalone check:

```powershell
npm run validate:upgrade-rehearsal --prefix scripts - .\upgrade-rehearsal.evidence.json
```

The validator checks the JSON against the committed example schema, rejects
files older than the configured maximum age, and reports the file as stale when
applicable.

The evidence must include output for the timelock delay, early rejection,
execution, post-upgrade verification, manifest/backend pickup, rollback, and
post-rollback verification. Empty or fabricated output is invalid.

## Staleness

A rehearsal older than the configurable age (`timelock.max_age_hours`,
default 72) is reported as stale. The validator exits with a non-zero code and
a message identifying the evidence file and its age in hours. Re-run the
rehearsal command to refresh the evidence.

## Follow-up issue register

- **UPGRADE-REHQURSAL-001** - Deploy or designate a non-critical testnet
  contract implementing the timelock-controlled upgrade interface. The current
  manifest's `upgradable_contract` entry is explicitly undeployed.
- **UPGRADE-REHQURSAL-002** - The existing strict backend drift check reports
  missing crowdfund environment variables in the web and mobile example files.
  Resolve this configuration drift before using that check as the final
  rehearsal gate.
- Add any operational gaps discovered during the live run here and file each
  one as a separate issue with the captured evidence attached.
