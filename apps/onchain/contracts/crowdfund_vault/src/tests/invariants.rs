// Property-based invariant tests for the crowdfund_vault contract.
// Each test is tagged with: Feature: invariant-hardening, Property N: <description>

extern crate std;
use std::vec::Vec as StdVec;

use crate::errors::CrowdfundError;
use crate::storage::{DataKey, ProtocolStats};
use crate::{CrowdfundVaultContract, CrowdfundVaultContractClient};
use proptest::prelude::*;
use soroban_sdk::{
    symbol_short,
    testutils::Address as _,
    token::{StellarAssetClient, TokenClient},
    Address, Env,
};

// ─── Shared helpers ──────────────────────────────────────────────────────────

/// Create a Stellar asset contract and return both a TokenClient and a
/// StellarAssetClient (the latter is used to mint tokens in tests).
fn create_token<'a>(env: &Env, admin: &Address) -> (TokenClient<'a>, StellarAssetClient<'a>) {
    let addr = env.register_stellar_asset_contract_v2(admin.clone());
    (
        TokenClient::new(env, &addr.address()),
        StellarAssetClient::new(env, &addr.address()),
    )
}

/// Set up a fresh Env, register the contract, initialize it, and return
/// (client, admin, token_client, token_admin_client).
///
/// The caller is responsible for creating projects and minting tokens as needed.
pub fn setup_vault<'a>(
    env: &'a Env,
) -> (
    CrowdfundVaultContractClient<'a>,
    Address,
    TokenClient<'a>,
    StellarAssetClient<'a>,
) {
    let admin = Address::generate(env);
    let (token_client, token_admin_client) = create_token(env, &admin);

    let contract_id = env.register(CrowdfundVaultContract, ());
    let client = CrowdfundVaultContractClient::new(env, &contract_id);

    client.initialize(&admin);

    (client, admin, token_client, token_admin_client)
}

/// Mint `amount` tokens to `user` and deposit them into `project_id`.
pub fn do_deposit(
    _env: &Env,
    client: &CrowdfundVaultContractClient,
    token_admin: &StellarAssetClient,
    user: &Address,
    project_id: u64,
    amount: i128,
) {
    token_admin.mint(user, &amount);
    client.deposit(user, &project_id, &amount);
}

/// Read ProtocolStats directly from contract instance storage.
fn read_protocol_stats(env: &Env, contract_id: &Address) -> ProtocolStats {
    env.as_contract(contract_id, || {
        env.storage()
            .instance()
            .get(&DataKey::ProtocolStats)
            .unwrap_or(ProtocolStats {
                tvl: 0,
                cumulative_volume: 0,
            })
    })
}

// ─── Proptest strategies ─────────────────────────────────────────────────────

/// Strategy that generates a single valid deposit amount.
pub fn valid_amount() -> impl Strategy<Value = i128> {
    1i128..=1_000_000_000i128
}

/// Strategy that generates a sequence of 1–8 valid deposit amounts.
pub fn deposit_sequence() -> impl Strategy<Value = StdVec<i128>> {
    proptest::collection::vec(valid_amount(), 1..=8)
}

// ─── Property 4: TVL Tracking Invariant ──────────────────────────────────────

#[cfg(test)]
mod prop4_tvl_tracking {
    use super::*;

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(1000))]

        // Feature: invariant-hardening, Property 4: tvl tracks deposits and withdrawals exactly
        // Validates: Requirements 3.1, 3.2, 3.3
        #[test]
        fn tvl_tracks_deposits_and_withdrawals(amounts in deposit_sequence()) {
            let env = Env::default();
            env.mock_all_auths();

            let (client, admin, token_client, token_admin) = setup_vault(&env);
            let contract_id = client.address.clone();
            let owner = Address::generate(&env);

            let project_id = client.create_project(
                &owner,
                &symbol_short!("proj"),
                &1_000_000_000_000i128,
                &token_client.address,
            );

            let user = Address::generate(&env);

            for amount in &amounts {
                let stats_before = read_protocol_stats(&env, &contract_id);
                do_deposit(&env, &client, &token_admin, &user, project_id, *amount);
                let stats_after = read_protocol_stats(&env, &contract_id);

                // TVL must increase by exactly the deposit amount
                prop_assert_eq!(
                    stats_after.tvl,
                    stats_before.tvl + amount,
                    "TVL did not increase by deposit amount {}",
                    amount
                );
                // TVL must never be negative
                prop_assert!(stats_after.tvl >= 0, "TVL became negative after deposit");
            }

            // Approve milestone so we can withdraw
            client.approve_milestone(&admin, &project_id, &0u32);

            let balance = client.get_balance(&project_id);
            if balance > 0 {
                let withdraw_amount = balance / 2 + 1;
                let stats_before = read_protocol_stats(&env, &contract_id);
                client.withdraw(&project_id, &0u32, &withdraw_amount);
                let stats_after = read_protocol_stats(&env, &contract_id);

                // TVL must decrease by exactly the withdrawal amount
                prop_assert_eq!(
                    stats_after.tvl,
                    stats_before.tvl - withdraw_amount,
                    "TVL did not decrease by withdrawal amount {}",
                    withdraw_amount
                );
                // TVL must never be negative
                prop_assert!(stats_after.tvl >= 0, "TVL became negative after withdrawal");
            }
        }
    }
}

