use crate::errors::MatchingPoolError;
use crate::{MatchingPoolContract, MatchingPoolContractClient};
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    vec, Address, Env, Symbol,
};

fn create_token<'a>(env: &Env, admin: &Address) -> (TokenClient<'a>, StellarAssetClient<'a>) {
    let addr = env.register_stellar_asset_contract_v2(admin.clone());
    (
        TokenClient::new(env, &addr.address()),
        StellarAssetClient::new(env, &addr.address()),
    )
}

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
    (client, admin, token, token_admin)
}

// ── Basic lifecycle ──────────────────────────────────────────────────────────

#[test]
fn test_initialize() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _, _) = setup(&env);
    client.initialize(&admin);
    assert_eq!(client.get_admin(), admin);
}

#[test]
fn test_double_init_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _, _) = setup(&env);
    client.initialize(&admin);
    assert_eq!(
        client.try_initialize(&admin),
        Err(Ok(MatchingPoolError::AlreadyInitialized))
    );
}

#[test]
fn test_create_round() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, _) = setup(&env);
    client.initialize(&admin);

    env.ledger().set_timestamp(1000);
    let round_id = client.create_round(
        &admin,
        &symbol_short!("Round1"),
        &token.address,
        &1000u64,
        &2000u64,
    );
    assert_eq!(round_id, 0);

    let round = client.get_round(&round_id);
    assert_eq!(round.id, 0);
    assert_eq!(round.total_pool, 0);
    assert!(!round.is_finalized);
}

#[test]
fn test_invalid_round_dates() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, _) = setup(&env);
    client.initialize(&admin);

    assert_eq!(
        client.try_create_round(
            &admin,
            &symbol_short!("Bad"),
            &token.address,
            &2000u64,
            &1000u64,
        ),
        Err(Ok(MatchingPoolError::InvalidRoundDates))
    );
}

// ── Pool funding ─────────────────────────────────────────────────────────────

#[test]
fn test_fund_pool() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, token_admin) = setup(&env);
    client.initialize(&admin);

    let funder = Address::generate(&env);
    token_admin.mint(&funder, &1_000_000);

    env.ledger().set_timestamp(500);
    let round_id = client.create_round(
        &admin,
        &symbol_short!("R1"),
        &token.address,
        &1000u64,
        &3000u64,
    );

    client.fund_pool(&funder, &round_id, &500_000);
    assert_eq!(client.get_pool_balance(&round_id), 500_000);

    let round = client.get_round(&round_id);
    assert_eq!(round.total_pool, 500_000);
}

// ── Eligibility ──────────────────────────────────────────────────────────────

#[test]
fn test_approve_and_remove_project() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, _) = setup(&env);
    client.initialize(&admin);

    env.ledger().set_timestamp(500);
    let round_id = client.create_round(
        &admin,
        &symbol_short!("R1"),
        &token.address,
        &1000u64,
        &3000u64,
    );

    client.approve_project(&admin, &round_id, &42u64);

    // Duplicate approval should fail
    assert_eq!(
        client.try_approve_project(&admin, &round_id, &42u64),
        Err(Ok(MatchingPoolError::ProjectAlreadyEligible))
    );

    client.remove_project(&admin, &round_id, &42u64);

    // Removing again should fail
    assert_eq!(
        client.try_remove_project(&admin, &round_id, &42u64),
        Err(Ok(MatchingPoolError::ProjectNotEligible))
    );
}

// ── Contribution recording ───────────────────────────────────────────────────

#[test]
fn test_record_contribution() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, _) = setup(&env);
    client.initialize(&admin);

    env.ledger().set_timestamp(500);
    let round_id = client.create_round(
        &admin,
        &symbol_short!("R1"),
        &token.address,
        &1000u64,
        &3000u64,
    );
    client.approve_project(&admin, &round_id, &1u64);

    let contributor = Address::generate(&env);
    env.ledger().set_timestamp(1500); // inside window
    client.record_contribution(&round_id, &1u64, &contributor, &100_000);

    assert_eq!(client.get_project_contributions(&round_id, &1u64), 100_000);
    assert_eq!(client.get_contributor_count(&round_id, &1u64), 1);
}

