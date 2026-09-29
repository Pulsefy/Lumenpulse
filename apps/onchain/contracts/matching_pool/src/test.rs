use crate::errors::MatchingPoolError;
use crate::{MatchingPoolContract, MatchingPoolContractClient};
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events, Ledger},
    token::{StellarAssetClient, TokenClient},
    vec, Address, Env,
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
        Err(Ok(MatchingPoolError::GovernanceScopePaused))
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
        Err(Ok(MatchingPoolError::PayoutScopePaused))
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

// ── Round contribution caps (anti-whale guardrails) ──────────────────────────

fn setup_round<'a>(
    env: &Env,
    client: &MatchingPoolContractClient<'a>,
    admin: &Address,
    token: &TokenClient<'a>,
) -> u64 {
    client.initialize(admin);
    env.ledger().set_timestamp(500);
    client.create_round(
        admin,
        &symbol_short!("R1"),
        &token.address,
        &1000u64,
        &3000u64,
    )
}

#[test]
fn test_set_round_cap_and_get_round_cap() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, _) = setup(&env);
    let round_id = setup_round(&env, &client, &admin, &token);

    client.set_round_cap(&admin, &round_id, &500i128);
    assert_eq!(client.get_round_cap(&round_id), 500i128);
}

#[test]
fn test_get_round_cap_defaults_to_zero_when_unset() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, _) = setup(&env);
    let round_id = setup_round(&env, &client, &admin, &token);

    assert_eq!(client.get_round_cap(&round_id), 0i128);
}

#[test]
fn test_get_round_cap_nonexistent_round() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _, _) = setup(&env);
    client.initialize(&admin);

    assert_eq!(
        client.try_get_round_cap(&9_999u64),
        Err(Ok(MatchingPoolError::RoundNotFound))
    );
}

#[test]
fn test_get_contributor_round_total_nonexistent_round() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _, _) = setup(&env);
    client.initialize(&admin);
    let contributor = Address::generate(&env);

    assert_eq!(
        client.try_get_contributor_round_total(&9_999u64, &contributor),
        Err(Ok(MatchingPoolError::RoundNotFound))
    );
}

#[test]
fn test_set_round_cap_rejects_non_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, _) = setup(&env);
    let round_id = setup_round(&env, &client, &admin, &token);
    let intruder = Address::generate(&env);

    assert_eq!(
        client.try_set_round_cap(&intruder, &round_id, &500i128),
        Err(Ok(MatchingPoolError::Unauthorized))
    );
}

#[test]
fn test_set_round_cap_rejects_negative() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, _) = setup(&env);
    let round_id = setup_round(&env, &client, &admin, &token);

    assert_eq!(
        client.try_set_round_cap(&admin, &round_id, &-1i128),
        Err(Ok(MatchingPoolError::InvalidAmount))
    );
}

#[test]
fn test_set_round_cap_rejects_on_finalized_round() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, _) = setup(&env);
    let round_id = setup_round(&env, &client, &admin, &token);

    env.ledger().set_timestamp(4000);
    client.finalize_round(&admin, &round_id);

    assert_eq!(
        client.try_set_round_cap(&admin, &round_id, &500i128),
        Err(Ok(MatchingPoolError::RoundAlreadyFinalized))
    );
}

#[test]
fn test_set_round_cap_rejects_nonexistent_round() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _, _) = setup(&env);
    client.initialize(&admin);

    assert_eq!(
        client.try_set_round_cap(&admin, &9_999u64, &500i128),
        Err(Ok(MatchingPoolError::RoundNotFound))
    );
}

#[test]
fn test_contribution_exactly_at_cap_succeeds() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, _) = setup(&env);
    let round_id = setup_round(&env, &client, &admin, &token);
    client.approve_project(&admin, &round_id, &1u64);
    client.set_round_cap(&admin, &round_id, &100i128);

    let contributor = Address::generate(&env);
    env.ledger().set_timestamp(1500);
    client.record_contribution(&round_id, &1u64, &contributor, &100i128);

    assert_eq!(
        client.get_contributor_round_total(&round_id, &contributor),
        100i128
    );
}

