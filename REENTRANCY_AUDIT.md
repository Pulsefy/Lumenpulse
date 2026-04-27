## Scope
Reviewed contract files:
- apps/onchain/contracts/crowdfund_vault/src/lib.rs
- apps/onchain/contracts/matching_pool/src/lib.rs
- apps/onchain/contracts/vesting-wallet/src/lib.rs
- apps/onchain/contracts/reentrancy-guard/src/lib.rs
- apps/onchain/contracts/contributor_registry/src/lib.rs
- apps/onchain/contracts/lumen_token/src/lib.rs
- apps/onchain/contracts/lumenpulse-curation/src/lib.rs
- apps/onchain/contracts/notification_interface/src/lib.rs
- apps/onchain/contracts/pricing_adapter/src/lib.rs
- apps/onchain/contracts/upgradable-contract/src/lib.rs

## Guarded Functions
| Contract | Function | Guard Applied | CEI Reordered | Notes |
|---|---|---|---|---|
| `CrowdfundVaultContract` | `refund_contributors` | Yes (`with_reentrancy_guard`) | Yes | Contribution entries removed before token transfer in loop. |
| `CrowdfundVaultContract` | `clawback_contribution` | Yes (`with_reentrancy_guard`) | Yes | Contribution/balance state updated before transfer out. |
| `CrowdfundVaultContract` | `deposit` | Yes (`with_reentrancy_guard`) | Yes | State/bookkeeping updated before token transfer + notifier callback. |
| `CrowdfundVaultContract` | `withdraw` | Yes (`with_reentrancy_guard`) | Yes | Balance/withdraw totals updated before divest and payouts. |
| `CrowdfundVaultContract` | `fund_reward_pool` | Yes (`with_reentrancy_guard`) | Yes | Reward-pool state updated before transfer in. |
| `CrowdfundVaultContract` | `distribute_match` | Yes (`with_reentrancy_guard`) | Yes | Pool/project accounting updated before fee transfer. |
| `CrowdfundVaultContract` | `batch_payout` | Yes (`with_reentrancy_guard`) | Yes | Pool balance decremented before recipient payout loop. |
| `CrowdfundVaultContract` | `invest_idle_funds` | Yes (`with_reentrancy_guard`) | Yes | Guarded external entrypoint; internal invest flow reordered. |
| `CrowdfundVaultContract` | `divest_funds` | Yes (`with_reentrancy_guard`) | Yes | Guarded external entrypoint; internal divest flow reordered. |
| `MatchingPoolContract` | `fund_pool` | Yes (`with_reentrancy_guard`) | Yes | Round/pool accounting updated before token transfer in. |
| `MatchingPoolContract` | `distribute_matching_funds` | Yes (`with_reentrancy_guard`) | Yes | Distribution state finalized before transfer loop. |
| `VestingWalletContract` | `create_vesting` | Yes (`with_reentrancy_guard`) | Yes | Delegates to internal flow; internal state stored before transfers. |
| `VestingWalletContract` | `create_vesting_with_milestone` | Yes (`with_reentrancy_guard`) | Yes | Delegates to internal flow with milestone cross-contract read. |
| `VestingWalletContract` | `claim` | Yes (`with_reentrancy_guard`) | Yes | Claimed amount/storage updated before transfer out. |
| `VestingWalletContract` | `get_claimable` | Yes (`with_reentrancy_guard`) | N/A | Guarded due possible cross-contract milestone lookup. |
| `VestingWalletContract` | `get_available_amount` | Yes (`with_reentrancy_guard`) | N/A | Guarded due possible cross-contract milestone lookup. |

## Contracts with No External Calls
Reviewed contracts not requiring this vault-focused reentrancy guard rollout:
- `apps/onchain/contracts/contributor_registry/src/lib.rs` (registry/multisig control plane; no vault asset transfer flow).
- `apps/onchain/contracts/notification_interface/src/lib.rs` (interface-only contract).
- `apps/onchain/contracts/pricing_adapter/src/lib.rs` (oracle/price adapter; no vault asset transfer flow).
- `apps/onchain/contracts/upgradable-contract/src/lib.rs` (upgrade/counter example; no vault asset transfer flow).

## Storage Mechanism
Used Soroban instance storage with explicit key `symbol_short!("REENTRANT")` in shared crate `apps/onchain/contracts/reentrancy-guard/src/lib.rs`.

Reason:
- Workspace is Soroban (`soroban-sdk`), not EVM.
- Requirement calls for instance storage lock flag for broad Soroban compatibility.

## Residual Risk
- No unguarded external asset-transfer/cross-contract entrypoints remain in the scoped vault contracts (`crowdfund_vault`, `matching_pool`, `vesting-wallet`).
- `lumenpulse-curation` contains token-transfer flows but is outside this vault hardening scope; if scope expands to all asset-bearing contracts, the same shared guard pattern should be applied there.

## Test Coverage Summary
- `apps/onchain/contracts/reentrancy-guard/src/lib.rs`
  - Guard state machine: acquire success, double-acquire failure, release reset, fresh-env behavior.
- `apps/onchain/contracts/crowdfund_vault/src/test.rs`
  - Locked withdraw reverts with `CrowdfundError::Reentrancy`.
  - Lock persistence after failed guarded call.
  - Sequential guarded calls succeed and guard resets.
  - CEI-oriented assertion for withdraw state/balance updates.
- `apps/onchain/contracts/matching_pool/src/test.rs`
  - Locked fund-pool reverts with `MatchingPoolError::Reentrancy`.
  - Sequential guarded fund-pool calls succeed and guard resets.
  - CEI-oriented assertion for fund-pool state before token balance check.
- `apps/onchain/contracts/vesting-wallet/src/test.rs`
  - Locked claim reverts with `VestingError::Reentrancy`.
  - Sequential guarded claims succeed and guard resets.
  - CEI-oriented assertion for claim state update before token balance check.
