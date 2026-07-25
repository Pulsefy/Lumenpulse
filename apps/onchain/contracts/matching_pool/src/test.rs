use crate::errors::MatchingPoolError;
use crate::storage::PoolScope;
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

    assert_eq!(
        client.try_approve_project(&admin, &round_id, &42u64),
        Err(Ok(MatchingPoolError::ProjectAlreadyEligible))
    );

    client.remove_project(&admin, &round_id, &42u64);

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
    env.ledger().set_timestamp(1500);
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
    env.ledger().set_timestamp(4000);
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
    client.approve_project(&admin, &round_id, &1u64);
    client.approve_project(&admin, &round_id, &2u64);

    env.ledger().set_timestamp(1500);
    for _ in 0..4 {
        let c = Address::generate(&env);
        client.record_contribution(&round_id, &1u64, &c, &25);
    }
    let c = Address::generate(&env);
    client.record_contribution(&round_id, &2u64, &c, &100);

    let score1 = client.get_project_qf_score(&round_id, &1u64);
    let score2 = client.get_project_qf_score(&round_id, &2u64);
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
    for _ in 0..4 {
        let c = Address::generate(&env);
        client.record_contribution(&round_id, &1u64, &c, &25);
    }
    let c = Address::generate(&env);
    client.record_contribution(&round_id, &2u64, &c, &100);

    env.ledger().set_timestamp(4000);
    client.finalize_round(&admin, &round_id);

    let owners = vec![&env, owner1.clone(), owner2.clone()];
    let total = client.distribute_matching_funds(&admin, &round_id, &owners);

    assert_eq!(total, 1_000_000);
    assert!(token.balance(&owner1) > token.balance(&owner2));

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

    env.ledger().set_timestamp(2000);
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
    assert_eq!(preview.len(), 4);
    let alloc0 = preview.get(1).unwrap();
    let alloc1 = preview.get(3).unwrap();
    assert_eq!(alloc0 + alloc1, 1_000_000);
}

// ── Reentrancy guard ─────────────────────────────────────────────────────────

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

// ── Granular pause scopes ────────────────────────────────────────────────────
//
// These tests cover Issue #910: each scope blocks only its own domain; other
// scopes and read-only queries remain available; unpausing restores full
// access; and `is_scope_paused` reflects the actual state.

// -- is_scope_paused reflects pause state ────────────────────────────────────

#[test]
fn test_is_scope_paused_reflects_state() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _, _) = setup(&env);
    client.initialize(&admin);

    // All scopes start unpaused.
    assert!(!client.is_scope_paused(&PoolScope::Contributions));
    assert!(!client.is_scope_paused(&PoolScope::Payouts));
    assert!(!client.is_scope_paused(&PoolScope::Governance));

    client.pause_scope(&admin, &PoolScope::Contributions);
    assert!(client.is_scope_paused(&PoolScope::Contributions));
    assert!(!client.is_scope_paused(&PoolScope::Payouts));
    assert!(!client.is_scope_paused(&PoolScope::Governance));

    client.unpause_scope(&admin, &PoolScope::Contributions);
    assert!(!client.is_scope_paused(&PoolScope::Contributions));
}

// -- Contributions scope ──────────────────────────────────────────────────────

#[test]
fn test_contributions_scope_blocks_fund_pool() {
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

    client.pause_scope(&admin, &PoolScope::Contributions);

    assert_eq!(
        client.try_fund_pool(&funder, &round_id, &100_000),
        Err(Ok(MatchingPoolError::ScopePaused))
    );
    // Pool balance unchanged.
    assert_eq!(client.get_pool_balance(&round_id), 0);
}

#[test]
fn test_contributions_scope_blocks_record_contribution() {
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

    client.pause_scope(&admin, &PoolScope::Contributions);

    let contributor = Address::generate(&env);
    env.ledger().set_timestamp(1500);
    assert_eq!(
        client.try_record_contribution(&round_id, &1u64, &contributor, &100),
        Err(Ok(MatchingPoolError::ScopePaused))
    );
    assert_eq!(client.get_project_contributions(&round_id, &1u64), 0);
}

#[test]
fn test_contributions_scope_unpause_restores_fund_pool() {
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

    client.pause_scope(&admin, &PoolScope::Contributions);
    assert_eq!(
        client.try_fund_pool(&funder, &round_id, &100_000),
        Err(Ok(MatchingPoolError::ScopePaused))
    );

    client.unpause_scope(&admin, &PoolScope::Contributions);
    client.fund_pool(&funder, &round_id, &100_000);
    assert_eq!(client.get_pool_balance(&round_id), 100_000);
}