#[test]
fn test_contribution_outside_window_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, _) = setup(&env);
    client.initialize(&admin);

    env.ledger().set_timestamp(500);
    let round_id = client.create_round(
        &admin,
        &symbol_short!("R1"),
        &token.address,
        &1000u64,
        &3000u64,
    );
    client.approve_project(&admin, &round_id, &1u64);

    let contributor = Address::generate(&env);
    env.ledger().set_timestamp(4000); // after window
    assert_eq!(
        client.try_record_contribution(&round_id, &1u64, &contributor, &100_000),
        Err(Ok(MatchingPoolError::RoundNotActive))
    );
}

// ── QF score & distribution ──────────────────────────────────────────────────

#[test]
fn test_qf_score_single_contributor() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, _) = setup(&env);
    client.initialize(&admin);

    env.ledger().set_timestamp(500);
    let round_id = client.create_round(
        &admin,
        &symbol_short!("R1"),
        &token.address,
        &1000u64,
        &3000u64,
    );
    client.approve_project(&admin, &round_id, &1u64);

    let c = Address::generate(&env);
    env.ledger().set_timestamp(1500);
    client.record_contribution(&round_id, &1u64, &c, &100);

    // score = (sqrt(100))^2 = 100
    let score = client.get_project_qf_score(&round_id, &1u64);
    assert!(score > 0);
}

#[test]
fn test_qf_score_multiple_contributors_higher_than_single_large() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, _) = setup(&env);
    client.initialize(&admin);

    env.ledger().set_timestamp(500);
    let round_id = client.create_round(
        &admin,
        &symbol_short!("R1"),
        &token.address,
        &1000u64,
        &3000u64,
    );
    client.approve_project(&admin, &round_id, &1u64); // many small
    client.approve_project(&admin, &round_id, &2u64); // one large

    env.ledger().set_timestamp(1500);

    // Project 1: 4 contributors × 25 each = total 100
    for _ in 0..4 {
        let c = Address::generate(&env);
        client.record_contribution(&round_id, &1u64, &c, &25);
    }

    // Project 2: 1 contributor × 100
    let c = Address::generate(&env);
    client.record_contribution(&round_id, &2u64, &c, &100);

    let score1 = client.get_project_qf_score(&round_id, &1u64);
    let score2 = client.get_project_qf_score(&round_id, &2u64);

    // QF rewards breadth: 4×sqrt(25) = 4×5 = 20, squared = 400
    // vs 1×sqrt(100) = 10, squared = 100
    assert!(score1 > score2, "QF should favour broader participation");
}

#[test]
fn test_full_distribution_flow() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, token_admin) = setup(&env);
    client.initialize(&admin);

    let funder = Address::generate(&env);
    let owner1 = Address::generate(&env);
    let owner2 = Address::generate(&env);
    token_admin.mint(&funder, &1_000_000);

    env.ledger().set_timestamp(500);
    let round_id = client.create_round(
        &admin,
        &symbol_short!("R1"),
        &token.address,
        &1000u64,
        &3000u64,
    );

    client.fund_pool(&funder, &round_id, &1_000_000);
    client.approve_project(&admin, &round_id, &1u64);
    client.approve_project(&admin, &round_id, &2u64);

    env.ledger().set_timestamp(1500);

    // Project 1: 4 contributors × 25
    for _ in 0..4 {
        let c = Address::generate(&env);
        client.record_contribution(&round_id, &1u64, &c, &25);
    }
    // Project 2: 1 contributor × 100
    let c = Address::generate(&env);
    client.record_contribution(&round_id, &2u64, &c, &100);

    // Finalize after end_time
    env.ledger().set_timestamp(4000);
    client.finalize_round(&admin, &round_id);

    let owners = vec![&env, owner1.clone(), owner2.clone()];
    let total = client.distribute_matching_funds(&admin, &round_id, &owners);

    assert_eq!(total, 1_000_000);
    // owner1 should receive more (broader participation)
    assert!(token.balance(&owner1) > token.balance(&owner2));

    // Double distribution should fail
    assert_eq!(
        client.try_distribute_matching_funds(&admin, &round_id, &owners),
        Err(Ok(MatchingPoolError::MatchAlreadyDistributed))
    );
}

