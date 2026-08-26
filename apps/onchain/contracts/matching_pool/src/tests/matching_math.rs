//! Property-based tests for the quadratic-funding matching math in
//! `matching_pool`.
//!
//! These target the acceptance criteria from issue #1228:
//!
//! - **MM-1** — total matched funds never exceed the available pool, for any
//!   generated contribution set.
//! - **MM-2** — round contribution caps (PR #1143) are respected under all
//!   generated inputs.
//! - **MM-3** — no input combination causes overflow, underflow, or panic.
//! - **MM-4** — matching is monotonic: an additional contribution never
//!   reduces a project's match.
//!
//! Every assertion message names the `MM-<n>` it checks plus the concrete
//! values involved, so a proptest failure's shrunk counterexample and panic
//! message are enough to diagnose the break without re-running under a
//! debugger.

extern crate std;

use crate::{MatchingPoolContract, MatchingPoolContractClient};
use proptest::prelude::*;
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    vec, Address, Env, Vec,
};

// ─── Shared helpers ──────────────────────────────────────────────────────────

const START: u64 = 1_000;
const END: u64 = 100_000;

/// A positive contribution amount bounded so that per-project totals and the
/// pool stay well inside `i128` for the whole generated contribution set.
fn amount() -> impl Strategy<Value = i128> {
    1i128..=1_000_000_000i128
}

/// The same range plus values near `i128::MAX`, used specifically to exercise
/// the square-root/overflow paths of `compute_qf_score` (MM-3).
fn extreme_amount() -> impl Strategy<Value = i128> {
    prop_oneof![amount(), (i128::MAX / 2)..=i128::MAX]
}

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

/// Parse `preview_distribution`'s interleaved `[pid, alloc, pid, alloc, …]`
/// vector and return the allocation for `project_id` (0 if absent).
fn alloc_for(preview: &Vec<i128>, project_id: u64) -> i128 {
    let mut alloc = 0i128;
    let mut idx = 0u32;
    while idx + 1 < preview.len() {
        let pid = preview.get(idx).unwrap();
        if pid == project_id as i128 {
            alloc = preview.get(idx + 1).unwrap();
        }
        idx += 2;
    }
    alloc
}

/// Approve `n` projects (ids `0..n`) and record each contribution in
/// `projects` against its own fresh contributor address.
fn build_contributed_round(
    env: &Env,
    client: &MatchingPoolContractClient,
    admin: &Address,
    token: &TokenClient,
    token_admin: &StellarAssetClient,
    projects: &[std::vec::Vec<i128>],
    pool_amount: i128,
) -> u64 {
    let round_id = open_round(env, client, admin, token);

    for (project_id, contribs) in projects.iter().enumerate() {
        client.approve_project(admin, &round_id, &(project_id as u64));
        for amt in contribs {
            let contributor = Address::generate(env);
            client.record_contribution(&round_id, &(project_id as u64), &contributor, amt);
        }
    }

    if pool_amount > 0 {
        do_fund_pool(client, token_admin, admin, round_id, pool_amount);
    }

    round_id
}

/// Build the `project_owners` vector expected by `distribute_matching_funds`:
/// one owner per project, in approval order (the same order the contract
/// enumerates `EligibleProjectAt`).
fn owners_for(env: &Env, count: usize) -> Vec<Address> {
    let mut owners = vec![env];
    for _ in 0..count {
        owners.push_back(Address::generate(env));
    }
    owners
}

// ─── MM-3: QF score never overflows, underflows, or panics ───────────────────