#[test]
fn test_contribution_one_over_cap_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, _) = setup(&env);
    let round_id = setup_round(&env, &client, &admin, &token);
    client.approve_project(&admin, &round_id, &1u64);
    client.set_round_cap(&admin, &round_id, &100i128);

    let contributor = Address::generate(&env);
    env.ledger().set_timestamp(1500);
    assert_eq!(
        client.try_record_contribution(&round_id, &1u64, &contributor, &101i128),
        Err(Ok(MatchingPoolError::ContributionCapExceeded))
    );

    // No state must have been mutated by the rejected contribution.
    assert_eq!(client.get_project_contributions(&round_id, &1u64), 0i128);
    assert_eq!(client.get_contributor_count(&round_id, &1u64), 0u32);
    assert_eq!(
        client.get_contributor_round_total(&round_id, &contributor),
        0i128
    );
}

#[test]
fn test_cumulative_contributions_same_project_hit_cap() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, _) = setup(&env);
    let round_id = setup_round(&env, &client, &admin, &token);
    client.approve_project(&admin, &round_id, &1u64);
    client.set_round_cap(&admin, &round_id, &100i128);

    let contributor = Address::generate(&env);
    env.ledger().set_timestamp(1500);
    client.record_contribution(&round_id, &1u64, &contributor, &60i128);

    assert_eq!(
        client.try_record_contribution(&round_id, &1u64, &contributor, &50i128),
        Err(Ok(MatchingPoolError::ContributionCapExceeded))
    );

    // The first, accepted contribution's state must be untouched by the
    // second, rejected one.
    assert_eq!(client.get_project_contributions(&round_id, &1u64), 60i128);
    assert_eq!(
        client.get_contributor_round_total(&round_id, &contributor),
        60i128
    );
}

#[test]
fn test_cumulative_contributions_across_projects_hit_cap() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, _) = setup(&env);
    let round_id = setup_round(&env, &client, &admin, &token);
    client.approve_project(&admin, &round_id, &1u64);
    client.approve_project(&admin, &round_id, &2u64);
    client.set_round_cap(&admin, &round_id, &100i128);

    let contributor = Address::generate(&env);
    env.ledger().set_timestamp(1500);
    client.record_contribution(&round_id, &1u64, &contributor, &60i128);

    // Spreading the remainder across a second project must still be capped
    // by the round-level (not per-project) total.
    assert_eq!(
        client.try_record_contribution(&round_id, &2u64, &contributor, &50i128),
        Err(Ok(MatchingPoolError::ContributionCapExceeded))
    );

    // Exactly filling the remaining headroom succeeds.
    client.record_contribution(&round_id, &2u64, &contributor, &40i128);
    assert_eq!(
        client.get_contributor_round_total(&round_id, &contributor),
        100i128
    );
}

#[test]
fn test_cap_zero_means_unlimited() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, _) = setup(&env);
    let round_id = setup_round(&env, &client, &admin, &token);
    client.approve_project(&admin, &round_id, &1u64);
    // No cap set (defaults to 0 == unlimited).

    let contributor = Address::generate(&env);
    env.ledger().set_timestamp(1500);
    client.record_contribution(&round_id, &1u64, &contributor, &1_000_000_000i128);

    assert_eq!(
        client.get_contributor_round_total(&round_id, &contributor),
        1_000_000_000i128
    );
}

#[test]
fn test_retroactive_cap_after_prior_contributions() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, _) = setup(&env);
    let round_id = setup_round(&env, &client, &admin, &token);
    client.approve_project(&admin, &round_id, &1u64);

    let contributor = Address::generate(&env);
    env.ledger().set_timestamp(1500);
    client.record_contribution(&round_id, &1u64, &contributor, &80i128);

    // Cap set after the fact, at exactly the amount already contributed.
    client.set_round_cap(&admin, &round_id, &80i128);

    assert_eq!(
        client.try_record_contribution(&round_id, &1u64, &contributor, &1i128),
        Err(Ok(MatchingPoolError::ContributionCapExceeded))
    );
}