#[test]
fn test_finalize_before_end_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, _) = setup(&env);
    client.initialize(&admin);

    env.ledger().set_timestamp(500);
    let round_id = client.create_round(
        &admin,
        &symbol_short!("R1"),
        &token.address,
        &1000u64,
        &3000u64,
    );

    env.ledger().set_timestamp(2000); // still inside window
    assert_eq!(
        client.try_finalize_round(&admin, &round_id),
        Err(Ok(MatchingPoolError::RoundStillOpen))
    );
}

#[test]
fn test_preview_distribution() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, token_admin) = setup(&env);
    client.initialize(&admin);

    let funder = Address::generate(&env);
    token_admin.mint(&funder, &1_000_000);

    env.ledger().set_timestamp(500);
    let round_id = client.create_round(
        &admin,
        &symbol_short!("R1"),
        &token.address,
        &1000u64,
        &3000u64,
    );
    client.fund_pool(&funder, &round_id, &1_000_000);
    client.approve_project(&admin, &round_id, &1u64);
    client.approve_project(&admin, &round_id, &2u64);

    env.ledger().set_timestamp(1500);
    for _ in 0..4 {
        let c = Address::generate(&env);
        client.record_contribution(&round_id, &1u64, &c, &25);
    }
    let c = Address::generate(&env);
    client.record_contribution(&round_id, &2u64, &c, &100);

    let preview = client.preview_distribution(&round_id);
    // Returns [pid0, alloc0, pid1, alloc1]
    assert_eq!(preview.len(), 4);
    // Allocations should sum to pool
    let alloc0 = preview.get(1).unwrap();
    let alloc1 = preview.get(3).unwrap();
    assert_eq!(alloc0 + alloc1, 1_000_000);
}

#[test]
fn test_reentrancy_guard_fund_pool_rejects_when_locked() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, token_admin) = setup(&env);
    client.initialize(&admin);

    let funder = Address::generate(&env);
    token_admin.mint(&funder, &1_000_000);
    env.ledger().set_timestamp(500);
    let round_id = client.create_round(
        &admin,
        &symbol_short!("RG"),
        &token.address,
        &1000u64,
        &3000u64,
    );

    env.as_contract(&client.address, || {
        env.storage()
            .instance()
            .set(&symbol_short!("REENTRANT"), &true);
    });

    let result = client.try_fund_pool(&funder, &round_id, &100_000);
    assert_eq!(result, Err(Ok(MatchingPoolError::Reentrancy)));

    let lock_state: bool = env.as_contract(&client.address, || {
        env.storage()
            .instance()
            .get(&symbol_short!("REENTRANT"))
            .unwrap_or(false)
    });
    assert!(lock_state);
}

#[test]
fn test_reentrancy_guard_resets_for_sequential_fund_pool_calls() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, token_admin) = setup(&env);
    client.initialize(&admin);

    let funder = Address::generate(&env);
    token_admin.mint(&funder, &1_000_000);
    env.ledger().set_timestamp(500);
    let round_id = client.create_round(
        &admin,
        &symbol_short!("SEQ"),
        &token.address,
        &1000u64,
        &3000u64,
    );

    client.fund_pool(&funder, &round_id, &200_000);
    client.fund_pool(&funder, &round_id, &300_000);
    assert_eq!(client.get_pool_balance(&round_id), 500_000);

    let lock_state: bool = env.as_contract(&client.address, || {
        env.storage()
            .instance()
            .get(&symbol_short!("REENTRANT"))
            .unwrap_or(false)
    });
    assert!(!lock_state);
}

