# Emergency Pause Drill (Testnet)

This runbook verifies the matching-pool emergency pause path without touching mainnet. Run it only with disposable testnet rounds and accounts.

## What the pause scopes protect

| Scope | Must block | Must remain available |
| --- | --- | --- |
| `Contribution` | `fund_pool`, `record_contribution` | payout, governance, read-only queries |
| `Payout` | `distribute_matching_funds` | contribution, governance, read-only queries |
| `Governance` | `create_round`, `finalize_round`, `approve_project`, `remove_project`, `set_round_cap`, `set_admin`, `upgrade` | contribution, payout, read-only queries |

The contract already has focused regression tests for each row. Run them before a live drill:

```bash
cargo test -p matching_pool test_pause_contribution_scope -- --nocapture
cargo test -p matching_pool test_pause_payout_scope_blocks_distribute -- --nocapture
cargo test -p matching_pool test_pause_governance_scope -- --nocapture
cargo test -p matching_pool test_read_queries_always_available_under_all_scopes_paused -- --nocapture
```

These tests also cover unpause recovery and verify that operations outside the selected scope remain usable.

## Testnet prerequisites

1. Install the current `stellar` CLI and configure the `testnet` network.
2. Configure a local key named `testnet-admin` whose public key is the matching-pool admin.
3. Use the canonical deployment from `apps/onchain/testnet-manifest.json`.
4. Have a disposable active round with an eligible project for the contribution check.
5. Keep the webapp and mobile app pointed at testnet during the client checks.

```bash
export MATCHING_POOL_CONTRACT_ID="CBQJ2E2MPYRCQDHZZYJXHRKUTCTIJFO55AVGHB2WDZSLS2OOENUDC6HH"
export ADMIN_PUBLIC_KEY="$(stellar keys address testnet-admin)"
```

Confirm the configured key matches the admin expected by the deployment before changing pause state.

## Contribution-scope drill

Pause only contributions:

```bash
stellar contract invoke \
  --id "$MATCHING_POOL_CONTRACT_ID" \
  --source testnet-admin \
  --network testnet \
  -- pause_scope \
  --admin "$ADMIN_PUBLIC_KEY" \
  --scope Contribution
```

Verify the scope reports paused:

```bash
stellar contract invoke \
  --id "$MATCHING_POOL_CONTRACT_ID" \
  --network testnet \
  -- is_paused \
  --scope Contribution
```

Expected result: `true`.

Attempt `record_contribution` or `fund_pool` against the disposable active round. The Soroban diagnostic must contain:

```text
Error(Contract, #19)
```

`#19` is `MatchingPoolError::ContributionScopePaused`; it is intentionally stable so the backend and clients can distinguish an emergency pause from a generic transaction failure.

While the contribution scope is paused, verify a read-only query such as `get_round` still succeeds. Governance and payout scopes must remain reported as unpaused.

## Client verification while paused

### Webapp

1. Open a testnet project and submit a contribution while its contribution path is paused.
2. The transaction must not be submitted successfully.
3. The transaction receipt must display:

```text
Contributions are temporarily paused. Please try again after the operator resumes them.
```

The web contribution error normalizer recognizes both the matching-pool scoped pause (`#19`) and the crowdfund-vault global pause (`#11`), because the browser contribution path can surface either diagnostic depending on where the testnet transaction is rejected.

### Mobile

1. Open the same testnet project in the mobile app and submit a contribution.
2. When the backend returns `details.contractErrorCode: 19`, or forwards the raw `Error(Contract, #19)` diagnostic, the contribution flow must remain on the screen and show the same friendly pause message.
3. Confirm no success receipt or transaction hash is shown for the rejected attempt.

The backend maps matching-pool `#19` to `STEL_CONTRIBUTIONS_PAUSED` (`STEL_011`) with HTTP 503 so clients do not need to parse contract diagnostics themselves.

## Unpause and recovery

Always unpause in a `finally`/cleanup step, even if an earlier verification fails:

```bash
stellar contract invoke \
  --id "$MATCHING_POOL_CONTRACT_ID" \
  --source testnet-admin \
  --network testnet \
  -- unpause_scope \
  --admin "$ADMIN_PUBLIC_KEY" \
  --scope Contribution
```

Verify `is_paused --scope Contribution` now returns `false`, then repeat the same disposable contribution. It must succeed and previously recorded round state must remain intact.

Repeat the pause / verify / unpause sequence for `Payout` and `Governance`. Use the contract regression tests above as the canonical operation matrix when preparing the required round state for those scopes.

## Failure and recovery checklist

- If the pause transaction fails, do not continue the drill; verify the admin key and contract ID.
- If a blocked operation returns anything other than its scope-specific error, capture the full Soroban diagnostic before retrying.
- If an unrelated scope is blocked, stop and treat it as a contract regression.
- If a client shows a raw `Error(Contract, #N)` string, capture the request/response and treat it as a client error-mapping regression.
- If unpause succeeds but writes still fail, verify `is_paused` for all three scopes and run the matching-pool pause regression tests before any further operator action.
- Never leave a testnet contract paused after the drill.

## Evidence to attach to an incident or release ticket

Record the testnet contract ID, UTC start/end time, transaction hashes for each pause/unpause call, the observed contract error code, screenshots from web/mobile, and the successful post-unpause contribution hash.
