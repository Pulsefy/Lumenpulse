use crate::errors::RegistryError;
use crate::storage::{VerificationStatus, WeightMode};
use crate::{ProjectRegistryContract, ProjectRegistryContractClient};
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Ledger},
    Address, Env,
};

fn setup<'a>(
    env: &'a Env,
    quorum: i128,
    mode: WeightMode,
) -> (ProjectRegistryContractClient<'a>, Address) {
    let admin = Address::generate(env);
    let id = env.register(ProjectRegistryContract, ());
    let client = ProjectRegistryContractClient::new(env, &id);
    client.initialize(&admin, &quorum, &mode, &None, &None, &1i128);
    (client, admin)
}

// ── Initialization ────────────────────────────────────────────────────────────

#[test]
fn test_initialize() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env, 100, WeightMode::Flat);
    assert_eq!(client.get_admin(), admin);
    let config = client.get_config();
    assert_eq!(config.quorum_threshold, 100);
}

#[test]
fn test_double_init_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env, 100, WeightMode::Flat);
    assert_eq!(
        client.try_initialize(&admin, &100, &WeightMode::Flat, &None, &None, &1),
        Err(Ok(RegistryError::AlreadyInitialized))
    );
}

#[test]
fn test_zero_quorum_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let id = env.register(ProjectRegistryContract, ());
    let client = ProjectRegistryContractClient::new(&env, &id);
    assert_eq!(
        client.try_initialize(&admin, &0, &WeightMode::Flat, &None, &None, &1),
        Err(Ok(RegistryError::InvalidThreshold))
    );
}

// ── Project registration ──────────────────────────────────────────────────────

#[test]
fn test_register_project() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = setup(&env, 3, WeightMode::Flat);
    let owner = Address::generate(&env);
    client.register_project(&owner, &1u64, &symbol_short!("MyProj"));
    let entry = client.get_project(&1u64);
    assert_eq!(entry.project_id, 1);
    assert_eq!(entry.status, VerificationStatus::Pending);
    assert_eq!(entry.votes_for, 0);
}

#[test]
fn test_duplicate_registration_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = setup(&env, 3, WeightMode::Flat);
    let owner = Address::generate(&env);
    client.register_project(&owner, &1u64, &symbol_short!("P"));
    assert_eq!(
        client.try_register_project(&owner, &1u64, &symbol_short!("P")),
        Err(Ok(RegistryError::ProjectAlreadyRegistered))
    );
}

// ── Voting ────────────────────────────────────────────────────────────────────

#[test]
fn test_vote_for_accumulates() {
    let env = Env::default();
    env.mock_all_auths();
    // Flat mode, quorum = 3 — need 3 votes to verify
    let (client, _) = setup(&env, 3, WeightMode::Flat);
    let owner = Address::generate(&env);
    client.register_project(&owner, &1u64, &symbol_short!("P"));

    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    client.cast_vote(&v1, &1u64, &true);
    client.cast_vote(&v2, &1u64, &true);

    let entry = client.get_project(&1u64);
    assert_eq!(entry.votes_for, 2);
    assert_eq!(entry.status, VerificationStatus::Pending); // not yet at quorum
}

#[test]
fn test_quorum_reached_auto_verifies() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000_000);
    let (client, _) = setup(&env, 3, WeightMode::Flat);
    let owner = Address::generate(&env);
    client.register_project(&owner, &1u64, &symbol_short!("P"));

    for _ in 0..3 {
        let v = Address::generate(&env);
        client.cast_vote(&v, &1u64, &true);
    }

    assert!(client.is_verified(&1u64));
    let entry = client.get_project(&1u64);
    assert_eq!(entry.status, VerificationStatus::Verified);
    assert!(entry.resolved_at > 0);
}

#[test]
fn test_quorum_against_auto_rejects() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = setup(&env, 3, WeightMode::Flat);
    let owner = Address::generate(&env);
    client.register_project(&owner, &1u64, &symbol_short!("P"));

    for _ in 0..3 {
        let v = Address::generate(&env);
        client.cast_vote(&v, &1u64, &false);
    }

    let entry = client.get_project(&1u64);
    assert_eq!(entry.status, VerificationStatus::Rejected);
}

#[test]
fn test_double_vote_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = setup(&env, 10, WeightMode::Flat);
    let owner = Address::generate(&env);
    client.register_project(&owner, &1u64, &symbol_short!("P"));

    let voter = Address::generate(&env);
    client.cast_vote(&voter, &1u64, &true);
    assert_eq!(
        client.try_cast_vote(&voter, &1u64, &true),
        Err(Ok(RegistryError::AlreadyVoted))
    );
}