#[test]
fn test_fund_pool_cei_state_written_before_token_balance_assertion() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, token_admin) = setup(&env);
    client.initialize(&admin);

    let funder = Address::generate(&env);
    token_admin.mint(&funder, &1_000_000);
    env.ledger().set_timestamp(500);
    let round_id = client.create_round(
        &admin,
        &symbol_short!("CEI"),
        &token.address,
        &1000u64,
        &3000u64,
    );

    client.fund_pool(&funder, &round_id, &250_000);

    let round = client.get_round(&round_id);
    assert_eq!(round.total_pool, 250_000);
    assert_eq!(client.get_pool_balance(&round_id), 250_000);
    assert_eq!(token.balance(&client.address), 250_000);
}

// ── Finalization guardrails ──────────────────────────────────────────────────

#[test]
fn test_double_finalize_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, _) = setup(&env);
    client.initialize(&admin);

    env.ledger().set_timestamp(500);
    let round_id = client.create_round(
        &admin,
        &symbol_short!("R1"),
        &token.address,
        &1000u64,
        &3000u64,
    );

    env.ledger().set_timestamp(4000);
    client.finalize_round(&admin, &round_id);

    assert_eq!(
        client.try_finalize_round(&admin, &round_id),
        Err(Ok(MatchingPoolError::RoundAlreadyFinalized))
    );

    assert_eq!(
        client.get_round_status(&round_id),
        symbol_short!("FINALIZED")
    );
}

#[test]
fn test_finalize_unauthorized_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, _) = setup(&env);
    client.initialize(&admin);

    env.ledger().set_timestamp(500);
    let round_id = client.create_round(
        &admin,
        &symbol_short!("R1"),
        &token.address,
        &1000u64,
        &3000u64,
    );

    let not_admin = Address::generate(&env);
    env.ledger().set_timestamp(4000);
    assert_eq!(
        client.try_finalize_round(&not_admin, &round_id),
        Err(Ok(MatchingPoolError::Unauthorized))
    );
}

#[test]
fn test_finalize_nonexistent_round_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _, _) = setup(&env);
    client.initialize(&admin);

    assert_eq!(
        client.try_finalize_round(&admin, &999u64),
        Err(Ok(MatchingPoolError::RoundNotFound))
    );
}

#[test]
fn test_finalize_while_paused_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, _) = setup(&env);
    client.initialize(&admin);

    env.ledger().set_timestamp(500);
    let round_id = client.create_round(
        &admin,
        &symbol_short!("R1"),
        &token.address,
        &1000u64,
        &3000u64,
    );

    client.pause(&admin);

    env.ledger().set_timestamp(4000);
    assert_eq!(
        client.try_finalize_round(&admin, &round_id),
        Err(Ok(MatchingPoolError::ContractPaused))
    );

    let round = client.get_round(&round_id);
    assert!(!round.is_finalized);
}

#[test]
fn test_finalize_records_timestamp_and_status() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, _) = setup(&env);
    client.initialize(&admin);

    env.ledger().set_timestamp(500);
    let round_id = client.create_round(
        &admin,
        &symbol_short!("R1"),
        &token.address,
        &1000u64,
        &3000u64,
    );

    env.ledger().set_timestamp(4000);
    client.finalize_round(&admin, &round_id);

    let round = client.get_round(&round_id);
    assert!(round.is_finalized);
    assert_eq!(
        client.get_round_status(&round_id),
        symbol_short!("FINALIZED")
    );
    assert_eq!(client.get_finalized_at(&round_id), 4000);
}