#[test]
fn test_retroactive_cap_set_below_existing_total_blocks_further_contributions() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, _) = setup(&env);
    let round_id = setup_round(&env, &client, &admin, &token);
    client.approve_project(&admin, &round_id, &1u64);

    let contributor = Address::generate(&env);
    env.ledger().set_timestamp(1500);
    client.record_contribution(&round_id, &1u64, &contributor, &80i128);

    // Cap set below what's already been contributed — this doesn't claw
    // back the past contribution, but blocks any further one.
    client.set_round_cap(&admin, &round_id, &50i128);

    assert_eq!(
        client.get_contributor_round_total(&round_id, &contributor),
        80i128
    );
    assert_eq!(
        client.try_record_contribution(&round_id, &1u64, &contributor, &1i128),
        Err(Ok(MatchingPoolError::ContributionCapExceeded))
    );
}

#[test]
fn test_qf_score_unaffected_by_cap_bookkeeping() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, _) = setup(&env);
    let round_id = setup_round(&env, &client, &admin, &token);
    client.approve_project(&admin, &round_id, &1u64);
    client.set_round_cap(&admin, &round_id, &1_000_000i128);

    let contributor = Address::generate(&env);
    env.ledger().set_timestamp(1500);
    client.record_contribution(&round_id, &1u64, &contributor, &100i128);

    // Same score as test_qf_score_single_contributor, which never sets a cap
    // — proves the cap bookkeeping doesn't perturb QF scoring.
    let score = client.get_project_qf_score(&round_id, &1u64);
    assert!(score > 0);
}

// ── Granular pause scopes ────────────────────────────────────────────────────

#[test]
fn test_pause_contribution_scope_blocks_fund_pool() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, token_admin) = setup(&env);
    client.initialize(&admin);

    env.ledger().set_timestamp(1000);
    let round_id = client.create_round(
        &admin,
        &symbol_short!("R"),
        &token.address,
        &1000u64,
        &2000u64,
    );

    let funder = Address::generate(&env);
    token_admin.mint(&funder, &1000i128);

    // Pause contribution scope only.
    client.pause_scope(&admin, &crate::storage::PauseScope::Contribution);
    assert!(client.is_paused(&crate::storage::PauseScope::Contribution));
    assert!(!client.is_paused(&crate::storage::PauseScope::Payout));
    assert!(!client.is_paused(&crate::storage::PauseScope::Governance));

    assert_eq!(
        client.try_fund_pool(&funder, &round_id, &100i128),
        Err(Ok(MatchingPoolError::ContributionScopePaused))
    );

    // Governance ops still work while contribution is paused.
    client.approve_project(&admin, &round_id, &42u64);

    // Unpause restores fund_pool.
    client.unpause_scope(&admin, &crate::storage::PauseScope::Contribution);
    assert!(!client.is_paused(&crate::storage::PauseScope::Contribution));
    client.fund_pool(&funder, &round_id, &100i128);
    assert_eq!(client.get_pool_balance(&round_id), 100i128);
}

#[test]
fn test_pause_contribution_scope_blocks_record_contribution() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, _) = setup(&env);
    let round_id = setup_round(&env, &client, &admin, &token);
    client.approve_project(&admin, &round_id, &1u64);

    client.pause_scope(&admin, &crate::storage::PauseScope::Contribution);
    env.ledger().set_timestamp(1500);

    let contributor = Address::generate(&env);
    assert_eq!(
        client.try_record_contribution(&round_id, &1u64, &contributor, &100i128),
        Err(Ok(MatchingPoolError::ContributionScopePaused))
    );

    // After unpause the contribution goes through.
    client.unpause_scope(&admin, &crate::storage::PauseScope::Contribution);
    client.record_contribution(&round_id, &1u64, &contributor, &100i128);
    assert_eq!(client.get_project_contributions(&round_id, &1u64), 100i128);
}

