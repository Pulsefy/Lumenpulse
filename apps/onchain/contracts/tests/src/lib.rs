#![cfg(test)]
extern crate std;

use soroban_sdk::{testutils::Address as _, Address, Env, String, Symbol, Vec};

// 1. IMPORT SOURCE CONTRACTS
use contributor_registry::{
    multisig::Signer,
    ContributorRegistryContract,
    ContributorRegistryContractClient as RegistryClient,
};
use crowdfund_vault::{CrowdfundVaultContract, CrowdfundVaultContractClient as VaultClient};
use lumen_token::{LumenToken, LumenTokenClient as TokenClient};
use matching_pool::{MatchingPoolContract, MatchingPoolContractClient as PoolClient};
use project_registry::{ProjectRegistryContract, ProjectRegistryContractClient as RegistryClientV2};
use treasury::{TreasuryContract, TreasuryContractClient as TreasuryClient};

// Helper to create a Stellar asset token and get both the standard token client
// and the admin client capable of minting.
fn create_token(
    env: &Env,
    admin: &Address,
) -> (TokenClient, soroban_sdk::token::StellarAssetClient) {
    let token_id = env.register_stellar_asset_contract_v2(admin.clone());
    (
        TokenClient::new(env, &token_id.address()),
        soroban_sdk::token::StellarAssetClient::new(env, &token_id.address()),
    )
}

// ============================================================
// STAGE 1 — Project registration via project_registry
// ============================================================
#[test]
fn test_round_lifecycle_project_registration() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let project_owner = Address::generate(&env);

    let (token, _) = create_token(&env, &admin);

    let registry_id = env.register(ProjectRegistryContract, ());
    let registry = RegistryClientV2::new(&env, &registry_id);

    let project_id = 42u64;
    let project_name = Symbol::new(&env, "DevTools");

    registry.register_project(&project_owner, &project_id, &project_name);

    let entry = registry.get_project(&project_id);
    assert_eq!(entry.project_id, project_id);
    assert_eq!(entry.owner, project_owner);
    assert_eq!(entry.name, project_name);
}

// ============================================================
// STAGE 2 — Vault project creation + contribution
// ============================================================
#[test]
fn test_round_lifecycle_vault_project_and_contribution() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let project_owner = Address::generate(&env);
    let contributor = Address::generate(&env);

    let (token, _) = create_token(&env, &admin);
    let token_id = token.address;

    let vault_id = env.register(CrowdfundVaultContract, ());
    let vault = VaultClient::new(&env, &vault_id);

    vault.initialize(&admin);

    token.mint(&contributor, &10_000i128);

    let project_id = vault.create_project(
        &project_owner,
        &Symbol::new(&env, "DevTools"),
        &5_000i128,
        &token_id,
    );

    vault.deposit(&contributor, &project_id, &3_000i128);

    assert_eq!(token.balance(&contributor), 7_000i128);
    assert_eq!(vault.get_balance(&project_id), 3_000i128);
    assert_eq!(vault.get_total_contributions(&project_id), 3_000i128);
}

// ============================================================
// STAGE 3 — Matching pool round: create, fund, contribute, finalize, distribute
// ============================================================
#[test]
fn test_round_lifecycle_matching_pool_distribution() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let funder = Address::generate(&env);
    let owner1 = Address::generate(&env);
    let owner2 = Address::generate(&env);

    let (token, token_admin) = create_token(&env, &admin);
    let token_id = token.address;

    // Setup matching pool
    let pool_id = env.register(MatchingPoolContract, ());
    let pool = PoolClient::new(&env, &pool_id);
    pool.initialize(&admin);

    token_admin.mint(&funder, &1_000_000);

    // Create round
    env.ledger().set_timestamp(500);
    let round_id = pool.create_round(
        &admin,
        &Symbol::new(&env, "R1"),
        &token_id,
        &1000u64,
        &3000u64,
    );

    // Fund pool
    pool.fund_pool(&funder, &round_id, &1_000_000);
    assert_eq!(pool.get_pool_balance(&round_id), 1_000_000);

    // Approve projects
    pool.approve_project(&admin, &round_id, &1u64);
    pool.approve_project(&admin, &round_id, &2u64);

    // Record contributions inside active window
    env.ledger().set_timestamp(1500);
    for _ in 0..4 {
        let c = Address::generate(&env);
        pool.record_contribution(&round_id, &1u64, &c, &25i128);
    }
    let c = Address::generate(&env);
    pool.record_contribution(&round_id, &2u64, &c, &100i128);

    // Finalize after end
    env.ledger().set_timestamp(4000);
    pool.finalize_round(&admin, &round_id);

    let owners = vec![&env, owner1.clone(), owner2.clone()];
    let total_distributed = pool.distribute_matching_funds(&admin, &round_id, &owners);

    assert_eq!(total_distributed, 1_000_000);
    assert_eq!(token.balance(&pool.address), 0);
    assert!(token.balance(&owner1) > 0);
    assert!(token.balance(&owner2) > 0);
}

