# Deployment

Contracts are deployed to testnet with the **Deploy** workflow
(`.github/workflows/deploy.yml`) from a release produced by the Release workflow.

```bash
gh workflow run deploy.yml -f version=v1.2.4      # deploy a release
gh workflow run deploy.yml -f action=rollback     # re-activate the previous deployment
```

## Approval gate

The job runs in the `testnet` GitHub environment. Configure it under
*Settings -> Environments -> testnet* with **required reviewers**; the job does not
start until one of them approves. Put the deployment settings there too:

| Kind | Name |
| --- | --- |
| Secret | `ADMIN_SECRET` |
| Variable | `SOROBAN_RPC_URL`, `HORIZON_URL`, `NETWORK_PASSPHRASE` |

## Steps

1. **Select** - resolve the release tag and download its release assets.
2. **Verify** - recompute the SHA-256 of every WASM and compare with
   `wasm-hashes.json`; any mismatch aborts (`scripts/deploy/verify-hashes.mjs`).
3. **Deploy** - `npm run --prefix scripts deploy`.
4. **Smoke test** - `scripts/smoke.ts` against the deployed contracts.
5. **Record** - a deployment record (who, when, version, commit, WASM hashes,
   contract ids) is uploaded as the artifact `deployment-record-<env>`, retained
   for 365 days.

## Rollback

`-f action=rollback` finds the previous recorded deployment for the environment
(`scripts/deploy/select-rollback.mjs`), re-activates its manifest and smoke-tests
it. The rollback is itself recorded. A rollback does not undo contract state
changes made after the failed deployment.

## Scope

The workflow deploys Soroban contracts. The backend, webapp and data-processing
services are rolled through staging (`STAGING.md`).