#[test]
fn test_reentrancy_guard_finalize_rejects_when_locked() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, _) = setup(&env);
    client.initialize(&admin);

    env.ledger().set_timestamp(500);
    let round_id = client.create_round(
        &admin,
        &symbol_short!("RGF"),
        &token.address,
        &1000u64,
        &3000u64,
    );

    env.as_contract(&client.address, || {
        env.storage()
            .instance()
            .set(&symbol_short!("REENTRANT"), &true);
    });

    env.ledger().set_timestamp(4000);
    let result = client.try_finalize_round(&admin, &round_id);
    assert_eq!(result, Err(Ok(MatchingPoolError::Reentrancy)));

    let round = client.get_round(&round_id);
    assert!(!round.is_finalized);
}

#[test]
fn test_distribute_while_paused_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, token_admin) = setup(&env);
    client.initialize(&admin);

    let funder = Address::generate(&env);
    let owner1 = Address::generate(&env);
    token_admin.mint(&funder, &1_000_000);

    env.ledger().set_timestamp(500);
    let round_id = client.create_round(
        &admin,
        &symbol_short!("R1"),
        &token.address,
        &1000u64,
        &3000u64,
    );

    client.fund_pool(&funder, &round_id, &1_000_000);
    client.approve_project(&admin, &round_id, &1u64);

    env.ledger().set_timestamp(1500);
    let c = Address::generate(&env);
    client.record_contribution(&round_id, &1u64, &c, &100);

    env.ledger().set_timestamp(4000);
    client.finalize_round(&admin, &round_id);

    client.pause(&admin);

    let owners = vec![&env, owner1.clone()];
    assert_eq!(
        client.try_distribute_matching_funds(&admin, &round_id, &owners),
        Err(Ok(MatchingPoolError::ContractPaused))
    );

    let round = client.get_round(&round_id);
    assert!(!round.is_distributed);
}

#[test]
fn test_distribute_succeeds_after_unpause() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, token_admin) = setup(&env);
    client.initialize(&admin);

    let funder = Address::generate(&env);
    let owner1 = Address::generate(&env);
    token_admin.mint(&funder, &1_000_000);

    env.ledger().set_timestamp(500);
    let round_id = client.create_round(
        &admin,
        &symbol_short!("R1"),
        &token.address,
        &1000u64,
        &3000u64,
    );

    client.fund_pool(&funder, &round_id, &1_000_000);
    client.approve_project(&admin, &round_id, &1u64);

    env.ledger().set_timestamp(1500);
    let c = Address::generate(&env);
    client.record_contribution(&round_id, &1u64, &c, &100);

    env.ledger().set_timestamp(4000);
    client.finalize_round(&admin, &round_id);

    client.pause(&admin);
    client.unpause(&admin);

    let owners = vec![&env, owner1.clone()];
    let total = client.distribute_matching_funds(&admin, &round_id, &owners);

    assert_eq!(total, 1_000_000);
    assert_eq!(token.balance(&owner1), 1_000_000);
}

// Shared lifecycle invariants for matching_pool rounds:
// 1. An ACTIVE round may accept contributions only while the current timestamp is within [start_time, end_time].
// 2. A FINALIZED round is terminal for new contributions and only transitions to DISTRIBUTED through one matching-funds distribution pass.
// 3. DISTRIBUTED rounds must preserve the storage invariant: round status is fixed, pool balance is zero, and repeated distribution attempts fail.
#[cfg(test)]
mod lifecycle_invariants {
    use super::*;
    use proptest::prelude::*;