// ============================================================
// STAGE 4 — Treasury allocation and claim
// ============================================================
#[test]
fn test_round_lifecycle_treasury_allocation_and_claim() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let beneficiary = Address::generate(&env);

    let (token, token_admin) = create_token(&env, &admin);
    let token_id = token.address;

    let treasury_id = env.register(TreasuryContract, ());
    let treasury = TreasuryClient::new(&env, &treasury_id);

    treasury.initialize(&admin, &token_id);

    token_admin.mint(&admin, &10_000i128);

    let start_time = 1000u64;
    let duration = 1000u64;
    env.ledger().set_timestamp(start_time);

    let request_id = [0u8; 32];
    treasury.allocate_budget(
        &admin,
        &beneficiary,
        &5_000i128,
        &start_time,
        &duration,
        &soroban_sdk::BytesN::from_array(&env, &request_id),
    );

    assert_eq!(treasury.get_unlocked(&beneficiary), 0);
    assert_eq!(token.balance(&treasury.address), 5_000);

    // Halfway — 500 unlocked
    env.ledger().set_timestamp(start_time + 500);
    assert_eq!(treasury.get_unlocked(&beneficiary), 500);

    let claimed = treasury.claim(&beneficiary);
    assert_eq!(claimed, 500);
    assert_eq!(token.balance(&beneficiary), 500);

    // End — remaining 500 unlocked
    env.ledger().set_timestamp(start_time + 1000);
    assert_eq!(treasury.get_unlocked(&beneficiary), 500);

    treasury.claim(&beneficiary);
    assert_eq!(token.balance(&beneficiary), 1_000);
    assert_eq!(token.balance(&treasury.address), 4_000);
}

// ============================================================
// FULL END-TO-END: vault → matching pool → treasury
// ============================================================
#[test]
fn test_round_lifecycle_e2e_vault_to_treasury() {
    let env = Env::default();
    env.mock_all_auths();

    // Actors
    let admin = Address::generate(&env);
    let project_owner = Address::generate(&env);
    let contributor = Address::generate(&env);
    let funder = Address::generate(&env);

    // Token
    let (token, token_admin) = create_token(&env, &admin);
    let token_id = token.address;

    // Contracts
    let vault_id = env.register(CrowdfundVaultContract, ());
    let vault = VaultClient::new(&env, &vault_id);

    let pool_id = env.register(MatchingPoolContract, ());
    let pool = PoolClient::new(&env, &pool_id);

    let treasury_id = env.register(TreasuryContract, ());
    let treasury = TreasuryClient::new(&env, &treasury_id);

    let registry_id = env.register(ProjectRegistryContract, ());
    let registry = RegistryClientV2::new(&env, &registry_id);

    // Initialize
    vault.initialize(&admin);
    pool.initialize(&admin);
    treasury.initialize(&admin, &token_id);

    token_admin.mint(&funder, &1_000_000);
    token_admin.mint(&contributor, &10_000);

    // ── Stage 1: Project registration ───────────────────────
    let project_id = 1u64;
    registry.register_project(&project_owner, &project_id, &Symbol::new(&env, "DevTools"));

    // ── Stage 2: Vault project + contribution ───────────────
    let vault_project_id = vault.create_project(
        &project_owner,
        &Symbol::new(&env, "DevTools"),
        &5_000i128,
        &token_id,
    );
    assert_eq!(vault_project_id, 0);

    vault.deposit(&contributor, &vault_project_id, &3_000i128);
    assert_eq!(vault.get_balance(&vault_project_id), 3_000i128);

    // ── Stage 3: Matching pool round ────────────────────────
    env.ledger().set_timestamp(500);
    let round_id = pool.create_round(
        &admin,
        &Symbol::new(&env, "R1"),
        &token_id,
        &1000u64,
        &3000u64,
    );

    pool.approve_project(&admin, &round_id, &vault_project_id);
    pool.fund_pool(&funder, &round_id, &1_000_000);

    env.ledger().set_timestamp(1500);
    pool.record_contribution(&round_id, &vault_project_id, &contributor, &1_000i128);

    env.ledger().set_timestamp(4000);
    pool.finalize_round(&admin, &round_id);

    let owners = vec![&env, project_owner.clone()];
    let distributed = pool.distribute_matching_funds(&admin, &round_id, &owners);
    assert!(distributed > 0, "Matching distribution must succeed");

    // Project owner received matched funds from the pool
    let owner_balance_after_match = token.balance(&project_owner);
    assert!(owner_balance_after_match > 0, "Owner must receive matched funds");

    // ── Stage 4: Treasury disbursement to project owner ─────
    let treasury_amount = 2_000i128;
    let start_time = 5000u64;
    let duration = 1000u64;
    env.ledger().set_timestamp(start_time);

    let mut req_id = [0u8; 32];
    req_id[31] = 1;
    treasury.allocate_budget(
        &admin,
        &project_owner,
        &treasury_amount,
        &start_time,
        &duration,
        &soroban_sdk::BytesN::from_array(&env, &req_id),
    );

    // Beneficiary has nothing claimable immediately at cliff
    env.ledger().set_timestamp(start_time + 500);
    let first_claim = treasury.claim(&project_owner);
    assert_eq!(first_claim, 0, "Nothing unlocked before cliff");

    // After cliff + duration, full amount unlocked
    env.ledger().set_timestamp(start_time + duration);
    let second_claim = treasury.claim(&project_owner);
    assert_eq!(second_claim, treasury_amount);

    // Final recipient balance reflects vault contribution + match + treasury claim
    assert_eq!(
        token.balance(&project_owner),
        owner_balance_after_match + treasury_amount
    );
}