#[test]
fn test_contributions_scope_unpause_restores_record_contribution() {
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

    client.pause_scope(&admin, &PoolScope::Contributions);
    client.unpause_scope(&admin, &PoolScope::Contributions);

    let contributor = Address::generate(&env);
    env.ledger().set_timestamp(1500);
    client.record_contribution(&round_id, &1u64, &contributor, &200);
    assert_eq!(client.get_project_contributions(&round_id, &1u64), 200);
}

// -- Payouts scope ────────────────────────────────────────────────────────────

#[test]
fn test_payouts_scope_blocks_finalize_round() {
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

    client.pause_scope(&admin, &PoolScope::Payouts);

    env.ledger().set_timestamp(4000);
    assert_eq!(
        client.try_finalize_round(&admin, &round_id),
        Err(Ok(MatchingPoolError::ScopePaused))
    );
    let round = client.get_round(&round_id);
    assert!(!round.is_finalized);
}

#[test]
fn test_payouts_scope_blocks_distribute_matching_funds() {
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

    // Finalize while Payouts is still unpaused, then pause.
    env.ledger().set_timestamp(4000);
    client.finalize_round(&admin, &round_id);

    client.pause_scope(&admin, &PoolScope::Payouts);

    let owners = vec![&env, owner1.clone()];
    assert_eq!(
        client.try_distribute_matching_funds(&admin, &round_id, &owners),
        Err(Ok(MatchingPoolError::ScopePaused))
    );
    let round = client.get_round(&round_id);
    assert!(!round.is_distributed);
}

#[test]
fn test_payouts_scope_unpause_restores_finalize_and_distribute() {
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

    client.pause_scope(&admin, &PoolScope::Payouts);

    env.ledger().set_timestamp(4000);
    assert_eq!(
        client.try_finalize_round(&admin, &round_id),
        Err(Ok(MatchingPoolError::ScopePaused))
    );

    client.unpause_scope(&admin, &PoolScope::Payouts);
    client.finalize_round(&admin, &round_id);

    let owners = vec![&env, owner1.clone()];
    let total = client.distribute_matching_funds(&admin, &round_id, &owners);
    assert_eq!(total, 1_000_000);
}

// -- Governance scope ─────────────────────────────────────────────────────────

#[test]
fn test_governance_scope_blocks_create_round() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, _) = setup(&env);
    client.initialize(&admin);

    client.pause_scope(&admin, &PoolScope::Governance);

    assert_eq!(
        client.try_create_round(
            &admin,
            &symbol_short!("R1"),
            &token.address,
            &1000u64,
            &3000u64,
        ),
        Err(Ok(MatchingPoolError::ScopePaused))
    );
}

#[test]
fn test_governance_scope_blocks_approve_project() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, _) = setup(&env);
    client.initialize(&admin);

    // Create round before pausing governance.
    env.ledger().set_timestamp(500);
    let round_id = client.create_round(
        &admin,
        &symbol_short!("R1"),
        &token.address,
        &1000u64,
        &3000u64,
    );

    client.pause_scope(&admin, &PoolScope::Governance);

    assert_eq!(
        client.try_approve_project(&admin, &round_id, &1u64),
        Err(Ok(MatchingPoolError::ScopePaused))
    );
}

#[test]
fn test_governance_scope_blocks_remove_project() {
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
    // Approve project before pausing.
    client.approve_project(&admin, &round_id, &1u64);

    client.pause_scope(&admin, &PoolScope::Governance);

    assert_eq!(
        client.try_remove_project(&admin, &round_id, &1u64),
        Err(Ok(MatchingPoolError::ScopePaused))
    );
}

#[test]
fn test_governance_scope_blocks_set_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _, _) = setup(&env);
    client.initialize(&admin);

    client.pause_scope(&admin, &PoolScope::Governance);

    let new_admin = Address::generate(&env);
    assert_eq!(
        client.try_set_admin(&admin, &new_admin),
        Err(Ok(MatchingPoolError::ScopePaused))
    );
    // Admin unchanged.
    assert_eq!(client.get_admin(), admin);
}