// ─── Property 5: Cumulative Volume Monotonicity ───────────────────────────────

#[cfg(test)]
mod prop5_cumulative_volume {
    use super::*;

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(1000))]

        // Feature: invariant-hardening, Property 5: cumulative_volume is non-decreasing
        // Validates: Requirements 3.4
        #[test]
        fn cumulative_volume_is_non_decreasing(amounts in deposit_sequence()) {
            let env = Env::default();
            env.mock_all_auths();

            let (client, _admin, token_client, token_admin) = setup_vault(&env);
            let contract_id = client.address.clone();
            let owner = Address::generate(&env);

            let project_id = client.create_project(
                &owner,
                &symbol_short!("proj"),
                &1_000_000_000_000i128,
                &token_client.address,
            );

            let user = Address::generate(&env);
            let mut prev_volume = read_protocol_stats(&env, &contract_id).cumulative_volume;

            for amount in &amounts {
                do_deposit(&env, &client, &token_admin, &user, project_id, *amount);
                let stats = read_protocol_stats(&env, &contract_id);

                prop_assert!(
                    stats.cumulative_volume >= prev_volume,
                    "cumulative_volume decreased: was {}, now {}",
                    prev_volume,
                    stats.cumulative_volume
                );
                prev_volume = stats.cumulative_volume;
            }
        }
    }
}

// ─── Property 6: Admin-Only Operations Reject Non-Admin ──────────────────────

#[cfg(test)]
mod prop6_admin_only {
    use super::*;

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(1000))]

        // Feature: invariant-hardening, Property 6: non-admin callers are rejected
        // Validates: Requirements 4.1
        #[test]
        fn non_admin_callers_are_rejected(_seed in 0u64..u64::MAX) {
            let env = Env::default();
            env.mock_all_auths();

            let (client, _admin, token_client, _token_admin) = setup_vault(&env);
            let owner = Address::generate(&env);

            let project_id = client.create_project(
                &owner,
                &symbol_short!("proj"),
                &1_000_000i128,
                &token_client.address,
            );

            // Generate a random non-admin address
            let non_admin = Address::generate(&env);

            // try_approve_milestone must return Unauthorized
            let result = client.try_approve_milestone(&non_admin, &project_id, &0u32);
            prop_assert_eq!(result, Err(Ok(CrowdfundError::Unauthorized)));

            // try_fund_matching_pool must return Unauthorized
            let result = client.try_fund_matching_pool(&non_admin, &token_client.address, &1i128);
            prop_assert_eq!(result, Err(Ok(CrowdfundError::Unauthorized)));

            // try_pause must return Unauthorized
            let result = client.try_pause(&non_admin);
            prop_assert_eq!(result, Err(Ok(CrowdfundError::Unauthorized)));

            // try_set_fee_config must return Unauthorized
            let treasury = Address::generate(&env);
            let result = client.try_set_fee_config(&non_admin, &100u32, &treasury);
            prop_assert_eq!(result, Err(Ok(CrowdfundError::Unauthorized)));
        }
    }
}

// ─── Property 7: Paused Vault Rejects State-Changing Operations ──────────────

#[cfg(test)]
mod prop7_paused_vault {
    use super::*;

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(1000))]

        // Feature: invariant-hardening, Property 7: paused vault rejects state-changing calls
        // Validates: Requirements 4.3
        #[test]
        fn paused_vault_rejects_operations(amount in valid_amount()) {
            let env = Env::default();
            env.mock_all_auths();

            let (client, admin, token_client, token_admin) = setup_vault(&env);
            let owner = Address::generate(&env);
            let user = Address::generate(&env);

            // Create a project and make a deposit before pausing
            let project_id = client.create_project(
                &owner,
                &symbol_short!("proj"),
                &1_000_000_000_000i128,
                &token_client.address,
            );
            do_deposit(&env, &client, &token_admin, &user, project_id, amount);
            client.approve_milestone(&admin, &project_id, &0u32);

            // Pause the vault
            client.pause(&admin);

            // try_deposit must return ContractPaused
            token_admin.mint(&user, &amount);
            let result = client.try_deposit(&user, &project_id, &amount);
            prop_assert_eq!(result, Err(Ok(CrowdfundError::ContractPaused)));

            // try_create_project must return ContractPaused
            let new_owner = Address::generate(&env);
            let result = client.try_create_project(
                &new_owner,
                &symbol_short!("p2"),
                &1_000_000i128,
                &token_client.address,
            );
            prop_assert_eq!(result, Err(Ok(CrowdfundError::ContractPaused)));

            // try_approve_milestone must return ContractPaused
            let result = client.try_approve_milestone(&admin, &project_id, &1u32);
            prop_assert_eq!(result, Err(Ok(CrowdfundError::ContractPaused)));

            // try_withdraw must return ContractPaused
            let result = client.try_withdraw(&project_id, &0u32, &1i128);
            prop_assert_eq!(result, Err(Ok(CrowdfundError::ContractPaused)));
        }
    }
}

