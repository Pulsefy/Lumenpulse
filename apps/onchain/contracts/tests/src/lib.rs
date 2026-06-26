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

#[test]
fn test_lumenpulse_protocol_e2e() {
    let env = Env::default();

    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contributor = Address::generate(&env);
    let project_owner = Address::generate(&env);

    let token_id = env.register(LumenToken, ());
    let reg_id = env.register(ContributorRegistryContract, ());
    let vault_id = env.register(CrowdfundVaultContract, ());

    let token_client = TokenClient::new(&env, &token_id);
    let reg_client = RegistryClient::new(&env, &reg_id);
    let vault_client = VaultClient::new(&env, &vault_id);

    token_client.initialize(
        &admin,
        &7u32,
        &String::from_str(&env, "Lumen"),
        &String::from_str(&env, "LUM"),
    );

    // FIXED: multisig initialization
    let mut signers = Vec::new(&env);
    signers.push_back(Signer {
        address: admin.clone(),
        weight: 1,
    });

    reg_client.initialize(&signers, &1u32);

    vault_client.initialize(&admin);

    reg_client.register_contributor(
        &contributor,
        &String::from_str(&env, "cedarich"),
    );

    token_client.mint(&contributor, &10000i128);

    let project_id = vault_client.create_project(
        &project_owner,
        &Symbol::new(&env, "DevTools"),
        &5000i128,
        &token_id,
    );

    vault_client.deposit(&contributor, &project_id, &3000i128);

    assert_eq!(token_client.balance(&contributor), 7000i128);
    assert_eq!(vault_client.get_balance(&project_id), 3000i128);

    vault_client.approve_milestone(&admin, &project_id, &0u32);

    vault_client.withdraw(&project_id, &0u32, &2000i128);

    assert_eq!(token_client.balance(&project_owner), 2000i128);

    std::println!("🚀 CI-Ready Integration Test Passed Successfully!");
}

#[test]
fn test_notification_flow() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contributor = Address::generate(&env);
    let project_owner = Address::generate(&env);

    let token_id = env.register(LumenToken, ());
    let reg_id = env.register(ContributorRegistryContract, ());
    let vault_id = env.register(CrowdfundVaultContract, ());

    let token_client = TokenClient::new(&env, &token_id);
    let reg_client = RegistryClient::new(&env, &reg_id);
    let vault_client = VaultClient::new(&env, &vault_id);

    token_client.initialize(
        &admin,
        &7u32,
        &String::from_str(&env, "Lumen"),
        &String::from_str(&env, "LUM"),
    );

    // FIXED: multisig initialization
    let mut signers = Vec::new(&env);
    signers.push_back(Signer {
        address: admin.clone(),
        weight: 1,
    });

    reg_client.initialize(&signers, &1u32);

    vault_client.initialize(&admin);

    reg_client.register_contributor(
        &contributor,
        &String::from_str(&env, "cedarich"),
    );

    assert_eq!(reg_client.get_reputation(&contributor), 0);

    vault_client.add_subscriber(&admin, &reg_id);

    token_client.mint(&contributor, &10000i128);

    let project_id = vault_client.create_project(
        &project_owner,
        &Symbol::new(&env, "DevTools"),
        &5000i128,
        &token_id,
    );

    vault_client.deposit(&contributor, &project_id, &1000i128);

    assert_eq!(reg_client.get_reputation(&contributor), 1);

    vault_client.deposit(&contributor, &project_id, &1000i128);

    assert_eq!(reg_client.get_reputation(&contributor), 2);

    std::println!("📡 Cross-contract Notification Flow Passed Successfully!");
}

#[test]
fn invariant_deposit_amount_must_be_positive() {
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
        &Symbol::new(&env, "TestProj"),
        &5000i128,
        &token_id,
    );

    let result = vault_client.try_deposit(&contributor, &project_id, &0i128);
    assert!(result.is_err(), "Zero deposit should be rejected");

    let result = vault_client.try_deposit(&contributor, &project_id, &-100i128);
    assert!(result.is_err(), "Negative deposit should be rejected");

    std::println!("✅ Invariant: deposit amount must be positive — PASSED");
}

#[test]
fn invariant_balance_never_negative_after_withdrawal() {
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
        &Symbol::new(&env, "TestProj"),
        &5000i128,
        &token_id,
    );

    vault_client.deposit(&contributor, &project_id, &3000i128);

    vault_client.approve_milestone(&admin, &project_id, &0u32);

    let result = vault_client.try_withdraw(&project_id, &0u32, &9999i128);

    assert!(
        result.is_err(),
        "Withdrawal exceeding balance should be rejected"
    );

    vault_client.withdraw(&project_id, &0u32, &1000i128);

    let balance = vault_client.get_balance(&project_id);

    assert!(balance >= 0, "Balance must never be negative");

    std::println!("✅ Invariant: balance never negative after withdrawal — PASSED");
}

#[test]
fn invariant_withdrawal_requires_milestone_approval() {
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
        &Symbol::new(&env, "TestProj"),
        &5000i128,
        &token_id,
    );

    vault_client.deposit(&contributor, &project_id, &3000i128);

    let result = vault_client.try_withdraw(&project_id, &0u32, &1000i128);

    assert!(
        result.is_err(),
        "Withdrawal without milestone approval should be rejected"
    );

    std::println!("✅ Invariant: withdrawal requires milestone approval — PASSED");
}

#[test]
fn invariant_duplicate_contributor_registration_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contributor = Address::generate(&env);

    let reg_id = env.register(ContributorRegistryContract, ());
    let reg_client = RegistryClient::new(&env, &reg_id);

    // FIXED: multisig initialization
    let mut signers = Vec::new(&env);
    signers.push_back(Signer {
        address: admin.clone(),
        weight: 1,
    });

    reg_client.initialize(&signers, &1u32);

    reg_client.register_contributor(
        &contributor,
        &String::from_str(&env, "alice"),
    );

    let result = reg_client.try_register_contributor(
        &contributor,
        &String::from_str(&env, "alice"),
    );

    assert!(result.is_err(), "Duplicate registration should be rejected");

    std::println!("✅ Invariant: duplicate contributor registration rejected — PASSED");
}

#[test]
fn invariant_paused_contract_rejects_deposits() {
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
        &Symbol::new(&env, "TestProj"),
        &5000i128,
        &token_id,
    );

    vault_client.pause(&admin);

    let result = vault_client.try_deposit(&contributor, &project_id, &1000i128);

    assert!(
        result.is_err(),
        "Deposit should be rejected when contract is paused"
    );

    std::println!("✅ Invariant: paused contract rejects deposits — PASSED");
}