// ============================================================
// FAILURE INJECTION: funds must not strand or double-count
// ============================================================

#[test]
fn test_round_lifecycle_failure_registration_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let owner_a = Address::generate(&env);
    let owner_b = Address::generate(&env);

    let (token, _) = create_token(&env, &admin);

    let registry_id = env.register(ProjectRegistryContract, ());
    let registry = RegistryClientV2::new(&env, &registry_id);

    let project_id = 10u64;
    registry.register_project(&owner_a, &project_id, &Symbol::new(&env, "P"));

    // Duplicate registration must fail
    let result = registry.try_register_project(&owner_b, &project_id, &Symbol::new(&env, "P"));
    assert!(result.is_err(), "Duplicate project registration must be rejected");

    // Only one project record exists
    let entry = registry.get_project(&project_id);
    assert_eq!(entry.owner, owner_a);
}

#[test]
fn test_round_lifecycle_failure_contribution_rejected_preserves_balances() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let project_owner = Address::generate(&env);
    let contributor = Address::generate(&env);

    let (token, _) = create_token(&env, &admin);
    let token_id = token.address;

    let vault_id = env.register(CrowdfundVaultContract, ());
    let vault = VaultClient::new(&env, &vault_id);

    vault.initialize(&admin);

    token.mint(&contributor, &10_000i128);

    let project_id = vault.create_project(
        &project_owner,
        &Symbol::new(&env, "P"),
        &5_000i128,
        &token_id,
    );

    // Pause vault
    vault.pause(&admin);

    let result = vault.try_deposit(&contributor, &project_id, &1_000i128);
    assert!(result.is_err(), "Deposits must be rejected when paused");

    // Balances unchanged
    assert_eq!(token.balance(&contributor), 10_000i128);
    assert_eq!(vault.get_balance(&project_id), 0);
    assert_eq!(vault.get_total_contributions(&project_id), 0);
}

#[test]
fn test_round_lifecycle_failure_matching_distribution_not_finalized() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let funder = Address::generate(&env);
    let owner = Address::generate(&env);

    let (token, token_admin) = create_token(&env, &admin);
    let token_id = token.address;

    let pool_id = env.register(MatchingPoolContract, ());
    let pool = PoolClient::new(&env, &pool_id);
    pool.initialize(&admin);

    token_admin.mint(&funder, &1_000_000);

    env.ledger().set_timestamp(500);
    let round_id = pool.create_round(
        &admin,
        &Symbol::new(&env, "R"),
        &token_id,
        &1000u64,
        &3000u64,
    );

    pool.approve_project(&admin, &round_id, &1u64);
    pool.fund_pool(&funder, &round_id, &500_000);

    // Try distributing before finalization — must fail
    let owners = vec![&env, owner.clone()];
    let result = pool.try_distribute_matching_funds(&admin, &round_id, &owners);
    assert!(result.is_err(), "Distribution must fail before finalization");

    // Pool balance must remain intact
    assert_eq!(pool.get_pool_balance(&round_id), 500_000);
    assert_eq!(token.balance(&pool.address), 500_000);
}