#[cfg(test)]
mod qf_score {
    use super::*;

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(200))]

        // MM-3: any generated contribution set yields a non-negative QF score
        // without panicking (overflow/underflow), across several projects.
        #[test]
        fn qf_score_is_non_negative_and_never_panics(
            contribs in proptest::collection::vec((0u64..4u64, amount()), 1..=16),
        ) {
            let env = Env::default();
            env.mock_all_auths();
            let (client, admin, token, _) = setup(&env);
            let round_id = open_round(&env, &client, &admin, &token);

            for pid in 0u64..4u64 {
                client.approve_project(&admin, &round_id, &pid);
            }
            for (pid, amt) in &contribs {
                let contributor = Address::generate(&env);
                client.record_contribution(&round_id, pid, &contributor, amt);
            }

            for pid in 0u64..4u64 {
                let score = client.get_project_qf_score(&round_id, &pid);
                prop_assert!(
                    score >= 0,
                    "MM-3: QF score for project {} must be non-negative, got {}",
                    pid,
                    score
                );
            }
        }

        // MM-3: extreme (near i128::MAX) single contributions must not overflow
        // or panic inside the fixed-point sqrt used by compute_qf_score.
        #[test]
        fn qf_score_extreme_amounts_never_panic(
            amounts in proptest::collection::vec(extreme_amount(), 1..=4),
        ) {
            let env = Env::default();
            env.mock_all_auths();
            let (client, admin, token, _) = setup(&env);
            let round_id = open_round(&env, &client, &admin, &token);

            for (pid, amt) in amounts.iter().enumerate() {
                client.approve_project(&admin, &round_id, &(pid as u64));
                let contributor = Address::generate(&env);
                client.record_contribution(&round_id, &(pid as u64), &contributor, amt);
            }

            for pid in 0..amounts.len() {
                let score = client.get_project_qf_score(&round_id, &(pid as u64));
                prop_assert!(
                    score >= 0,
                    "MM-3: extreme QF score for project {} must be non-negative, got {}",
                    pid,
                    score
                );
            }
        }
    }

    // MM-3 regression (fixed test case): the largest possible single
    // contribution (i128::MAX) previously overflowed `sqrt_scaled`'s binary
    // search (`(low + high + 1)` wraps). Keep this as a deterministic test so
    // the case is covered even without proptest's random search.
    #[test]
    fn qf_score_i128_max_contribution_never_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, token, _) = setup(&env);
        let round_id = open_round(&env, &client, &admin, &token);
        client.approve_project(&admin, &round_id, &1u64);

        let contributor = Address::generate(&env);
        client.record_contribution(&round_id, &1u64, &contributor, &i128::MAX);

        let score = client.get_project_qf_score(&round_id, &1u64);
        assert!(
            score >= 0,
            "MM-3: i128::MAX contribution must not panic, got {}",
            score
        );
    }

    // MM-4: a project's QF score never decreases when it receives one more
    // contribution (breadth is always rewarded).
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(200))]

        #[test]
        fn qf_score_monotonic_under_extra_contribution(
            base in proptest::collection::vec(amount(), 0..=8),
            extra in amount(),
        ) {
            let env = Env::default();
            env.mock_all_auths();
            let (client, admin, token, _) = setup(&env);
            let round_id = open_round(&env, &client, &admin, &token);
            client.approve_project(&admin, &round_id, &1u64);

            for amt in &base {
                let contributor = Address::generate(&env);
                client.record_contribution(&round_id, &1u64, &contributor, amt);
            }
            let before = client.get_project_qf_score(&round_id, &1u64);

            let contributor = Address::generate(&env);
            client.record_contribution(&round_id, &1u64, &contributor, &extra);
            let after = client.get_project_qf_score(&round_id, &1u64);

            prop_assert!(
                after >= before,
                "MM-4: QF score must not decrease after an extra contribution ({} -> {})",
                before,
                after
            );
        }
    }
}

// ─── MM-1 / MM-4: distribution invariants ────────────────────────────────────

#[cfg(test)]
mod distribution {
    use super::*;

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(200))]

        // MM-1: for any generated contribution set and pool size, the total
        // matched funds never exceed the pool, and the pool is fully drained.
        #[test]
        fn distribution_never_exceeds_pool(
            projects in proptest::collection::vec(
                proptest::collection::vec(amount(), 1..=6),
                2..=6,
            ),
            pool_amount in amount(),
        ) {
            let env = Env::default();
            env.mock_all_auths();
            let (client, admin, token, token_admin) = setup(&env);
            let round_id = build_contributed_round(
                &env, &client, &admin, &token, &token_admin, &projects, pool_amount,
            );

            env.ledger().set_timestamp(END + 1);
            client.finalize_round(&admin, &round_id);

            let owners = owners_for(&env, projects.len());
            let pool_before = client.get_pool_balance(&round_id);
            let distributed = client.distribute_matching_funds(&admin, &round_id, &owners);

            prop_assert!(
                distributed <= pool_before,
                "MM-1: distributed ({}) must never exceed the pool ({})",
                distributed,
                pool_before
            );
            prop_assert_eq!(
                client.get_pool_balance(&round_id),
                0i128,
                "MM-1: pool must be fully drained after distribution"
            );
            prop_assert!(
                distributed > 0,
                "MM-1: a funded round with contributions must distribute a positive amount"
            );
        }

        // MM-1: `preview_distribution` must agree with the real payout for every
        // project (same allocation math, no drift between the two code paths).
        #[test]
        fn preview_matches_actual_distribution(
            projects in proptest::collection::vec(
                proptest::collection::vec(amount(), 1..=6),
                2..=5,
            ),
            pool_amount in amount(),
        ) {
            let env = Env::default();
            env.mock_all_auths();
            let (client, admin, token, token_admin) = setup(&env);
            let round_id = build_contributed_round(
                &env, &client, &admin, &token, &token_admin, &projects, pool_amount,
            );

            let preview = client.preview_distribution(&round_id);

            env.ledger().set_timestamp(END + 1);
            client.finalize_round(&admin, &round_id);
            let owners = owners_for(&env, projects.len());
            let distributed = client.distribute_matching_funds(&admin, &round_id, &owners);

            let mut preview_total = 0i128;
            for (project_id, _) in projects.iter().enumerate() {
                let preview_alloc = alloc_for(&preview, project_id as u64);
                let actual_alloc = token.balance(&owners.get(project_id as u32).unwrap());
                preview_total += preview_alloc;
                prop_assert_eq!(
                    preview_alloc,
                    actual_alloc,
                    "MM-1: preview allocation for project {} ({}) must equal actual payout ({})",
                    project_id,
                    preview_alloc,
                    actual_alloc
                );
            }
            prop_assert_eq!(
                preview_total,
                distributed,
                "MM-1: preview total ({}) must equal distributed total ({})",
                preview_total,
                distributed
            );
        }

        // MM-4: an additional contribution to a project never reduces that
        // project's match.
        #[test]
        fn extra_contribution_never_reduces_project_match(
            projects in proptest::collection::vec(
                proptest::collection::vec(amount(), 1..=6),
                2..=4,
            ),
            target_idx in 0usize..4usize,
            extra in amount(),
        ) {
            let target = target_idx % projects.len();

            let env = Env::default();
            env.mock_all_auths();
            let (client, admin, token, token_admin) = setup(&env);
            let round_id = build_contributed_round(
                &env, &client, &admin, &token, &token_admin, &projects, 1_000_000_000i128,
            );

            let before = alloc_for(&client.preview_distribution(&round_id), target as u64);

            let contributor = Address::generate(&env);
            client.record_contribution(&round_id, &(target as u64), &contributor, &extra);

            let after = alloc_for(&client.preview_distribution(&round_id), target as u64);

            prop_assert!(
                after >= before,
                "MM-4: project {} match must not decrease after an extra contribution ({} -> {})",
                target,
                before,
                after
            );
        }
    }
}

