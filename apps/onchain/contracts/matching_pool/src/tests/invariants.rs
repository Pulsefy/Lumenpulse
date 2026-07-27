//! Round-lifecycle invariant suite for `matching_pool`.
//!
//! Covers the open → contribute → finalize → close-style flow
//! (`create_round` → `record_contribution`/`fund_pool` → `finalize_round` →
//! `distribute_matching_funds`). The invariants asserted here (`INV-1`
//! .. `INV-7`) are the ones documented in
//! `apps/onchain/contracts/ROUND_LIFECYCLE_INVARIANTS.md`, which also
//! explains the shared vocabulary this suite uses with the equivalent
//! `crowdfund_vault` suite (`crowdfund_vault/src/tests/round_lifecycle.rs`).
//!
//! Every assertion message names the `INV-<n>` it checks plus the concrete
//! values involved, so a proptest failure's shrunk counterexample and panic
//! message are enough to diagnose the break without re-running under a
//! debugger.

extern crate std;

use crate::errors::MatchingPoolError;
use crate::{MatchingPoolContract, MatchingPoolContractClient};
use proptest::prelude::*;
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    vec, Address, Env, Symbol,
};

// ─── Shared helpers ──────────────────────────────────────────────────────────

const START: u64 = 1_000;
const END: u64 = 100_000;

fn create_token<'a>(env: &Env, admin: &Address) -> (TokenClient<'a>, StellarAssetClient<'a>) {
    let addr = env.register_stellar_asset_contract_v2(admin.clone());
    (
        TokenClient::new(env, &addr.address()),
        StellarAssetClient::new(env, &addr.address()),
    )
}

/// Fresh Env + initialized contract + token, admin set as `Address`.
fn setup<'a>(
    env: &Env,
) -> (
    MatchingPoolContractClient<'a>,
    Address,
    TokenClient<'a>,
    StellarAssetClient<'a>,
) {
    let admin = Address::generate(env);
    let (token, token_admin) = create_token(env, &admin);
    let contract_id = env.register(MatchingPoolContract, ());
    let client = MatchingPoolContractClient::new(env, &contract_id);
    client.initialize(&admin);
    (client, admin, token, token_admin)
}

/// Open a round with the fixed [START, END] window and move the ledger to
/// START so contributions are immediately valid.
fn open_round(
    env: &Env,
    client: &MatchingPoolContractClient,
    admin: &Address,
    token: &TokenClient,
) -> u64 {
    env.ledger().set_timestamp(START);
    client.create_round(admin, &symbol_short!("Round"), &token.address, &START, &END)
}

/// Mint `amount` to `funder` and fund `round_id`'s matching pool with it.
fn do_fund_pool(
    client: &MatchingPoolContractClient,
    token_admin: &StellarAssetClient,
    funder: &Address,
    round_id: u64,
    amount: i128,
) {
    token_admin.mint(funder, &amount);
    client.fund_pool(funder, &round_id, &amount);
}

fn valid_amount() -> impl Strategy<Value = i128> {
    1i128..=1_000_000_000i128
}

// ─── open phase (INV-1, INV-5, INV-6, INV-7) ─────────────────────────────────