#[test]
fn test_governance_scope_unpause_restores_create_round() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, _) = setup(&env);
    client.initialize(&admin);

    client.pause_scope(&admin, &PoolScope::Governance);
    assert_eq!(
        client.try_create_round(
            &admin,
            &symbol_short!("R1"),
            &token.address,
            &1000u64,
            &3000u64,
        ),
        Err(Ok(MatchingPoolError::ScopePaused))
    );

    client.unpause_scope(&admin, &PoolScope::Governance);
    env.ledger().set_timestamp(500);
    let round_id = client.create_round(
        &admin,
        &symbol_short!("R1"),
        &token.address,
        &1000u64,
        &3000u64,
    );
    assert_eq!(round_id, 0);
}

// -- Mixed scope isolation ────────────────────────────────────────────────────
// Pausing one scope must not affect other scopes.

#[test]
fn test_pausing_contributions_does_not_block_governance() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, _) = setup(&env);
    client.initialize(&admin);

    client.pause_scope(&admin, &PoolScope::Contributions);

    // Governance action still works.
    env.ledger().set_timestamp(500);
    let round_id = client.create_round(
        &admin,
        &symbol_short!("R1"),
        &token.address,
        &1000u64,
        &3000u64,
    );
    client.approve_project(&admin, &round_id, &1u64);

    assert!(!client.is_scope_paused(&PoolScope::Governance));
    assert!(!client.is_scope_paused(&PoolScope::Payouts));
}

#[test]
fn test_pausing_payouts_does_not_block_contributions() {
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

    client.pause_scope(&admin, &PoolScope::Payouts);

    // fund_pool (Contributions scope) still works.
    client.fund_pool(&funder, &round_id, &500_000);
    assert_eq!(client.get_pool_balance(&round_id), 500_000);

    // record_contribution (Contributions scope) still works.
    let contributor = Address::generate(&env);
    env.ledger().set_timestamp(1500);
    client.record_contribution(&round_id, &1u64, &contributor, &100);
    assert_eq!(client.get_project_contributions(&round_id, &1u64), 100);
}

#[test]
fn test_pausing_governance_does_not_block_contributions_or_payouts() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, token_admin) = setup(&env);
    client.initialize(&admin);

    let funder = Address::generate(&env);
    let owner1 = Address::generate(&env);
    token_admin.mint(&funder, &1_000_000);

    // Create round and approve project BEFORE pausing governance.
    env.ledger().set_timestamp(500);
    let round_id = client.create_round(
        &admin,
        &symbol_short!("R1"),
        &token.address,
        &1000u64,
        &3000u64,
    );
    client.approve_project(&admin, &round_id, &1u64);

    client.pause_scope(&admin, &PoolScope::Governance);

    // fund_pool (Contributions) still works.
    client.fund_pool(&funder, &round_id, &1_000_000);

    // record_contribution (Contributions) still works.
    env.ledger().set_timestamp(1500);
    let c = Address::generate(&env);
    client.record_contribution(&round_id, &1u64, &c, &100);

    // finalize_round (Payouts) still works.
    env.ledger().set_timestamp(4000);
    client.finalize_round(&admin, &round_id);

    // distribute_matching_funds (Payouts) still works.
    let owners = vec![&env, owner1.clone()];
    let total = client.distribute_matching_funds(&admin, &round_id, &owners);
    assert_eq!(total, 1_000_000);
}

// -- Read-only queries remain available under any scope pause ─────────────────

#[test]
fn test_read_only_queries_available_when_contributions_paused() {
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

    let contributor = Address::generate(&env);
    env.ledger().set_timestamp(1500);
    client.record_contribution(&round_id, &1u64, &contributor, &100);

    // Now pause Contributions.
    client.pause_scope(&admin, &PoolScope::Contributions);

    // All read-only queries must succeed.
    let round = client.get_round(&round_id);
    assert_eq!(round.total_pool, 500_000);
    assert_eq!(client.get_pool_balance(&round_id), 500_000);
    assert_eq!(client.get_project_contributions(&round_id, &1u64), 100);
    assert_eq!(client.get_contributor_count(&round_id, &1u64), 1);
    assert!(client.get_project_qf_score(&round_id, &1u64) > 0);
    assert_eq!(client.get_round_status(&round_id), symbol_short!("ACTIVE"));
    assert_eq!(client.get_admin(), admin);
    assert!(client.is_scope_paused(&PoolScope::Contributions));
}