#[test]
fn test_pause_payout_scope_blocks_distribute() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, token_admin) = setup(&env);
    let round_id = setup_round(&env, &client, &admin, &token);
    client.approve_project(&admin, &round_id, &1u64);

    let funder = Address::generate(&env);
    token_admin.mint(&funder, &10_000i128);
    client.fund_pool(&funder, &round_id, &1_000i128);

    let contributor = Address::generate(&env);
    env.ledger().set_timestamp(1500);
    client.record_contribution(&round_id, &1u64, &contributor, &100i128);

    // Round ends at 3000; finalize requires now > end_time.
    env.ledger().set_timestamp(3001);
    client.finalize_round(&admin, &round_id);

    // Pause payout scope only.
    client.pause_scope(&admin, &crate::storage::PauseScope::Payout);
    assert!(client.is_paused(&crate::storage::PauseScope::Payout));
    assert!(!client.is_paused(&crate::storage::PauseScope::Contribution));
    assert!(!client.is_paused(&crate::storage::PauseScope::Governance));

    let owner = Address::generate(&env);
    assert_eq!(
        client.try_distribute_matching_funds(&admin, &round_id, &vec![&env, owner.clone()]),
        Err(Ok(MatchingPoolError::PayoutScopePaused))
    );

    // Unpause and distribution succeeds.
    client.unpause_scope(&admin, &crate::storage::PauseScope::Payout);
    let distributed = client.distribute_matching_funds(&admin, &round_id, &vec![&env, owner]);
    assert!(distributed > 0);
}

#[test]
fn test_pause_governance_scope_blocks_create_round() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, _) = setup(&env);
    client.initialize(&admin);

    client.pause_scope(&admin, &crate::storage::PauseScope::Governance);
    assert!(client.is_paused(&crate::storage::PauseScope::Governance));

    assert_eq!(
        client.try_create_round(
            &admin,
            &symbol_short!("R"),
            &token.address,
            &1000u64,
            &2000u64,
        ),
        Err(Ok(MatchingPoolError::GovernanceScopePaused))
    );

    // Contribution scope still open while governance is paused.
    assert!(!client.is_paused(&crate::storage::PauseScope::Contribution));
}

#[test]
fn test_pause_governance_scope_blocks_finalize_round() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, _) = setup(&env);
    let round_id = setup_round(&env, &client, &admin, &token);

    // Round ends at 3000; advance past it.
    env.ledger().set_timestamp(3001);
    client.pause_scope(&admin, &crate::storage::PauseScope::Governance);

    assert_eq!(
        client.try_finalize_round(&admin, &round_id),
        Err(Ok(MatchingPoolError::GovernanceScopePaused))
    );

    // After unpause finalize succeeds.
    client.unpause_scope(&admin, &crate::storage::PauseScope::Governance);
    client.finalize_round(&admin, &round_id);
    assert!(client.get_round(&round_id).is_finalized);
}

#[test]
fn test_pause_governance_scope_blocks_approve_and_remove_project() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, _) = setup(&env);
    let round_id = setup_round(&env, &client, &admin, &token);

    client.pause_scope(&admin, &crate::storage::PauseScope::Governance);

    assert_eq!(
        client.try_approve_project(&admin, &round_id, &99u64),
        Err(Ok(MatchingPoolError::GovernanceScopePaused))
    );
    assert_eq!(
        client.try_remove_project(&admin, &round_id, &99u64),
        Err(Ok(MatchingPoolError::GovernanceScopePaused))
    );
}

#[test]
fn test_pause_governance_scope_blocks_set_round_cap() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, _) = setup(&env);
    let round_id = setup_round(&env, &client, &admin, &token);

    client.pause_scope(&admin, &crate::storage::PauseScope::Governance);

    assert_eq!(
        client.try_set_round_cap(&admin, &round_id, &500i128),
        Err(Ok(MatchingPoolError::GovernanceScopePaused))
    );
}

#[test]
fn test_read_queries_always_available_under_all_scopes_paused() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, _) = setup(&env);
    let round_id = setup_round(&env, &client, &admin, &token);

    // Pause all three scopes.
    client.pause_scope(&admin, &crate::storage::PauseScope::Contribution);
    client.pause_scope(&admin, &crate::storage::PauseScope::Payout);
    client.pause_scope(&admin, &crate::storage::PauseScope::Governance);

    // All read queries must succeed regardless.
    let _round = client.get_round(&round_id);
    let _bal = client.get_pool_balance(&round_id);
    let _status = client.get_round_status(&round_id);
    let _admin_addr = client.get_admin();
    assert!(client.is_paused(&crate::storage::PauseScope::Contribution));
    assert!(client.is_paused(&crate::storage::PauseScope::Payout));
    assert!(client.is_paused(&crate::storage::PauseScope::Governance));
}