#[cfg(test)]
mod open_phase {
    use super::*;

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]

        // INV-2, INV-7: a round can only be opened with start < end.
        #[test]
        fn create_round_rejects_inverted_dates(start in 1u64..=1_000_000u64, extra in 0u64..=1_000_000u64) {
            let env = Env::default();
            env.mock_all_auths();
            let (client, admin, token, _) = setup(&env);

            let end = start.saturating_sub(extra);
            // Only exercise the invalid case (end <= start); skip otherwise.
            prop_assume!(end <= start);

            let result = client.try_create_round(
                &admin,
                &symbol_short!("Round"),
                &token.address,
                &start,
                &end,
            );
            prop_assert_eq!(
                result,
                Err(Ok(MatchingPoolError::InvalidRoundDates)),
                "INV-2/INV-7: create_round(start={}, end={}) should be rejected",
                start,
                end
            );
        }

        // INV-5: only the admin may open a round.
        #[test]
        fn create_round_rejects_non_admin(_seed in 0u64..u64::MAX) {
            let env = Env::default();
            env.mock_all_auths();
            let (client, _admin, token, _) = setup(&env);
            let intruder = Address::generate(&env);

            let result = client.try_create_round(
                &intruder,
                &symbol_short!("Round"),
                &token.address,
                &START,
                &END,
            );
            prop_assert_eq!(
                result,
                Err(Ok(MatchingPoolError::Unauthorized)),
                "INV-5: non-admin must not be able to open a round"
            );
        }

        // INV-6: a paused contract must reject new rounds.
        #[test]
        fn create_round_rejects_while_paused(_seed in 0u64..u64::MAX) {
            let env = Env::default();
            env.mock_all_auths();
            let (client, admin, token, _) = setup(&env);
            client.pause(&admin);

            let result = client.try_create_round(
                &admin,
                &symbol_short!("Round"),
                &token.address,
                &START,
                &END,
            );
            prop_assert_eq!(
                result,
                Err(Ok(MatchingPoolError::ContractPaused)),
                "INV-6: paused contract must reject create_round"
            );
        }

        // INV-1: a freshly opened round starts ACTIVE with an empty pool.
        #[test]
        fn new_round_starts_active_and_empty(_seed in 0u64..u64::MAX) {
            let env = Env::default();
            env.mock_all_auths();
            let (client, admin, token, _) = setup(&env);

            let round_id = open_round(&env, &client, &admin, &token);

            prop_assert_eq!(
                client.get_round_status(&round_id),
                Symbol::new(&env, "ACTIVE"),
                "INV-1: new round must start ACTIVE"
            );
            prop_assert_eq!(
                client.get_pool_balance(&round_id),
                0i128,
                "INV-1: new round must start with an empty pool"
            );
        }
    }
}

// ─── contribute phase (INV-2, INV-3, INV-6) ──────────────────────────────────

#[cfg(test)]
mod contribute_phase {
    use super::*;

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]

        // INV-2: contributions before start_time or after end_time are rejected.
        #[test]
        fn contribution_outside_window_rejected(before_start in any::<bool>(), amount in valid_amount()) {
            let env = Env::default();
            env.mock_all_auths();
            let (client, admin, token, _) = setup(&env);
            let round_id = open_round(&env, &client, &admin, &token);
            client.approve_project(&admin, &round_id, &1u64);

            env.ledger().set_timestamp(if before_start { START - 1 } else { END + 1 });

            let contributor = Address::generate(&env);
            let result = client.try_record_contribution(&round_id, &1u64, &contributor, &amount);
            prop_assert_eq!(
                result,
                Err(Ok(MatchingPoolError::RoundNotActive)),
                "INV-2: contribution outside [{}, {}] must be rejected",
                START,
                END
            );
        }

        // INV-2: contributions to a project that was never approved are rejected.
        #[test]
        fn contribution_to_ineligible_project_rejected(amount in valid_amount()) {
            let env = Env::default();
            env.mock_all_auths();
            let (client, admin, token, _) = setup(&env);
            let round_id = open_round(&env, &client, &admin, &token);

            let contributor = Address::generate(&env);
            let result = client.try_record_contribution(&round_id, &1u64, &contributor, &amount);
            prop_assert_eq!(
                result,
                Err(Ok(MatchingPoolError::ProjectNotEligible)),
                "INV-2: contribution to a non-approved project must be rejected"
            );
        }

        // INV-2/INV-1: contributions after finalize are rejected, even inside the
        // original window.
        #[test]
        fn contribution_after_finalize_rejected(amount in valid_amount()) {
            let env = Env::default();
            env.mock_all_auths();
            let (client, admin, token, _) = setup(&env);
            let round_id = open_round(&env, &client, &admin, &token);
            client.approve_project(&admin, &round_id, &1u64);

            env.ledger().set_timestamp(END + 1);
            client.finalize_round(&admin, &round_id);

            let contributor = Address::generate(&env);
            let result = client.try_record_contribution(&round_id, &1u64, &contributor, &amount);
            prop_assert_eq!(
                result,
                Err(Ok(MatchingPoolError::RoundAlreadyFinalized)),
                "INV-1: contributions must not be accepted once a round is finalized"
            );
        }

        // INV-3: recorded per-project contributions equal the exact sum of amounts.
        #[test]
        fn contribution_totals_are_exact(amounts in proptest::collection::vec(valid_amount(), 1..=6)) {
            let env = Env::default();
            env.mock_all_auths();
            let (client, admin, token, _) = setup(&env);
            let round_id = open_round(&env, &client, &admin, &token);
            client.approve_project(&admin, &round_id, &1u64);

            let mut expected_total: i128 = 0;
            for amount in &amounts {
                let contributor = Address::generate(&env);
                client.record_contribution(&round_id, &1u64, &contributor, amount);
                expected_total += amount;

                prop_assert_eq!(
                    client.get_project_contributions(&round_id, &1u64),
                    expected_total,
                    "INV-3: cumulative contributions must equal the exact sum of deposits so far"
                );
            }
            prop_assert_eq!(
                client.get_contributor_count(&round_id, &1u64) as usize,
                amounts.len(),
                "INV-3: one unique contributor per amount must be counted exactly once"
            );
        }

        // INV-6: paused contract rejects fund_pool.
        #[test]
        fn fund_pool_rejected_while_paused(amount in valid_amount()) {
            let env = Env::default();
            env.mock_all_auths();
            let (client, admin, token, token_admin) = setup(&env);
            let round_id = open_round(&env, &client, &admin, &token);
            client.pause(&admin);

            token_admin.mint(&admin, &amount);
            let result = client.try_fund_pool(&admin, &round_id, &amount);
            prop_assert_eq!(
                result,
                Err(Ok(MatchingPoolError::ContractPaused)),
                "INV-6: paused contract must reject fund_pool"
            );
        }

        // INV-3: fund_pool increases the round pool by exactly the funded amount.
        #[test]
        fn fund_pool_increases_pool_exactly(amounts in proptest::collection::vec(valid_amount(), 1..=6)) {
            let env = Env::default();
            env.mock_all_auths();
            let (client, admin, token, token_admin) = setup(&env);
            let round_id = open_round(&env, &client, &admin, &token);

            let mut expected: i128 = 0;
            for amount in &amounts {
                do_fund_pool(&client, &token_admin, &admin, round_id, *amount);
                expected += amount;
                prop_assert_eq!(
                    client.get_pool_balance(&round_id),
                    expected,
                    "INV-3: pool balance must track funded amounts exactly"
                );
            }
        }
    }
}