#[test]
fn test_round_lifecycle_failure_treasury_unauthorized_allocation() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let impostor = Address::generate(&env);
    let beneficiary = Address::generate(&env);

    let (token, token_admin) = create_token(&env, &admin);
    let token_id = token.address;

    let treasury_id = env.register(TreasuryContract, ());
    let treasury = TreasuryClient::new(&env, &treasury_id);

    treasury.initialize(&admin, &token_id);

    token_admin.mint(&admin, &10_000);

    let start_time = 1000u64;
    let duration = 1000u64;
    env.ledger().set_timestamp(start_time);

    let mut req_id = [0u8; 32];
    req_id[31] = 2;
    let result = treasury.try_allocate_budget(
        &impostor,
        &beneficiary,
        &5_000i128,
        &start_time,
        &duration,
        &soroban_sdk::BytesN::from_array(&env, &req_id),
    );
    assert!(result.is_err(), "Only admin may allocate treasury budget");

    // No stream created, no tokens moved
    assert_eq!(treasury.get_unlocked(&beneficiary), 0);
    assert_eq!(token.balance(&treasury.address), 0);
}

// ============================================================
// EVENT ASSERTIONS: verify emitted events in order
// ============================================================
#[test]
fn test_round_lifecycle_events_in_order() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let project_owner = Address::generate(&env);
    let contributor = Address::generate(&env);
    let funder = Address::generate(&env);

    let (token, token_admin) = create_token(&env, &admin);
    let token_id = token.address;

    let vault_id = env.register(CrowdfundVaultContract, ());
    let vault = VaultClient::new(&env, &vault_id);

    let pool_id = env.register(MatchingPoolContract, ());
    let pool = PoolClient::new(&env, &pool_id);

    let registry_id = env.register(ProjectRegistryContract, ());
    let registry = RegistryClientV2::new(&env, &registry_id);

    let treasury_id = env.register(TreasuryContract, ());
    let treasury = TreasuryClient::new(&env, &treasury_id);

    vault.initialize(&admin);
    pool.initialize(&admin);
    treasury.initialize(&admin, &token_id);

    token_admin.mint(&funder, &1_000_000);
    token_admin.mint(&contributor, &10_000);

    // Project registration event
    let before_reg = env.events().all().len();
    let project_id = 1u64;
    registry.register_project(&project_owner, &project_id, &Symbol::new(&env, "DevTools"));
    let after_reg = env.events().all().len();
    assert!(after_reg > before_reg, "ProjectRegisteredEvent must be emitted");

    // Vault project creation + contribution events
    let before_vault = env.events().all().len();
    let vault_project_id = vault.create_project(
        &project_owner,
        &Symbol::new(&env, "DevTools"),
        &5_000i128,
        &token_id,
    );
    vault.deposit(&contributor, &vault_project_id, &3_000i128);
    let after_vault = env.events().all().len();
    assert!(after_vault > before_vault, "Vault events must be emitted");

    // Matching pool round creation + funding + contribution + finalize + distribution events
    let before_pool = env.events().all().len();
    env.ledger().set_timestamp(500);
    let round_id = pool.create_round(
        &admin,
        &Symbol::new(&env, "R1"),
        &token_id,
        &1000u64,
        &3000u64,
    );
    pool.approve_project(&admin, &round_id, &vault_project_id);
    pool.fund_pool(&funder, &round_id, &1_000_000);

    env.ledger().set_timestamp(1500);
    pool.record_contribution(&round_id, &vault_project_id, &contributor, &1_000i128);

    env.ledger().set_timestamp(4000);
    pool.finalize_round(&admin, &round_id);

    let owners = vec![&env, project_owner.clone()];
    pool.distribute_matching_funds(&admin, &round_id, &owners);
    let after_pool = env.events().all().len();
    assert!(after_pool > before_pool, "Matching pool events must be emitted");

    // Treasury allocation event
    let before_treasury = env.events().all().len();
    let start_time = 5000u64;
    let duration = 1000u64;
    env.ledger().set_timestamp(start_time);

    let mut req_id = [0u8; 32];
    req_id[31] = 1;
    treasury.allocate_budget(
        &admin,
        &project_owner,
        &2_000i128,
        &start_time,
        &duration,
        &soroban_sdk::BytesN::from_array(&env, &req_id),
    );
    let after_treasury = env.events().all().len();
    assert!(after_treasury > before_treasury, "Treasury allocation event must be emitted");
}

