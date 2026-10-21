# Cross-Contract Call Failure Handling

Scope: the funding path `crowdfund_vault` → `matching_pool` → `treasury`, with
notification fan-out (`crowdfund_vault` subscribers and `notification_broker`).
Tracking issue: #1622.

## Execution model

Soroban runs each top-level invocation atomically. A downstream call made
through a generated client (`client.method(..)`) that traps or returns an
error aborts the caller and rolls back **every** storage write and token
transfer made earlier in that invocation, including in other contracts and the
caller's idempotency `request_id` claim. A partial state within one invocation
is therefore impossible unless the caller uses `try_*` and swallows the error.

The only `try_*` call sites on this path are notification fan-out, which is
deliberately best-effort and moves no value.

There are no direct contract calls between `crowdfund_vault`, `matching_pool`
and `treasury` other than `crowdfund_vault::allocate_to_streaming_treasury` →
`treasury::allocate_budget`. Moving funds between the other stages is
orchestrated off-chain, one invocation per step, so each step is atomic on its
own.

## Call-site inventory

| # | Caller function | Downstream call | On failure | Test |
|---|---|---|---|---|
| 1 | `crowdfund_vault::deposit` | `token.transfer(user → vault)` | Full revert; request id reusable | `deposit_token_failure_reverts_and_request_id_is_reusable`, `deposit_without_funds_is_not_credited` |
| 2 | `crowdfund_vault::deposit` | `subscriber.try_on_notify` (each) | Ignored; deposit commits; subscriber's own writes rolled back | `failing_subscriber_never_blocks_deposit` |
| 3 | `crowdfund_vault::withdraw` | `token.transfer(vault → fee treasury)` | Full revert | `withdraw_fee_leg_failure_reverts_both_legs` |
| 4 | `crowdfund_vault::withdraw` | `token.transfer(vault → owner)` | Full revert, including the fee already sent | `withdraw_owner_leg_failure_reverts_fee_already_sent` |
| 5 | `crowdfund_vault::withdraw` (auto-divest) | `yield_provider.withdraw` | Full revert | `yield_withdraw_failure_reverts_auto_divesting_withdraw` |
| 6 | `crowdfund_vault::invest_idle_funds` | `token.transfer(vault → provider)` | Full revert | `yield_token_leg_failure_reverts_invest` |
| 7 | `crowdfund_vault::invest_idle_funds` | `yield_provider.deposit` | Full revert, including the token leg | `yield_deposit_failure_reverts_invest` |
| 8 | `crowdfund_vault::allocate_to_streaming_treasury` | `token.transfer(vault → admin)` | Full revert | `treasury_allocation_token_leg_failures_revert` |
| 9 | `crowdfund_vault::allocate_to_streaming_treasury` | `treasury.allocate_budget` (errors: `NotInitialized`, `Unauthorized`, `AlreadyExecuted`, `Insolvent`, not a contract) | Full revert; vault request id reusable | `treasury_rejection_reverts_allocation_and_is_retryable`, `treasury_replayed_request_id_reverts_allocation` |
| 10 | `treasury::allocate_budget` | `token.transfer(admin → treasury)` | Full revert of the whole allocation | `treasury_allocation_token_leg_failures_revert` |
| 11 | `matching_pool::fund_pool` | `token.transfer(funder → pool)` | Full revert | `fund_pool_token_failure_leaves_pool_unchanged` |
| 12 | `matching_pool::distribute_matching_funds` | `token.transfer(pool → owner)` (each) | Full revert of all payouts, round stays undistributed | `distribution_failure_mid_loop_reverts_every_payout` |
| 13 | `notification_broker::notify` | `listener.try_on_notify` (each) | Ignored; remaining listeners still notified | best-effort by construction |
| 14 | `crowdfund_vault`: `refund_contributors`, `clawback_contribution`, `fund_reward_pool`, `distribute_match`, `batch_payout`, `execute_emergency_migration` | `token.transfer` | Full revert | atomic via the same mechanism as 1/3/4 |
| 15 | `treasury`: `claim`, `cancel_stream`, `emergency_stop`, `allocate_budget_with_cliff` | `token.transfer` | Full revert | atomic via the same mechanism as 10 |

Vault tests live in `apps/onchain/contracts/crowdfund_vault/src/tests/cross_contract_failures.rs`,
matching-pool tests in `apps/onchain/contracts/matching_pool/src/tests/cross_contract_failures.rs`.
Failures are injected with `test_utils::FaultyToken`, which traps any transfer
to a chosen recipient, and with mock subscribers and yield providers that trap.

## Defects fixed

- **Subscriber failure blocked deposits.** `crowdfund_vault::notify_subscribers`
  called `on_notify` directly, so one failing subscriber reverted every deposit.
  It now uses `try_on_notify`.
- **Treasury allocation was funded twice.** `allocate_to_streaming_treasury`
  sent `amount` to the treasury, then `treasury::allocate_budget` pulled another
  `amount` from `admin`. The vault now releases the funds to `admin`, and the
  treasury pulls them, so the treasury receives exactly `amount`, and the admin
  is not charged. The allocation now also decrements vault TVL.
- **Deposits credited without funds.** `deposit` skipped the token pull when the
  user's balance was short but still credited the contribution. The pull is now
  unconditional, so a short balance reverts the deposit.

## Reachable partial states and recovery

No partial state can arise within one invocation. These states can persist
**between** invocations:

| State | How it arises | Recovery |
|---|---|---|
| Any reverted call above | Downstream fault | Clear the fault and resubmit with the **same** `request_id`; the claim was rolled back. |
| Matching round finalized, not distributed | `distribute_matching_funds` reverted (e.g. an owner address rejects the token) | Pool and round are untouched. Fix or replace the offending owner address and call `distribute_matching_funds` again. It pays out exactly once (`MatchAlreadyDistributed` thereafter). |
| Subscriber missed a notification | Subscriber trapped during `try_on_notify` | Delivery is best-effort. Subscribers reconcile from the vault's `DepositEvent`/`WithdrawEvent` stream. Remove a persistently failing subscriber with `remove_subscriber`. |
| Milestone funds approved but no stream | `allocate_to_streaming_treasury` reverted | Project balance is intact. Fix the treasury (initialize it with the vault admin, or use a fresh `request_id` if the treasury already consumed one) and retry, or pay out via `withdraw`. |
| Principal held by a failing yield provider | Provider's `withdraw` traps | Withdrawals up to the local (uninvested) balance still succeed. Larger withdrawals revert cleanly until the provider is repaired. The invested amount stays recorded in `ProjectInvestedBalance`, so nothing is double-counted. |

Not covered by `try_*`: running out of CPU/memory budget inside a subscriber
cannot be caught and still aborts the whole transaction. Keep subscriber
lists short and subscribers cheap.