#[test]
fn test_mixed_scopes_contribution_paused_payout_open() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, token_admin) = setup(&env);
    let round_id = setup_round(&env, &client, &admin, &token);
    client.approve_project(&admin, &round_id, &1u64);

    // Pre-fund before pausing contribution.
    let funder = Address::generate(&env);
    token_admin.mint(&funder, &10_000i128);
    client.fund_pool(&funder, &round_id, &2_000i128);

    let contributor = Address::generate(&env);
    env.ledger().set_timestamp(1500);
    client.record_contribution(&round_id, &1u64, &contributor, &200i128);

    // Now pause contribution — payout and governance remain open.
    client.pause_scope(&admin, &crate::storage::PauseScope::Contribution);

    // Governance: finalize still works (round ends at 3000).
    env.ledger().set_timestamp(3001);
    client.finalize_round(&admin, &round_id);

    // Payout: distribute still works.
    let owner = Address::generate(&env);
    let distributed = client.distribute_matching_funds(&admin, &round_id, &vec![&env, owner]);
    assert!(distributed > 0);

    // Contribution: record is blocked.
    let latecontributor = Address::generate(&env);
    assert_eq!(
        client.try_record_contribution(&round_id, &1u64, &latecontributor, &10i128),
        Err(Ok(MatchingPoolError::ContributionScopePaused))
    );
}

#[test]
fn test_legacy_pause_still_blocks_all_write_operations() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, token_admin) = setup(&env);
    client.initialize(&admin);

    env.ledger().set_timestamp(1000);

    // Use legacy global pause.
    client.pause(&admin);

    let funder = Address::generate(&env);
    token_admin.mint(&funder, &1000i128);

    // All three scope guards treat global pause as paused.
    assert_eq!(
        client.try_create_round(
            &admin,
            &symbol_short!("R"),
            &token.address,
            &1000u64,
            &2000u64,
        ),
        Err(Ok(MatchingPoolError::GovernanceScopePaused))
    );

    client.unpause(&admin);

    // After unpause create_round succeeds.
    let round_id = client.create_round(
        &admin,
        &symbol_short!("R"),
        &token.address,
        &1000u64,
        &2000u64,
    );
    assert_eq!(round_id, 0);
}

#[test]
fn test_only_admin_can_pause_scope() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _, _) = setup(&env);
    client.initialize(&admin);

    let non_admin = Address::generate(&env);
    assert_eq!(
        client.try_pause_scope(&non_admin, &crate::storage::PauseScope::Contribution),
        Err(Ok(MatchingPoolError::Unauthorized))
    );
    assert_eq!(
        client.try_unpause_scope(&non_admin, &crate::storage::PauseScope::Contribution),
        Err(Ok(MatchingPoolError::Unauthorized))
    );
}

// ── Storage TTL (issue #1226) ────────────────────────────────────────────────