// ─── Property 8: Non-Existent Project Returns ProjectNotFound ────────────────

#[cfg(test)]
mod prop8_project_not_found {
    use super::*;

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(1000))]

        // Feature: invariant-hardening, Property 8: operations on missing projects return ProjectNotFound
        // Validates: Requirements 4.4
        #[test]
        fn missing_project_returns_not_found(amount in valid_amount()) {
            let env = Env::default();
            env.mock_all_auths();

            let (client, admin, token_client, _token_admin) = setup_vault(&env);

            // Use a project ID that was never created (no projects exist, so any ID works)
            let nonexistent_id: u64 = 9_999_999;
            let user = Address::generate(&env);

            // try_deposit must return ProjectNotFound
            let result = client.try_deposit(&user, &nonexistent_id, &amount);
            prop_assert_eq!(result, Err(Ok(CrowdfundError::ProjectNotFound)));

            // try_withdraw must return ProjectNotFound
            let result = client.try_withdraw(&nonexistent_id, &0u32, &amount);
            prop_assert_eq!(result, Err(Ok(CrowdfundError::ProjectNotFound)));

            // try_get_balance must return ProjectNotFound
            let result = client.try_get_balance(&nonexistent_id);
            prop_assert_eq!(result, Err(Ok(CrowdfundError::ProjectNotFound)));

            // try_approve_milestone must return ProjectNotFound
            let result = client.try_approve_milestone(&admin, &nonexistent_id, &0u32);
            prop_assert_eq!(result, Err(Ok(CrowdfundError::ProjectNotFound)));

            // try_get_project must return ProjectNotFound
            let result = client.try_get_project(&nonexistent_id);
            prop_assert_eq!(result, Err(Ok(CrowdfundError::ProjectNotFound)));

            // Suppress unused variable warning
            let _ = token_client;
        }
    }
}

// ─── Property 9: Withdrawal Requires Milestone Approval ──────────────────────

#[cfg(test)]
mod prop9_withdrawal_requires_milestone {
    use super::*;

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(1000))]

        // Feature: invariant-hardening, Property 9: withdraw without approval returns MilestoneNotApproved
        // Validates: Requirements 5.1
        #[test]
        fn withdraw_without_approval_returns_milestone_not_approved(
            amounts in deposit_sequence(),
            withdraw_amount in valid_amount(),
        ) {
            let env = Env::default();
            env.mock_all_auths();

            let (client, _admin, token_client, token_admin) = setup_vault(&env);
            let owner = Address::generate(&env);
            let user = Address::generate(&env);

            let project_id = client.create_project(
                &owner,
                &symbol_short!("proj"),
                &1_000_000_000_000i128,
                &token_client.address,
            );

            // Make deposits but do NOT approve any milestone
            for amount in &amounts {
                do_deposit(&env, &client, &token_admin, &user, project_id, *amount);
            }

            // try_withdraw must return MilestoneNotApproved for any positive amount
            let result = client.try_withdraw(&project_id, &0u32, &withdraw_amount);
            prop_assert_eq!(
                result,
                Err(Ok(CrowdfundError::MilestoneNotApproved)),
                "Expected MilestoneNotApproved but got different result"
            );
        }
    }
}

// ─── Property 10: Withdrawal Respects Balance Cap ────────────────────────────

#[cfg(test)]
mod prop10_withdrawal_balance_cap {
    use super::*;

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(1000))]

        // Feature: invariant-hardening, Property 10: withdraw above balance returns InsufficientBalance
        // Validates: Requirements 5.2
        #[test]
        fn withdraw_above_balance_returns_insufficient(
            deposit_amount in valid_amount(),
            extra in 1i128..=1_000_000_000i128,
        ) {
            let env = Env::default();
            env.mock_all_auths();

            let (client, admin, token_client, token_admin) = setup_vault(&env);
            let owner = Address::generate(&env);
            let user = Address::generate(&env);

            let project_id = client.create_project(
                &owner,
                &symbol_short!("proj"),
                &1_000_000_000_000i128,
                &token_client.address,
            );

            // Deposit a random amount
            do_deposit(&env, &client, &token_admin, &user, project_id, deposit_amount);

            // Approve milestone 0
            client.approve_milestone(&admin, &project_id, &0u32);

            let balance = client.get_balance(&project_id);

            // Attempt to withdraw balance + extra (guaranteed to exceed balance)
            let over_amount = balance + extra;
            let result = client.try_withdraw(&project_id, &0u32, &over_amount);
            prop_assert_eq!(
                result,
                Err(Ok(CrowdfundError::InsufficientBalance)),
                "Expected InsufficientBalance when withdrawing {} but balance is {}",
                over_amount,
                balance
            );
        }
    }
}

