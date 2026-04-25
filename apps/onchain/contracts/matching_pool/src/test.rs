use crate::errors::MatchingPoolError;
use crate::{MatchingPoolContract, MatchingPoolContractClient};
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Ledger},
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