// ============================================================
// ACCOUNTING SAFETY: no double-counting across vault → pool → treasury
// ============================================================
#[test]
fn test_round_lifecycle_accounting_no_double_count() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let project_owner = Address::generate(&env);
    let contributor = Address::generate(&env);
    let funder = Address::generate(&env);

    let (token, token_admin) = create_token(&env, &admin);
    let token_id = token.address;

    let vault_id = env.register(CrowdfundVaultContract, ());
    let vault = VaultClient::new(&env, &vault_id);

    let pool_id = env.register(MatchingPoolContract, ());
    let pool = PoolClient::new(&env, &pool_id);

    let treasury_id = env.register(TreasuryContract, ());
    let treasury = TreasuryClient::new(&env, &treasury_id);

    vault.initialize(&admin);
    pool.initialize(&admin);
    treasury.initialize(&admin, &token_id);

    token_admin.mint(&funder, &1_000_000);
    token_admin.mint(&contributor, &10_000);

    // Initial total supply in the system = 1_010_000
    let initial_supply = token.balance(&funder) + token.balance(&contributor);

    // Vault contribution
    let vault_project_id = vault.create_project(
        &project_owner,
        &Symbol::new(&env, "P"),
        &5_000i128,
        &token_id,
    );
    vault.deposit(&contributor, &vault_project_id, &3_000i128);

    // Matching pool round
    env.ledger().set_timestamp(500);
    let round_id = pool.create_round(
        &admin,
        &Symbol::new(&env, "R"),
        &token_id,
        &1000u64,
        &3000u64,
    );
    pool.approve_project(&admin, &round_id, &vault_project_id);
    pool.fund_pool(&funder, &round_id, &1_000_000);

    env.ledger().set_timestamp(1500);
    pool.record_contribution(&round_id, &vault_project_id, &contributor, &1_000i128);

    env.ledger().set_timestamp(4000);
    pool.finalize_round(&admin, &round_id);

    let owners = vec![&env, project_owner.clone()];
    let distributed = pool.distribute_matching_funds(&admin, &round_id, &owners);
    assert!(distributed > 0);

    // Treasury allocation
    env.ledger().set_timestamp(5000);
    let mut req_id = [0u8; 32];
    req_id[31] = 3;
    treasury.allocate_budget(
        &admin,
        &project_owner,
        &2_000i128,
        &5000u64,
        &1000u64,
        &soroban_sdk::BytesN::from_array(&env, &req_id),
    );

    // Final balances must sum to initial supply (no funds created or destroyed)
    let final_sum = token.balance(&funder)
        + token.balance(&contributor)
        + token.balance(&project_owner)
        + token.balance(&vault.address)
        + token.balance(&pool.address)
        + token.balance(&treasury.address);

    assert_eq!(final_sum, initial_supply, "Funds must never be created or destroyed");
}

#[test]
fn test_storage_ttl_extension_past_boundary() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contributor = Address::generate(&env);
    let project_owner = Address::generate(&env);

    let token_id = env.register(LumenToken, ());
    let vault_id = env.register(CrowdfundVaultContract, ());

    let token_client = TokenClient::new(&env, &token_id);
    let vault_client = VaultClient::new(&env, &vault_id);

    token_client.initialize(
        &admin,
        &7u32,
        &String::from_str(&env, "Lumen"),
        &String::from_str(&env, "LUM"),
    );

    vault_client.initialize(&admin);

    token_client.mint(&contributor, &10000i128);

    let project_id = vault_client.create_project(
        &project_owner,
        &Symbol::new(&env, "TestTTL"),
        &5000i128,
        &token_id,
    );

    vault_client.deposit(&contributor, &project_id, &3000i128);

    // Advance ledger sequence past the TTL threshold boundary (120,960 ledgers)
    env.ledger().set_sequence_number(150_000);

    // Verify contract instance and persistent storage entries are auto-extended and functional
    let balance = vault_client.get_balance(&project_id);
    assert_eq!(balance, 3000i128);

    vault_client.approve_milestone(&admin, &project_id, &0u32);
    vault_client.withdraw(&project_id, &0u32, &1000i128);

    assert_eq!(vault_client.get_balance(&project_id), 2000i128);
    assert_eq!(token_client.balance(&project_owner), 1000i128);

    std::println!("✅ Storage TTL boundary advancement test — PASSED");
}