// ─── finalize phase (INV-1, INV-2, INV-4, INV-5) ─────────────────────────────

#[cfg(test)]
mod finalize_phase {
    use super::*;

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]

        // INV-2: a round cannot be finalized before its end_time.
        #[test]
        fn finalize_before_end_rejected(offset in 0u64..=(END - START)) {
            let env = Env::default();
            env.mock_all_auths();
            let (client, admin, token, _) = setup(&env);
            let round_id = open_round(&env, &client, &admin, &token);

            env.ledger().set_timestamp(START + offset);
            let result = client.try_finalize_round(&admin, &round_id);
            prop_assert_eq!(
                result,
                Err(Ok(MatchingPoolError::RoundStillOpen)),
                "INV-2: finalize_round before end_time ({}) must be rejected, tried at {}",
                END,
                START + offset
            );
        }

        // INV-5: only the admin may finalize a round.
        #[test]
        fn finalize_rejects_non_admin(_seed in 0u64..u64::MAX) {
            let env = Env::default();
            env.mock_all_auths();
            let (client, admin, token, _) = setup(&env);
            let round_id = open_round(&env, &client, &admin, &token);
            let intruder = Address::generate(&env);

            env.ledger().set_timestamp(END + 1);
            let result = client.try_finalize_round(&intruder, &round_id);
            prop_assert_eq!(
                result,
                Err(Ok(MatchingPoolError::Unauthorized)),
                "INV-5: non-admin must not be able to finalize a round"
            );
        }

        // INV-1/INV-4: a round cannot be finalized twice.
        #[test]
        fn finalize_twice_rejected(_seed in 0u64..u64::MAX) {
            let env = Env::default();
            env.mock_all_auths();
            let (client, admin, token, _) = setup(&env);
            let round_id = open_round(&env, &client, &admin, &token);

            env.ledger().set_timestamp(END + 1);
            client.finalize_round(&admin, &round_id);

            let result = client.try_finalize_round(&admin, &round_id);
            prop_assert_eq!(
                result,
                Err(Ok(MatchingPoolError::RoundAlreadyFinalized)),
                "INV-1/INV-4: finalize_round must not succeed a second time"
            );
        }

        // INV-1: finalize_round transitions status to FINALIZED and stamps finalized_at.
        #[test]
        fn finalize_sets_status_and_timestamp(end_offset in 1u64..=10_000u64) {
            let env = Env::default();
            env.mock_all_auths();
            let (client, admin, token, _) = setup(&env);
            let round_id = open_round(&env, &client, &admin, &token);

            let finalize_at = END + end_offset;
            env.ledger().set_timestamp(finalize_at);
            client.finalize_round(&admin, &round_id);

            prop_assert_eq!(
                client.get_round_status(&round_id),
                Symbol::new(&env, "FINALIZED"),
                "INV-1: status must be FINALIZED after finalize_round"
            );
            prop_assert_eq!(
                client.get_finalized_at(&round_id),
                finalize_at,
                "INV-1: finalized_at must record the ledger time finalize_round was called at"
            );
        }
    }
}