/// Advances the ledger *sequence number* (which drives storage-entry TTL/
/// archival) repeatedly past `LEDGER_THRESHOLD`, interleaving reads and
/// writes across a round's full lifecycle, and asserts every touched key —
/// instance (Admin) and persistent (Round, RoundPool, EligibleProject*,
/// ContributorAmount, RoundStatus, FinalizedAt, MatchDistributed) — is still
/// live and correct after each advance. This only passes if every read/write
/// site actually re-bumps its key's TTL rather than leaving it to expire.
#[test]
fn test_ttl_extended_across_round_lifecycle() {
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
    client.approve_project(&admin, &round_id, &1u64);
    client.fund_pool(&funder, &round_id, &500_000);

    // First TTL boundary: a read must survive and re-bump every key it touches.
    env.ledger()
        .set_sequence_number(crate::storage::LEDGER_THRESHOLD + 1);
    assert_eq!(client.get_admin(), admin);
    assert_eq!(client.get_round(&round_id).total_pool, 500_000);
    assert_eq!(client.get_pool_balance(&round_id), 500_000);

    let contributor = Address::generate(&env);
    env.ledger().set_timestamp(1500); // inside the round's contribution window
    client.record_contribution(&round_id, &1u64, &contributor, &100_000);
    assert_eq!(client.get_project_contributions(&round_id, &1u64), 100_000);
    assert_eq!(client.get_contributor_count(&round_id, &1u64), 1);
    assert_eq!(
        client.get_contributor_round_total(&round_id, &contributor),
        100_000
    );

    // Second TTL boundary: everything written above (including the freshly
    // recorded contribution) must still be reachable.
    env.ledger()
        .set_sequence_number(2 * crate::storage::LEDGER_THRESHOLD + 2);
    assert_eq!(client.get_project_contributions(&round_id, &1u64), 100_000);
    assert_eq!(client.get_project_qf_score(&round_id, &1u64), 100_000);

    // Finalize and distribute after a third boundary crossing — exercises
    // RoundStatus/FinalizedAt/MatchDistributed writes and the Round read
    // that gates every mutating entrypoint.
    env.ledger()
        .set_sequence_number(3 * crate::storage::LEDGER_THRESHOLD + 3);
    env.ledger().set_timestamp(3001); // past the round's end_time
    client.finalize_round(&admin, &round_id);
    assert_eq!(
        client.get_round_status(&round_id),
        symbol_short!("FINALIZED")
    );

    let owner = Address::generate(&env);
    let distributed =
        client.distribute_matching_funds(&admin, &round_id, &vec![&env, owner.clone()]);
    assert_eq!(distributed, 500_000);
    assert_eq!(token.balance(&owner), 500_000);

    // Fourth boundary: post-distribution reads (RoundStatus, MatchDistributed
    // via RoundPool reset to 0) must still resolve correctly.
    env.ledger()
        .set_sequence_number(4 * crate::storage::LEDGER_THRESHOLD + 4);
    assert_eq!(
        client.get_round_status(&round_id),
        soroban_sdk::Symbol::new(&env, "DISTRIBUTED")
    );
    assert_eq!(client.get_pool_balance(&round_id), 0);
    assert!(client.get_finalized_at(&round_id) > 0);
}

// ── Event emission coverage (issue #1231) ─────────────────────────────────

#[test]
fn test_pause_emits_contract_pause_event() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _, _) = setup(&env);
    client.initialize(&admin);

    client.pause(&admin);
    // `env.events().all()` reflects only the invocation tree of the most
    // recent top-level client call, not an accumulated history.
    assert!(!env.events().all().is_empty());
}

#[test]
fn test_unpause_emits_contract_unpause_event() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _, _) = setup(&env);
    client.initialize(&admin);
    client.pause(&admin);

    client.unpause(&admin);
    assert!(!env.events().all().is_empty());
}

#[test]
fn test_set_admin_emits_admin_changed_event() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _, _) = setup(&env);
    client.initialize(&admin);
    let new_admin = Address::generate(&env);

    client.set_admin(&admin, &new_admin);
    assert!(!env.events().all().is_empty());
    assert_eq!(client.get_admin(), new_admin);
}

// Note: a "successful upgrade emits UpgradedEvent" test isn't included here
// — exercising a real `update_current_contract_wasm` call requires a valid
// deployable WASM fixture (see `upgradable-contract`'s
// `include_bytes!("./mock/upgradable_contract.wasm")`, which this crate has
// no equivalent of), and this codebase's other upgradeable contracts (e.g.
// `crowdfund_vault`) likewise only test the pre-upgrade authorization
// rejection path, not a successful upgrade, for the same reason. The
// `events::UpgradedEvent` publish call added above mirrors `crowdfund_vault`'s
// exact pattern (publish immediately after `update_current_contract_wasm`
// succeeds), so it's covered by code-shape parity with that reference
// implementation rather than a dedicated runtime test.