#[test]
fn test_vote_on_resolved_project_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = setup(&env, 1, WeightMode::Flat);
    let owner = Address::generate(&env);
    client.register_project(&owner, &1u64, &symbol_short!("P"));

    // One vote reaches quorum=1 → Verified
    let v = Address::generate(&env);
    client.cast_vote(&v, &1u64, &true);

    // Another voter tries to vote on already-verified project
    let v2 = Address::generate(&env);
    assert_eq!(
        client.try_cast_vote(&v2, &1u64, &true),
        Err(Ok(RegistryError::VotingClosed))
    );
}

#[test]
fn test_insufficient_weight_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    // min_voter_weight = 5, but Flat mode gives weight 1
    let admin = Address::generate(&env);
    let id = env.register(ProjectRegistryContract, ());
    let client = ProjectRegistryContractClient::new(&env, &id);
    client.initialize(&admin, &10, &WeightMode::Flat, &None, &None, &5i128);

    let owner = Address::generate(&env);
    client.register_project(&owner, &1u64, &symbol_short!("P"));

    let voter = Address::generate(&env);
    assert_eq!(
        client.try_cast_vote(&voter, &1u64, &true),
        Err(Ok(RegistryError::InsufficientWeight))
    );
}

// ── Token balance weight mode ─────────────────────────────────────────────────

#[test]
fn test_token_balance_weight_mode() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    // Deploy a Stellar asset contract as governance token
    let token_admin = Address::generate(&env);
    let token_addr = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_admin_client =
        soroban_sdk::token::StellarAssetClient::new(&env, &token_addr.address());

    let id = env.register(ProjectRegistryContract, ());
    let client = ProjectRegistryContractClient::new(&env, &id);
    client.initialize(
        &admin,
        &100i128,
        &WeightMode::TokenBalance,
        &Some(token_addr.address()),
        &None,
        &1i128,
    );

    let owner = Address::generate(&env);
    client.register_project(&owner, &1u64, &symbol_short!("P"));

    // Voter with 60 tokens
    let voter = Address::generate(&env);
    token_admin_client.mint(&voter, &60);
    client.cast_vote(&voter, &1u64, &true);

    let entry = client.get_project(&1u64);
    assert_eq!(entry.votes_for, 60);
    assert_eq!(entry.status, VerificationStatus::Pending); // 60 < 100

    // Second voter with 50 tokens → total 110 >= 100 → Verified
    let voter2 = Address::generate(&env);
    token_admin_client.mint(&voter2, &50);
    client.cast_vote(&voter2, &1u64, &true);

    assert!(client.is_verified(&1u64));
}

// ── Admin override ────────────────────────────────────────────────────────────

#[test]
fn test_admin_override_verify() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env, 100, WeightMode::Flat);
    let owner = Address::generate(&env);
    client.register_project(&owner, &1u64, &symbol_short!("P"));

    client.override_verification(&admin, &1u64, &true);
    assert!(client.is_verified(&1u64));
}

#[test]
fn test_admin_override_reject() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env, 1, WeightMode::Flat);
    let owner = Address::generate(&env);
    client.register_project(&owner, &1u64, &symbol_short!("P"));

    // First verify via vote
    let v = Address::generate(&env);
    client.cast_vote(&v, &1u64, &true);
    assert!(client.is_verified(&1u64));

    // Admin revokes
    client.override_verification(&admin, &1u64, &false);
    assert!(!client.is_verified(&1u64));
}

#[test]
fn test_non_admin_override_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = setup(&env, 100, WeightMode::Flat);
    let owner = Address::generate(&env);
    client.register_project(&owner, &1u64, &symbol_short!("P"));

    let rando = Address::generate(&env);
    assert_eq!(
        client.try_override_verification(&rando, &1u64, &true),
        Err(Ok(RegistryError::Unauthorized))
    );
}

// ── has_voted / get_voter_weight ──────────────────────────────────────────────

#[test]
fn test_has_voted_and_weight_queries() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = setup(&env, 100, WeightMode::Flat);
    let owner = Address::generate(&env);
    client.register_project(&owner, &1u64, &symbol_short!("P"));

    let voter = Address::generate(&env);
    assert!(!client.has_voted(&1u64, &voter));

    client.cast_vote(&voter, &1u64, &true);
    assert!(client.has_voted(&1u64, &voter));
    assert_eq!(client.get_voter_weight(&1u64, &voter), 1);
}

// ── Config update ─────────────────────────────────────────────────────────────

#[test]
fn test_update_config() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env, 50, WeightMode::Flat);
    client.update_config(&admin, &200, &10);
    let config = client.get_config();
    assert_eq!(config.quorum_threshold, 200);
    assert_eq!(config.min_voter_weight, 10);
}

// ── Pause ─────────────────────────────────────────────────────────────────────

#[test]
fn test_pause_blocks_votes() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env, 10, WeightMode::Flat);
    let owner = Address::generate(&env);
    client.register_project(&owner, &1u64, &symbol_short!("P"));

    client.pause(&admin);

    let voter = Address::generate(&env);
    assert_eq!(
        client.try_cast_vote(&voter, &1u64, &true),
        Err(Ok(RegistryError::ContractPaused))
    );
}
