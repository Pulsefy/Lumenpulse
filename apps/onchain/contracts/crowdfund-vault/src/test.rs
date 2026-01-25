use crate::errors::CrowdfundError;
use crate::{CrowdfundVaultContract, CrowdfundVaultContractClient};
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events},
    token::{StellarAssetClient, TokenClient},
    Address, Env,
};

fn create_token_contract<'a>(
    env: &Env,
    admin: &Address,
) -> (TokenClient<'a>, StellarAssetClient<'a>) {
    let contract_address = env.register_stellar_asset_contract_v2(admin.clone());
    (
        TokenClient::new(env, &contract_address.address()),
        StellarAssetClient::new(env, &contract_address.address()),
    )
}

fn setup_test<'a>(
    env: &Env,
) -> (
    CrowdfundVaultContractClient<'a>,
    Address,
    Address,
    Address,
    TokenClient<'a>,
) {
    let admin = Address::generate(env);
    let owner = Address::generate(env);
    let user = Address::generate(env);

    // Create token
    let (token_client, token_admin_client) = create_token_contract(env, &admin);

    // Mint tokens to user for deposits
    token_admin_client.mint(&user, &10_000_000);

    // Register contract
    let contract_id = env.register(CrowdfundVaultContract, ());
    let client = CrowdfundVaultContractClient::new(env, &contract_id);

    (client, admin, owner, user, token_client)
}

#[test]
fn test_initialize() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _, _, _) = setup_test(&env);

    // Initialize contract
    client.initialize(&admin);

    // Verify admin is set
    assert_eq!(client.get_admin(), admin);
}

#[test]
fn test_double_initialization_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _, _, _) = setup_test(&env);

    // Initialize contract
    client.initialize(&admin);

    // Try to initialize again - should fail
    let result = client.try_initialize(&admin);
    assert_eq!(result, Err(Ok(CrowdfundError::AlreadyInitialized)));
}

#[test]
fn test_create_project() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, owner, _, token_client) = setup_test(&env);

    // Initialize contract
    client.initialize(&admin);

    // Create project
    let project_id = client.create_project(
        &owner,
        &symbol_short!("TestProj"),
        &1_000_000,
        &token_client.address,
    );

    assert_eq!(project_id, 0);

    // Verify project data
    let project = client.get_project(&project_id);
    assert_eq!(project.id, 0);
    assert_eq!(project.owner, owner);
    assert_eq!(project.target_amount, 1_000_000);
    assert_eq!(project.total_deposited, 0);
    assert_eq!(project.total_withdrawn, 0);
    assert!(project.is_active);
}

#[test]
fn test_create_project_not_initialized() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _, owner, _, token_client) = setup_test(&env);

    // Try to create project without initializing
    let result = client.try_create_project(
        &owner,
        &symbol_short!("TestProj"),
        &1_000_000,
        &token_client.address,
    );

    assert_eq!(result, Err(Ok(CrowdfundError::NotInitialized)));
}

#[test]
fn test_deposit() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, owner, user, token_client) = setup_test(&env);

    // Initialize contract
    client.initialize(&admin);

    // Create project
    let project_id = client.create_project(
        &owner,
        &symbol_short!("TestProj"),
        &1_000_000,
        &token_client.address,
    );

    // Deposit funds
    let deposit_amount: i128 = 500_000;
    client.deposit(&user, &project_id, &deposit_amount);

    // Verify balance
    assert_eq!(client.get_balance(&project_id), deposit_amount);

    // Verify project data updated
    let project = client.get_project(&project_id);
    assert_eq!(project.total_deposited, deposit_amount);
}

#[test]
fn test_deposit_invalid_amount() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, owner, user, token_client) = setup_test(&env);

    // Initialize contract
    client.initialize(&admin);

    // Create project
    let project_id = client.create_project(
        &owner,
        &symbol_short!("TestProj"),
        &1_000_000,
        &token_client.address,
    );

    // Try to deposit zero
    let result = client.try_deposit(&user, &project_id, &0);
    assert_eq!(result, Err(Ok(CrowdfundError::InvalidAmount)));
}

#[test]
fn test_withdraw_without_approval_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, owner, user, token_client) = setup_test(&env);

    // Initialize contract
    client.initialize(&admin);

    // Create project
    let project_id = client.create_project(
        &owner,
        &symbol_short!("TestProj"),
        &1_000_000,
        &token_client.address,
    );

    // Deposit funds
    client.deposit(&user, &project_id, &500_000);

    // Try to withdraw without milestone approval - should fail
    let result = client.try_withdraw(&project_id, &100_000);
    assert_eq!(result, Err(Ok(CrowdfundError::MilestoneNotApproved)));
}

