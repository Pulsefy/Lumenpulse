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
fn test_fund_matching_pool() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _, _, token_client) = setup_test(&env);

    // Initialize contract
    client.initialize(&admin);

    // Fund matching pool
    let pool_amount: i128 = 10_000_000;
    client.fund_matching_pool(&admin, &token_client.address, &pool_amount);

    // Verify matching pool balance
    assert_eq!(
        client.get_matching_pool_balance(&token_client.address),
        pool_amount
    );
}

#[test]
fn test_fund_matching_pool_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, owner, _, token_client) = setup_test(&env);

    // Initialize contract
    client.initialize(&admin);

    // Non-admin tries to fund matching pool - should fail
    let result = client.try_fund_matching_pool(&owner, &token_client.address, &10_000_000);
    assert_eq!(result, Err(Ok(CrowdfundError::Unauthorized)));
}

#[test]
fn test_calculate_match_single_contributor() {
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

    // Deposit funds from single contributor
    let contribution: i128 = 1_000_000; // 1M tokens
    client.deposit(&user, &project_id, &contribution);

    // Calculate match
    // sqrt(1_000_000) = 1000
    // match = 1000^2 = 1_000_000
    let match_amount = client.calculate_match(&project_id);
    assert!(match_amount > 0);

    // Verify contributor count
    assert_eq!(client.get_contributor_count(&project_id), 1);

    // Verify contribution amount
    assert_eq!(client.get_contribution(&project_id, &user), contribution);
}

#[test]
fn test_calculate_match_multiple_contributors() {
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

    // Create multiple users
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);
    let user3 = Address::generate(&env);

    // Mint tokens to users
    let (_, token_admin_client) = create_token_contract(&env, &admin);
    token_admin_client.mint(&user1, &10_000_000);
    token_admin_client.mint(&user2, &10_000_000);
    token_admin_client.mint(&user3, &10_000_000);

    // Different contributions
    // user1: 100 (sqrt = 10)
    // user2: 400 (sqrt = 20)
    // user3: 900 (sqrt = 30)
    // sum of sqrt = 60
    // match = 60^2 = 3600
    client.deposit(&user1, &project_id, &100);
    client.deposit(&user2, &project_id, &400);
    client.deposit(&user3, &project_id, &900);

    // Calculate match
    let match_amount = client.calculate_match(&project_id);

    // Verify match is approximately 3600 (allowing for fixed-point rounding)
    // sqrt(100) ≈ 10, sqrt(400) = 20, sqrt(900) = 30
    // sum = 60, match = 3600
    assert!((3500..=3700).contains(&match_amount));

    // Verify contributor count
    assert_eq!(client.get_contributor_count(&project_id), 3);
}

#[test]
fn test_calculate_match_no_contributors() {
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

    // Calculate match with no contributors
    let match_amount = client.calculate_match(&project_id);
    assert_eq!(match_amount, 0);
}

#[test]
fn test_distribute_match() {
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
    let contribution: i128 = 1_000_000;
    client.deposit(&user, &project_id, &contribution);

    // Fund matching pool
    let pool_amount: i128 = 10_000_000;
    let (_, token_admin_client) = create_token_contract(&env, &admin);
    token_admin_client.mint(&admin, &pool_amount);
    client.fund_matching_pool(&admin, &token_client.address, &pool_amount);

    // Get initial balance
    let initial_balance = client.get_balance(&project_id);

    // Calculate and distribute match
    let match_amount = client.calculate_match(&project_id);
    let distributed = client.distribute_match(&project_id);

    // Verify match was distributed
    assert!(distributed > 0);
    assert_eq!(distributed, match_amount);

    // Verify project balance increased
    let new_balance = client.get_balance(&project_id);
    assert_eq!(new_balance, initial_balance + distributed);

    // Verify matching pool decreased
    let remaining_pool = client.get_matching_pool_balance(&token_client.address);
    assert_eq!(remaining_pool, pool_amount - distributed);
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

    let (client, admin, owner, _user, token_client) = setup_test(&env);

    // Initialize contract
    client.initialize(&admin);

    // Create project
    let project_id = client.create_project(
        &owner,
        &symbol_short!("TestProj"),
        &1_000_000,
        &token_client.address,
    );

    // Deposit funds from multiple users to create large match
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);
    let (_, token_admin_client) = create_token_contract(&env, &admin);
    token_admin_client.mint(&user1, &10_000_000);
    token_admin_client.mint(&user2, &10_000_000);

    // Large contributions that will create a large match
    client.deposit(&user1, &project_id, &1_000_000);
    client.deposit(&user2, &project_id, &1_000_000);

    // Fund matching pool with small amount
    let pool_amount: i128 = 100_000; // Less than the calculated match
    token_admin_client.mint(&admin, &pool_amount);
    client.fund_matching_pool(&admin, &token_client.address, &pool_amount);

    // Calculate match (should be large)
    let match_amount = client.calculate_match(&project_id);
    assert!(match_amount > pool_amount);

    // Distribute match (should only distribute what's available)
    let distributed = client.distribute_match(&project_id);

    // Should only distribute the pool amount, not the full match
    assert_eq!(distributed, pool_amount);

    // Verify pool is empty
    assert_eq!(client.get_matching_pool_balance(&token_client.address), 0);
}

#[test]
fn test_multiple_contributions_same_user() {
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

    // Same user makes multiple contributions
    client.deposit(&user, &project_id, &100);
    client.deposit(&user, &project_id, &300); // Total: 400

    // Should only count as one contributor
    assert_eq!(client.get_contributor_count(&project_id), 1);

    // Total contribution should be 400
    assert_eq!(client.get_contribution(&project_id, &user), 400);

    // Calculate match: sqrt(400) = 20, match = 20^2 = 400
    let match_amount = client.calculate_match(&project_id);
    // Should be approximately 400 (allowing for rounding)
    assert!((390..=410).contains(&match_amount));
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