// ─── close phase — distribute_matching_funds (INV-1, INV-3, INV-4, INV-5) ───

#[cfg(test)]
mod close_phase {
    use super::*;

    /// Bring a round to FINALIZED with `n` approved+contributing projects and a
    /// funded pool, returning (round_id, project_owners) ready for
    /// distribute_matching_funds.
    fn setup_finalized_round(
        env: &Env,
        client: &MatchingPoolContractClient,
        admin: &Address,
        token: &TokenClient,
        token_admin: &StellarAssetClient,
        contributions: &[i128],
        pool_amount: i128,
    ) -> (u64, soroban_sdk::Vec<Address>) {
        let round_id = open_round(env, client, admin, token);
        let mut owners = vec![env];

        for (idx, amount) in contributions.iter().enumerate() {
            let project_id = idx as u64;
            client.approve_project(admin, &round_id, &project_id);
            let contributor = Address::generate(env);
            client.record_contribution(&round_id, &project_id, &contributor, amount);
            owners.push_back(Address::generate(env));
        }

        if pool_amount > 0 {
            do_fund_pool(client, token_admin, admin, round_id, pool_amount);
        }

        env.ledger().set_timestamp(END + 1);
        client.finalize_round(admin, &round_id);

        (round_id, owners)
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]

        // INV-1: distribute_matching_funds requires a finalized round.
        #[test]
        fn distribute_before_finalize_rejected(_seed in 0u64..u64::MAX) {
            let env = Env::default();
            env.mock_all_auths();
            let (client, admin, token, _) = setup(&env);
            let round_id = open_round(&env, &client, &admin, &token);
            client.approve_project(&admin, &round_id, &0u64);

            let result = client.try_distribute_matching_funds(&admin, &round_id, &vec![&env]);
            prop_assert_eq!(
                result,
                Err(Ok(MatchingPoolError::RoundNotFinalized)),
                "INV-1: distribute_matching_funds must require the round to be finalized"
            );
        }

        // INV-5: only the admin may trigger distribution.
        #[test]
        fn distribute_rejects_non_admin(
            contributions in proptest::collection::vec(valid_amount(), 1..=3),
            pool_amount in valid_amount(),
        ) {
            let env = Env::default();
            env.mock_all_auths();
            let (client, admin, token, token_admin) = setup(&env);
            let (round_id, owners) = setup_finalized_round(
                &env, &client, &admin, &token, &token_admin, &contributions, pool_amount,
            );
            let intruder = Address::generate(&env);

            let result = client.try_distribute_matching_funds(&intruder, &round_id, &owners);
            prop_assert_eq!(
                result,
                Err(Ok(MatchingPoolError::Unauthorized)),
                "INV-5: non-admin must not be able to distribute matching funds"
            );
        }

        // INV-3/INV-4: distribution never exceeds the funded pool, and the pool
        // is exhausted (never left with leftover dust that's still claimable).
        #[test]
        fn distribution_respects_pool_and_zeroes_it(
            contributions in proptest::collection::vec(valid_amount(), 1..=4),
            pool_amount in valid_amount(),
        ) {
            let env = Env::default();
            env.mock_all_auths();
            let (client, admin, token, token_admin) = setup(&env);
            let (round_id, owners) = setup_finalized_round(
                &env, &client, &admin, &token, &token_admin, &contributions, pool_amount,
            );

            let pool_before = client.get_pool_balance(&round_id);
            let distributed = client.distribute_matching_funds(&admin, &round_id, &owners);

            prop_assert!(
                distributed <= pool_before,
                "INV-3: distributed ({}) must never exceed the pool balance before distribution ({})",
                distributed,
                pool_before
            );
            prop_assert_eq!(
                client.get_pool_balance(&round_id),
                0i128,
                "INV-3/INV-4: round pool must be fully drained after distribution"
            );
        }

