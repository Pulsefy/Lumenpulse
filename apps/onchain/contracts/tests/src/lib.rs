#![cfg(test)]
extern crate std;

use soroban_sdk::{testutils::Address as _, Address, Env, String, Symbol};

// 1. IMPORT SOURCE CONTRACTS
// We import the actual structs and the auto-generated Clients
use contributor_registry::{
    ContributorRegistryContract, ContributorRegistryContractClient as RegistryClient,
};
use crowdfund_vault::{CrowdfundVaultContract, CrowdfundVaultContractClient as VaultClient};
use lumen_token::{LumenToken, LumenTokenClient as TokenClient};

#[test]
fn test_lumenpulse_protocol_e2e() {
    let env = Env::default();

    // Automatically handles authorizations for all contract calls in the test
    env.mock_all_auths();

    // 2. SETUP IDENTITIES
    let admin = Address::generate(&env);
    let contributor = Address::generate(&env);
    let project_owner = Address::generate(&env);

    // 3. MODERN REGISTRATION (Resolved Deprecation & CI Errors)
    // We register the contract types directly. This compiles them from source
    // and removes the need for files in the gitignored target/ folder.
    let token_id = env.register(LumenToken, ());
    let reg_id = env.register(ContributorRegistryContract, ());
    let vault_id = env.register(CrowdfundVaultContract, ());

    // 4. INITIALIZE CLIENTS
    let token_client = TokenClient::new(&env, &token_id);
    let reg_client = RegistryClient::new(&env, &reg_id);
    let vault_client = VaultClient::new(&env, &vault_id);

    // 5. PROTOCOL INITIALIZATION
    // Aligning with your specific method signatures
    token_client.initialize(
        &admin,
        &7u32,
        &String::from_str(&env, "Lumen"),
        &String::from_str(&env, "LUM"),
    );
    reg_client.initialize(&admin);
    vault_client.initialize(&admin);

    // 6. EXECUTION FLOW
    // Step A: Register the contributor in the registry
    reg_client.register_contributor(&contributor, &String::from_str(&env, "cedarich"));

    // Step B: Mint tokens to the contributor
    token_client.mint(&contributor, &10000i128);

    // Step C: Create a project in the vault
    let project_id = vault_client.create_project(
        &project_owner,
        &Symbol::new(&env, "DevTools"),
        &5000i128,
        &token_id,
    );

    // Step D: Contributor deposits into the project
    vault_client.deposit(&contributor, &project_id, &3000i128);

    // 7. VERIFICATION (State Assertions)
    // Contributor should have 7,000 left (10,000 - 3,000)
    assert_eq!(token_client.balance(&contributor), 7000i128);
    // Vault project should have 3,000
    assert_eq!(vault_client.get_balance(&project_id), 3000i128);

    // 8. WITHDRAWAL FLOW
    // Admin must approve the milestone before withdrawal is possible
    vault_client.approve_milestone(&admin, &project_id);

    // Project owner withdraws 2,000 tokens
    vault_client.withdraw(&project_id, &2000i128);

    // Project owner should now have 2,000 tokens in their wallet
    assert_eq!(token_client.balance(&project_owner), 2000i128);

    std::println!("🚀 CI-Ready Integration Test Passed Successfully!");
}