#[test]
fn test_withdraw_after_approval() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, owner, user, token_client) = setup_test(&env);

    // Initialize contract
    client.initialize(&admin);

    // Create project
    let project_id = client.create_project(
        &owner,
        &symbol_short!("TestProj"),
        &1_000_000,
        &token_client.address,
    );

    // Deposit funds
    let deposit_amount: i128 = 500_000;
    client.deposit(&user, &project_id, &deposit_amount);

    // Approve milestone
    client.approve_milestone(&admin, &project_id);

    // Verify milestone is approved
    assert!(client.is_milestone_approved(&project_id));

    // Withdraw funds
    let withdraw_amount: i128 = 200_000;
    client.withdraw(&project_id, &withdraw_amount);

    // Verify balance reduced
    assert_eq!(
        client.get_balance(&project_id),
        deposit_amount - withdraw_amount
    );

    // Verify project data updated
    let project = client.get_project(&project_id);
    assert_eq!(project.total_withdrawn, withdraw_amount);

    // Verify owner received tokens
    assert_eq!(token_client.balance(&owner), withdraw_amount);
}

#[test]
fn test_non_admin_cannot_approve() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, owner, _, token_client) = setup_test(&env);

    // Initialize contract
    client.initialize(&admin);

    // Create project
    let project_id = client.create_project(
        &owner,
        &symbol_short!("TestProj"),
        &1_000_000,
        &token_client.address,
    );

    // Non-admin tries to approve milestone - should fail
    let non_admin = Address::generate(&env);
    let result = client.try_approve_milestone(&non_admin, &project_id);
    assert_eq!(result, Err(Ok(CrowdfundError::Unauthorized)));
}

#[test]
fn test_insufficient_balance_withdrawal() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, owner, user, token_client) = setup_test(&env);

    // Initialize contract
    client.initialize(&admin);

    // Create project
    let project_id = client.create_project(
        &owner,
        &symbol_short!("TestProj"),
        &1_000_000,
        &token_client.address,
    );

    // Deposit small amount
    client.deposit(&user, &project_id, &100_000);

    // Approve milestone
    client.approve_milestone(&admin, &project_id);

    // Try to withdraw more than balance - should fail
    let result = client.try_withdraw(&project_id, &500_000);
    assert_eq!(result, Err(Ok(CrowdfundError::InsufficientBalance)));
}

#[test]
fn test_project_not_found() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _, _, _) = setup_test(&env);

    // Initialize contract
    client.initialize(&admin);

    // Try to get non-existent project
    let result = client.try_get_project(&999);
    assert_eq!(result, Err(Ok(CrowdfundError::ProjectNotFound)));
}

#[test]
fn test_multiple_projects() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, owner, _, token_client) = setup_test(&env);

    // Initialize contract
    client.initialize(&admin);

    // Create multiple projects
    let project_id_1 = client.create_project(
        &owner,
        &symbol_short!("Project1"),
        &1_000_000,
        &token_client.address,
    );

    let project_id_2 = client.create_project(
        &owner,
        &symbol_short!("Project2"),
        &2_000_000,
        &token_client.address,
    );

    assert_eq!(project_id_1, 0);
    assert_eq!(project_id_2, 1);

    // Verify both projects exist with correct data
    let project_1 = client.get_project(&project_id_1);
    let project_2 = client.get_project(&project_id_2);

    assert_eq!(project_1.target_amount, 1_000_000);
    assert_eq!(project_2.target_amount, 2_000_000);
}

#[test]
fn test_contributor_registration() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _, user, _) = setup_test(&env);
    client.initialize(&admin);

    // Register contributor
    client.register_contributor(&user);

    // Verify reputation is 0
    assert_eq!(client.get_reputation(&user), 0);

    // Try to register again - should fail
    let result = client.try_register_contributor(&user);
    assert_eq!(result, Err(Ok(CrowdfundError::AlreadyRegistered)));
}

#[test]
fn test_reputation_management() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _, user, _) = setup_test(&env);
    client.initialize(&admin);

    // Register contributor first
    client.register_contributor(&user);

    // Update reputation
    client.update_reputation(&admin, &user, &100);
    assert_eq!(client.get_reputation(&user), 100);

    // Decrease reputation
    client.update_reputation(&admin, &user, &-50);
    assert_eq!(client.get_reputation(&user), 50);

    // Non-admin cannot update reputation
    let non_admin = Address::generate(&env);
    let result = client.try_update_reputation(&non_admin, &user, &100);
    assert_eq!(result, Err(Ok(CrowdfundError::Unauthorized)));
}

#[test]
fn test_events_emission() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, owner, user, token_client) = setup_test(&env);

    // Initialize
    client.initialize(&admin);

    // Create project
    let project_id = client.create_project(
        &owner,
        &symbol_short!("TestProj"),
        &1_000_000,
        &token_client.address,
    );

    // Deposit
    client.deposit(&user, &project_id, &500_000);

    // Register contributor
    client.register_contributor(&user);

    // Update reputation
    client.update_reputation(&admin, &user, &10);

    // Verify events exist (at least one event should be present)
    let events = env.events().all();
    assert!(
        !events.is_empty(),
        "Expected at least one event to be emitted"
    );
}