// ─── Property 11: Quadratic Match Non-Negativity ─────────────────────────────

#[cfg(test)]
mod prop11_quadratic_match_non_negative {
    use super::*;

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(1000))]

        // Feature: invariant-hardening, Property 11: calculate_match >= 0 for any contributions
        // Validates: Requirements 6.1
        #[test]
        fn calculate_match_is_non_negative(
            contributor_amounts in proptest::collection::vec(valid_amount(), 0..=5),
        ) {
            let env = Env::default();
            env.mock_all_auths();

            let (client, _admin, token_client, token_admin) = setup_vault(&env);
            let owner = Address::generate(&env);

            let project_id = client.create_project(
                &owner,
                &symbol_short!("proj"),
                &1_000_000_000_000i128,
                &token_client.address,
            );

            // Each element in contributor_amounts is a unique contributor making one deposit
            for amount in &contributor_amounts {
                let contributor = Address::generate(&env);
                do_deposit(&env, &client, &token_admin, &contributor, project_id, *amount);
            }

            // calculate_match must always be >= 0
            let match_amount = client.calculate_match(&project_id);
            prop_assert!(
                match_amount >= 0,
                "calculate_match returned negative value: {}",
                match_amount
            );

            // Edge case: zero contributors → match == 0 (handled by empty vec case)
            if contributor_amounts.is_empty() {
                prop_assert_eq!(match_amount, 0, "Expected 0 match for zero contributors");
            }
        }
    }
}

// ─── Property 12: Distribute Match Invariant ─────────────────────────────────

#[cfg(test)]
mod prop12_distribute_match {
    use super::*;

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(1000))]

        // Feature: invariant-hardening, Property 12: distribute_match respects pool cap and updates balances correctly
        // Validates: Requirements 6.2, 6.3, 6.4
        #[test]
        fn distribute_match_respects_pool_cap(
            contributor_amounts in proptest::collection::vec(valid_amount(), 1..=5),
            pool_amount in valid_amount(),
        ) {
            let env = Env::default();
            env.mock_all_auths();

            let (client, admin, token_client, token_admin) = setup_vault(&env);
            let owner = Address::generate(&env);

            let project_id = client.create_project(
                &owner,
                &symbol_short!("proj"),
                &1_000_000_000_000i128,
                &token_client.address,
            );

            // Make deposits from unique contributors
            for amount in &contributor_amounts {
                let contributor = Address::generate(&env);
                do_deposit(&env, &client, &token_admin, &contributor, project_id, *amount);
            }

            // Fund the matching pool via admin call (fee_bps = 0, so no fee deduction).
            // fund_matching_pool only updates storage — no token transfer occurs.
            // distribute_match also only updates storage when fee_bps = 0, so no real
            // token balance is needed on the contract for this property test.
            client.fund_matching_pool(&admin, &token_client.address, &pool_amount);

            // Record state before distribute_match
            let pool_before = client.get_matching_pool_balance(&token_client.address);
            let balance_before = client.get_balance(&project_id);
            let match_amount = client.calculate_match(&project_id);

            // Call distribute_match
            let distributed = client.distribute_match(&project_id);

            // The distributed amount must equal min(match_amount, pool_before)
            let expected_distributed = if pool_before < match_amount {
                pool_before
            } else {
                match_amount
            };
            prop_assert_eq!(
                distributed,
                expected_distributed,
                "distributed {} != min(match={}, pool={})={}",
                distributed,
                match_amount,
                pool_before,
                expected_distributed
            );

            // Pool balance must decrease by exactly the distributed amount
            let pool_after = client.get_matching_pool_balance(&token_client.address);
            prop_assert_eq!(
                pool_after,
                pool_before - distributed,
                "pool decreased by {} instead of {}",
                pool_before - pool_after,
                distributed
            );

            // Project balance must increase by exactly the distributed amount (fee_bps = 0)
            let balance_after = client.get_balance(&project_id);
            prop_assert_eq!(
                balance_after,
                balance_before + distributed,
                "balance increased by {} instead of {}",
                balance_after - balance_before,
                distributed
            );
        }
    }
}