// ─── MM-2: caps interact with the matching math without overflow/panic ───────

#[cfg(test)]
mod caps {
    use super::*;

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(200))]

        // MM-2: under a non-zero cap, a contributor's round total never exceeds
        // the cap no matter how their amounts are split across projects.
        #[test]
        fn cumulative_round_total_respects_cap(
            cap in amount(),
            amounts in proptest::collection::vec(amount(), 1..=10),
        ) {
            let env = Env::default();
            env.mock_all_auths();
            let (client, admin, token, _) = setup(&env);
            let round_id = open_round(&env, &client, &admin, &token);
            client.approve_project(&admin, &round_id, &1u64);
            client.approve_project(&admin, &round_id, &2u64);
            client.approve_project(&admin, &round_id, &3u64);
            client.set_round_cap(&admin, &round_id, &cap);

            let contributor = Address::generate(&env);
            for (idx, amt) in amounts.iter().enumerate() {
                let project_id = (idx % 3) as u64 + 1;
                let _ = client.try_record_contribution(&round_id, &project_id, &contributor, amt);

                prop_assert!(
                    client.get_contributor_round_total(&round_id, &contributor) <= cap,
                    "MM-2: cumulative round total must never exceed the cap ({})",
                    cap
                );
            }
        }

        // MM-2 + MM-3: a capped round still finalizes and distributes without
        // overflowing or panicking, and never pays out more than the pool.
        #[test]
        fn capped_round_distributes_without_panic(
            cap in amount(),
            amounts in proptest::collection::vec(amount(), 1..=12),
            pool_amount in amount(),
        ) {
            let env = Env::default();
            env.mock_all_auths();
            let (client, admin, token, token_admin) = setup(&env);
            let round_id = open_round(&env, &client, &admin, &token);
            for pid in 0u64..3u64 {
                client.approve_project(&admin, &round_id, &pid);
            }
            client.set_round_cap(&admin, &round_id, &cap);

            let contributor = Address::generate(&env);
            for (idx, amt) in amounts.iter().enumerate() {
                let project_id = (idx % 3) as u64;
                let _ = client.try_record_contribution(&round_id, &project_id, &contributor, amt);
            }

            do_fund_pool(&client, &token_admin, &admin, round_id, pool_amount);

            env.ledger().set_timestamp(END + 1);
            client.finalize_round(&admin, &round_id);

            let owners = owners_for(&env, 3);
            let pool_before = client.get_pool_balance(&round_id);
            let distributed = client.distribute_matching_funds(&admin, &round_id, &owners);

            prop_assert!(
                distributed <= pool_before,
                "MM-2/MM-3: capped round distributed ({}) must not exceed the pool ({})",
                distributed,
                pool_before
            );
            if distributed > 0 {
                prop_assert_eq!(
                    client.get_pool_balance(&round_id),
                    0i128,
                    "MM-2/MM-3: capped round pool must be drained after a positive distribution"
                );
            }
        }
    }
}