        // INV-1/INV-4: distribution can never happen twice for the same round.
        #[test]
        fn distribute_twice_rejected(
            contributions in proptest::collection::vec(valid_amount(), 1..=3),
            pool_amount in valid_amount(),
        ) {
            let env = Env::default();
            env.mock_all_auths();
            let (client, admin, token, token_admin) = setup(&env);
            let (round_id, owners) = setup_finalized_round(
                &env, &client, &admin, &token, &token_admin, &contributions, pool_amount,
            );

            client.distribute_matching_funds(&admin, &round_id, &owners);
            let result = client.try_distribute_matching_funds(&admin, &round_id, &owners);
            prop_assert_eq!(
                result,
                Err(Ok(MatchingPoolError::MatchAlreadyDistributed)),
                "INV-1/INV-4: distribute_matching_funds must not succeed a second time"
            );
        }
    }
}

// ─── cap phase — round contribution caps (INV-8) ─────────────────────────────

#[cfg(test)]
mod cap_phase {
    use super::*;

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]

        // INV-8: any single contribution at or below the round's remaining
        // headroom must succeed.
        #[test]
        fn contribution_within_cap_succeeds(cap in valid_amount(), amount in valid_amount()) {
            prop_assume!(amount <= cap);

            let env = Env::default();
            env.mock_all_auths();
            let (client, admin, token, _) = setup(&env);
            let round_id = open_round(&env, &client, &admin, &token);
            client.approve_project(&admin, &round_id, &1u64);
            client.set_round_cap(&admin, &round_id, &cap);

            let contributor = Address::generate(&env);
            client.record_contribution(&round_id, &1u64, &contributor, &amount);

            prop_assert_eq!(
                client.get_contributor_round_total(&round_id, &contributor),
                amount,
                "INV-8: a contribution within the cap must be recorded in full"
            );
        }

        // INV-8: a single contribution that would push the contributor's
        // round total over a non-zero cap must be rejected in full, with no
        // state mutated.
        #[test]
        fn contribution_exceeding_cap_rejected(cap in valid_amount(), excess in valid_amount()) {
            let env = Env::default();
            env.mock_all_auths();
            let (client, admin, token, _) = setup(&env);
            let round_id = open_round(&env, &client, &admin, &token);
            client.approve_project(&admin, &round_id, &1u64);
            client.set_round_cap(&admin, &round_id, &cap);

            let contributor = Address::generate(&env);
            let over_amount = cap + excess;
            let result = client.try_record_contribution(&round_id, &1u64, &contributor, &over_amount);

            prop_assert_eq!(
                result,
                Err(Ok(MatchingPoolError::ContributionCapExceeded)),
                "INV-8: contributing {} against a cap of {} must be rejected",
                over_amount,
                cap
            );
            prop_assert_eq!(
                client.get_contributor_round_total(&round_id, &contributor),
                0i128,
                "INV-8: a rejected over-cap contribution must not mutate the contributor's round total"
            );
        }

        // INV-8: no matter how a contributor's amounts are split across
        // multiple projects in the same round, their cumulative round total
        // must never exceed a non-zero cap.
        #[test]
        fn cumulative_total_never_exceeds_cap_across_projects(
            cap in valid_amount(),
            amounts in proptest::collection::vec(valid_amount(), 1..=6),
        ) {
            let env = Env::default();
            env.mock_all_auths();
            let (client, admin, token, _) = setup(&env);
            let round_id = open_round(&env, &client, &admin, &token);
            client.approve_project(&admin, &round_id, &1u64);
            client.approve_project(&admin, &round_id, &2u64);
            client.set_round_cap(&admin, &round_id, &cap);

            let contributor = Address::generate(&env);
            for (idx, amount) in amounts.iter().enumerate() {
                let project_id = (idx % 2) as u64 + 1;
                let _ = client.try_record_contribution(&round_id, &project_id, &contributor, amount);

                prop_assert!(
                    client.get_contributor_round_total(&round_id, &contributor) <= cap,
                    "INV-8: cumulative round total must never exceed the cap ({})",
                    cap
                );
            }
        }

        // INV-8: a cap of 0 means unlimited — any amount succeeds.
        #[test]
        fn zero_cap_means_unlimited(amount in valid_amount()) {
            let env = Env::default();
            env.mock_all_auths();
            let (client, admin, token, _) = setup(&env);
            let round_id = open_round(&env, &client, &admin, &token);
            client.approve_project(&admin, &round_id, &1u64);
            // No cap set — defaults to 0 (uncapped).

            let contributor = Address::generate(&env);
            client.record_contribution(&round_id, &1u64, &contributor, &amount);

            prop_assert_eq!(
                client.get_contributor_round_total(&round_id, &contributor),
                amount,
                "INV-8: an uncapped round (cap == 0) must accept any positive amount"
            );
        }
    }
}