#[test]
fn test_read_only_queries_available_when_all_scopes_paused() {
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
    client.fund_pool(&funder, &round_id, &200_000);

    // Pause every scope.
    client.pause_scope(&admin, &PoolScope::Contributions);
    client.pause_scope(&admin, &PoolScope::Payouts);
    client.pause_scope(&admin, &PoolScope::Governance);

    // Read-only queries still work.
    assert_eq!(client.get_admin(), admin);
    let round = client.get_round(&round_id);
    assert_eq!(round.id, round_id);
    assert_eq!(client.get_pool_balance(&round_id), 200_000);
    assert!(client.is_scope_paused(&PoolScope::Contributions));
    assert!(client.is_scope_paused(&PoolScope::Payouts));
    assert!(client.is_scope_paused(&PoolScope::Governance));
}

// -- Only admin can pause/unpause ─────────────────────────────────────────────

#[test]
fn test_non_admin_cannot_pause_scope() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _, _) = setup(&env);
    client.initialize(&admin);

    let not_admin = Address::generate(&env);
    assert_eq!(
        client.try_pause_scope(&not_admin, &PoolScope::Contributions),
        Err(Ok(MatchingPoolError::Unauthorized))
    );
    assert!(!client.is_scope_paused(&PoolScope::Contributions));
}

#[test]
fn test_non_admin_cannot_unpause_scope() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _, _) = setup(&env);
    client.initialize(&admin);

    client.pause_scope(&admin, &PoolScope::Payouts);

    let not_admin = Address::generate(&env);
    assert_eq!(
        client.try_unpause_scope(&not_admin, &PoolScope::Payouts),
        Err(Ok(MatchingPoolError::Unauthorized))
    );
    // Still paused.
    assert!(client.is_scope_paused(&PoolScope::Payouts));
}

// -- Mixed pause/unpause cycle (full integration) ────────────────────────────

#[test]
fn test_mixed_pause_unpause_full_round_lifecycle() {
    // Demonstrates a realistic incident response scenario:
    // 1. Contributions paused mid-round to halt new inflows.
    // 2. Governance remains live so admin can adjust eligible projects.
    // 3. Contributions unpaused to collect final contributions.
    // 4. Payouts executed normally to completion.
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, token_admin) = setup(&env);
    client.initialize(&admin);

    let funder = Address::generate(&env);
    let owner1 = Address::generate(&env);
    let owner2 = Address::generate(&env);
    token_admin.mint(&funder, &2_000_000);

    // --- Round setup (all scopes open) ---
    env.ledger().set_timestamp(500);
    let round_id = client.create_round(
        &admin,
        &symbol_short!("R1"),
        &token.address,
        &1000u64,
        &5000u64,
    );
    client.approve_project(&admin, &round_id, &1u64);
    client.approve_project(&admin, &round_id, &2u64);
    client.fund_pool(&funder, &round_id, &1_000_000);

    // First wave of contributions.
    env.ledger().set_timestamp(1500);
    for _ in 0..4 {
        let c = Address::generate(&env);
        client.record_contribution(&round_id, &1u64, &c, &25);
    }

    // --- Incident: pause Contributions (but not Governance or Payouts) ---
    client.pause_scope(&admin, &PoolScope::Contributions);
    assert!(client.is_scope_paused(&PoolScope::Contributions));
    assert!(!client.is_scope_paused(&PoolScope::Governance));
    assert!(!client.is_scope_paused(&PoolScope::Payouts));

    // New contributions blocked.
    let late_contributor = Address::generate(&env);
    assert_eq!(
        client.try_record_contribution(&round_id, &1u64, &late_contributor, &50),
        Err(Ok(MatchingPoolError::ScopePaused))
    );

    // Governance still live: admin removes a project and adds another.
    client.remove_project(&admin, &round_id, &2u64);
    client.approve_project(&admin, &round_id, &3u64);

    // --- Resolution: unpause Contributions ---
    client.unpause_scope(&admin, &PoolScope::Contributions);
    assert!(!client.is_scope_paused(&PoolScope::Contributions));

    // Late contributions now accepted.
    let c2 = Address::generate(&env);
    client.record_contribution(&round_id, &1u64, &c2, &100);

    // Additional pool funding also accepted.
    client.fund_pool(&funder, &round_id, &500_000);
    assert_eq!(client.get_pool_balance(&round_id), 1_500_000);

    // --- Payout ---
    env.ledger().set_timestamp(6000);
    client.finalize_round(&admin, &round_id);

    let owners = vec![&env, owner1.clone(), owner2.clone()];
    let total = client.distribute_matching_funds(&admin, &round_id, &owners);
    assert_eq!(total, 1_500_000);

    // Round is fully distributed.
    let round = client.get_round(&round_id);
    assert!(round.is_distributed);
    assert_eq!(client.get_pool_balance(&round_id), 0);
}