    #[test]
    fn invariant_active_to_finalized_to_distributed_round_flow() {
        let env = Env::default();
        env.mock_all_auths();

        let (client, admin, token, token_admin) = setup(&env);
        client.initialize(&admin);

        let funder = Address::generate(&env);
        let owner = Address::generate(&env);
        let contributor = Address::generate(&env);
        token_admin.mint(&funder, &1_000_000);

        env.ledger().set_timestamp(500);
        let round_id = client.create_round(
            &admin,
            &symbol_short!("R1"),
            &token.address,
            &1000u64,
            &3000u64,
        );

        let before_fund = client.get_round(&round_id);
        assert_eq!(before_fund.total_pool, 0);
        assert!(!before_fund.is_finalized);
        assert!(!before_fund.is_distributed);
        assert_eq!(client.get_round_status(&round_id), symbol_short!("ACTIVE"));

        client.fund_pool(&funder, &round_id, &1_000_000);
        assert_eq!(client.get_pool_balance(&round_id), 1_000_000);

        client.approve_project(&admin, &round_id, &1u64);

        env.ledger().set_timestamp(1500);
        client.record_contribution(&round_id, &1u64, &contributor, &250);
        assert_eq!(client.get_project_contributions(&round_id, &1u64), 250);

        env.ledger().set_timestamp(3500);
        let contribution_outside_window =
            client.try_record_contribution(&round_id, &1u64, &Address::generate(&env), &100);
        assert_eq!(
            contribution_outside_window,
            Err(Ok(MatchingPoolError::RoundNotActive))
        );

        env.ledger().set_timestamp(4000);
        client.finalize_round(&admin, &round_id);

        let finalized = client.get_round(&round_id);
        assert!(finalized.is_finalized);
        assert_eq!(
            client.get_round_status(&round_id),
            symbol_short!("FINALIZED")
        );
        assert_eq!(client.get_finalized_at(&round_id), 4000);

        let contribution_after_finalize =
            client.try_record_contribution(&round_id, &1u64, &Address::generate(&env), &100);
        assert_eq!(
            contribution_after_finalize,
            Err(Ok(MatchingPoolError::RoundAlreadyFinalized))
        );

        let owners = vec![&env, owner.clone()];
        let total = client.distribute_matching_funds(&admin, &round_id, &owners);
        assert_eq!(total, 1_000_000);

        let distributed = client.get_round(&round_id);
        assert!(distributed.is_distributed);
        assert_eq!(
            client.get_round_status(&round_id),
            Symbol::new(&env, "DISTRIBUTED")
        );
        assert_eq!(client.get_pool_balance(&round_id), 0);
        assert_eq!(token.balance(&owner), 1_000_000);

        let repeated_distribution =
            client.try_distribute_matching_funds(&admin, &round_id, &owners);
        assert_eq!(
            repeated_distribution,
            Err(Ok(MatchingPoolError::MatchAlreadyDistributed))
        );
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(50))]

        #[test]
        fn invariant_distribution_cannot_exceed_funded_pool(pool_amount in 1i128..=100_000i128, contribution_amount in 1i128..=10_000i128) {
            let env = Env::default();
            env.mock_all_auths();

            let (client, admin, token, token_admin) = setup(&env);
            client.initialize(&admin);

            let funder = Address::generate(&env);
            let owner = Address::generate(&env);
            let contributor = Address::generate(&env);
            token_admin.mint(&funder, &1_000_000_000);

            env.ledger().set_timestamp(500);
            let round_id = client.create_round(
                &admin,
                &symbol_short!("R1"),
                &token.address,
                &1000u64,
                &3000u64,
            );

            client.fund_pool(&funder, &round_id, &pool_amount);
            client.approve_project(&admin, &round_id, &1u64);

            env.ledger().set_timestamp(1500);
            client.record_contribution(&round_id, &1u64, &contributor, &contribution_amount);

            env.ledger().set_timestamp(4000);
            client.finalize_round(&admin, &round_id);

            let owners = vec![&env, owner.clone()];
            let distributed = client.distribute_matching_funds(&admin, &round_id, &owners);

            prop_assert_eq!(distributed, pool_amount, "distribution exceeded the funded pool amount");
            prop_assert_eq!(client.get_pool_balance(&round_id), 0, "round pool should be fully drained after distribution");
            prop_assert_eq!(client.get_round_status(&round_id), Symbol::new(&env, "DISTRIBUTED"), "round should terminate in DISTRIBUTED after a single distribution pass");
            prop_assert_eq!(token.balance(&owner), pool_amount, "owner balance should be exactly the distributed pool amount");
        }
    }
}
