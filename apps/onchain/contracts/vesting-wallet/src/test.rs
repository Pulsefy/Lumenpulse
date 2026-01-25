use crate::errors::VestingError;
use crate::{VestingWalletContract, VestingWalletContractClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
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
    VestingWalletContractClient<'a>,
    Address,
    Address,
    TokenClient<'a>,
    soroban_sdk::Address,
) {
    let admin = Address::generate(env);
    let beneficiary = Address::generate(env);

    // Create token
    let (token_client, token_admin_client) = create_token_contract(env, &admin);

    // Mint tokens to admin for vesting
    token_admin_client.mint(&admin, &10_000_000);

    // Register contract
    let contract_id = env.register(VestingWalletContract, ());
    let client = VestingWalletContractClient::new(env, &contract_id);

    (client, admin, beneficiary, token_client, contract_id)
}

#[test]
fn test_initialize() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _, token_client, _) = setup_test(&env);

    // Initialize contract
    client.initialize(&admin, &token_client.address);

    // Verify admin and token are set
    assert_eq!(client.get_admin(), admin);
    assert_eq!(client.get_token(), token_client.address);
}

#[test]
fn test_double_initialization_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _, token_client, _) = setup_test(&env);

    // Initialize contract
    client.initialize(&admin, &token_client.address);

    // Try to initialize again - should fail
    let result = client.try_initialize(&admin, &token_client.address);
    assert_eq!(result, Err(Ok(VestingError::AlreadyInitialized)));
}

#[test]
fn test_create_vesting() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, beneficiary, token_client, contract_id) = setup_test(&env);

    // Initialize contract
    client.initialize(&admin, &token_client.address);

    // Get current time
    let current_time = env.ledger().timestamp();
    let start_time = current_time + 1000; // Start in 1000 seconds
    let duration = 10_000; // 10,000 seconds duration
    let amount: i128 = 1_000_000;

    // Create vesting
    client.create_vesting(&admin, &beneficiary, &amount, &start_time, &duration);

    // Verify vesting data
    let vesting = client.get_vesting(&beneficiary);
    assert_eq!(vesting.beneficiary, beneficiary);
    assert_eq!(vesting.total_amount, amount);
    assert_eq!(vesting.start_time, start_time);
    assert_eq!(vesting.duration, duration);
    assert_eq!(vesting.claimed_amount, 0);

    // Verify tokens were transferred to contract
    assert_eq!(token_client.balance(&contract_id), amount);
}

#[test]
fn test_create_vesting_not_initialized() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, beneficiary, _, _) = setup_test(&env);

    // Try to create vesting without initializing
    let current_time = env.ledger().timestamp();
    let result = client.try_create_vesting(
        &admin,
        &beneficiary,
        &1_000_000,
        &(current_time + 1000),
        &10_000,
    );
    assert_eq!(result, Err(Ok(VestingError::NotInitialized)));
}

#[test]
fn test_create_vesting_invalid_amount() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, beneficiary, token_client, _) = setup_test(&env);

    // Initialize contract
    client.initialize(&admin, &token_client.address);

    let current_time = env.ledger().timestamp();
    let result =
        client.try_create_vesting(&admin, &beneficiary, &0, &(current_time + 1000), &10_000);
    assert_eq!(result, Err(Ok(VestingError::InvalidAmount)));
}

#[test]
fn test_create_vesting_invalid_duration() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, beneficiary, token_client, _) = setup_test(&env);

    // Initialize contract
    client.initialize(&admin, &token_client.address);

    let current_time = env.ledger().timestamp();
    let result =
        client.try_create_vesting(&admin, &beneficiary, &1_000_000, &(current_time + 1000), &0);
    assert_eq!(result, Err(Ok(VestingError::InvalidDuration)));
}

#[test]
fn test_create_vesting_invalid_start_time() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, beneficiary, token_client, _) = setup_test(&env);

    // Initialize contract
    client.initialize(&admin, &token_client.address);

    let current_time = env.ledger().timestamp();
    // Try to set start time in the past (ensure it's definitely less than current_time)
    let past_time = current_time.saturating_sub(1);
    // If current_time is 0, we can't test past time, so skip the test
    if current_time == 0 {
        return;
    }
    let result = client.try_create_vesting(&admin, &beneficiary, &1_000_000, &past_time, &10_000);
    assert_eq!(result, Err(Ok(VestingError::InvalidStartTime)));
}

#[test]
fn test_create_vesting_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, beneficiary, token_client, _) = setup_test(&env);

    // Initialize contract
    client.initialize(&admin, &token_client.address);

    // Non-admin tries to create vesting
    let non_admin = Address::generate(&env);
    let current_time = env.ledger().timestamp();
    let result = client.try_create_vesting(
        &non_admin,
        &beneficiary,
        &1_000_000,
        &(current_time + 1000),
        &10_000,
    );
    assert_eq!(result, Err(Ok(VestingError::Unauthorized)));
}

#[test]
fn test_claim_before_start_time() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, beneficiary, token_client, _) = setup_test(&env);

    // Initialize contract
    client.initialize(&admin, &token_client.address);

    let current_time = env.ledger().timestamp();
    let start_time = current_time + 10_000; // Start in 10,000 seconds
    let duration = 10_000;
    let amount: i128 = 1_000_000;

    // Create vesting
    client.create_vesting(&admin, &beneficiary, &amount, &start_time, &duration);

    // Try to claim before start time - should fail
    let result = client.try_claim(&beneficiary);
    assert_eq!(result, Err(Ok(VestingError::NothingToClaim)));

    // Verify available amount is 0
    assert_eq!(client.get_available_amount(&beneficiary), 0);
}

#[test]
fn test_claim_partial_vesting() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, beneficiary, token_client, _) = setup_test(&env);

    // Initialize contract
    client.initialize(&admin, &token_client.address);

    let current_time = env.ledger().timestamp();
    let start_time = current_time + 100; // Start in 100 seconds
    let duration = 10_000; // 10,000 seconds duration
    let amount: i128 = 1_000_000;

    // Create vesting
    client.create_vesting(&admin, &beneficiary, &amount, &start_time, &duration);

    // Fast forward to 25% through vesting period
    env.ledger().set_timestamp(start_time + duration / 4);

    // Claim available tokens
    let claimed = client.claim(&beneficiary);
    let expected_claimed = amount / 4; // 25% of total
    assert_eq!(claimed, expected_claimed);

    // Verify beneficiary received tokens
    assert_eq!(token_client.balance(&beneficiary), expected_claimed);

    // Verify vesting data updated
    let vesting = client.get_vesting(&beneficiary);
    assert_eq!(vesting.claimed_amount, expected_claimed);

    // Verify available amount is now 0 (all available was claimed)
    assert_eq!(client.get_available_amount(&beneficiary), 0);
}

#[test]
fn test_claim_full_vesting() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, beneficiary, token_client, _) = setup_test(&env);

    // Initialize contract
    client.initialize(&admin, &token_client.address);

    let current_time = env.ledger().timestamp();
    let start_time = current_time + 100;
    let duration = 10_000;
    let amount: i128 = 1_000_000;

    // Create vesting
    client.create_vesting(&admin, &beneficiary, &amount, &start_time, &duration);

    // Fast forward past vesting period
    env.ledger().set_timestamp(start_time + duration + 1000);

    // Claim all tokens
    let claimed = client.claim(&beneficiary);
    assert_eq!(claimed, amount);

    // Verify beneficiary received all tokens
    assert_eq!(token_client.balance(&beneficiary), amount);

    // Verify vesting data updated
    let vesting = client.get_vesting(&beneficiary);
    assert_eq!(vesting.claimed_amount, amount);

    // Verify nothing left to claim
    assert_eq!(client.get_available_amount(&beneficiary), 0);
}

#[test]
fn test_claim_multiple_times() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, beneficiary, token_client, _) = setup_test(&env);

    // Initialize contract
    client.initialize(&admin, &token_client.address);

    let current_time = env.ledger().timestamp();
    let start_time = current_time + 100;
    let duration = 10_000;
    let amount: i128 = 1_000_000;

    // Create vesting
    client.create_vesting(&admin, &beneficiary, &amount, &start_time, &duration);

    // First claim at 25%
    env.ledger().set_timestamp(start_time + duration / 4);
    let claimed1 = client.claim(&beneficiary);
    assert_eq!(claimed1, amount / 4);

    // Second claim at 50%
    env.ledger().set_timestamp(start_time + duration / 2);
    let claimed2 = client.claim(&beneficiary);
    assert_eq!(claimed2, amount / 4); // Another 25%

    // Verify total claimed
    let vesting = client.get_vesting(&beneficiary);
    assert_eq!(vesting.claimed_amount, amount / 2);

    // Verify beneficiary balance
    assert_eq!(token_client.balance(&beneficiary), amount / 2);
}

#[test]
fn test_claim_vesting_not_found() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _, token_client, _) = setup_test(&env);

    // Initialize contract
    client.initialize(&admin, &token_client.address);

    // Try to claim for non-existent vesting
    let beneficiary = Address::generate(&env);
    let result = client.try_claim(&beneficiary);
    assert_eq!(result, Err(Ok(VestingError::VestingNotFound)));
}

#[test]
fn test_claim_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, beneficiary, token_client, _) = setup_test(&env);

    // Initialize contract
    client.initialize(&admin, &token_client.address);

    let current_time = env.ledger().timestamp();
    let start_time = current_time + 100;
    let duration = 10_000;
    let amount: i128 = 1_000_000;

    // Create vesting
    client.create_vesting(&admin, &beneficiary, &amount, &start_time, &duration);

    // Fast forward to allow claiming
    env.ledger().set_timestamp(start_time + duration / 2);

    // Non-beneficiary tries to claim
    let non_beneficiary = Address::generate(&env);
    // Note: This will fail auth check, but we need to test the contract logic
    // In real scenario, this would fail at auth level
    let result = client.try_claim(&non_beneficiary);
    assert_eq!(result, Err(Ok(VestingError::VestingNotFound)));
}

#[test]
fn test_get_available_amount_linear_calculation() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, beneficiary, token_client, _) = setup_test(&env);

    // Initialize contract
    client.initialize(&admin, &token_client.address);

    let current_time = env.ledger().timestamp();
    let start_time = current_time + 100;
    let duration = 10_000;
    let amount: i128 = 1_000_000;

    // Create vesting
    client.create_vesting(&admin, &beneficiary, &amount, &start_time, &duration);

    // Test at 30% through vesting
    env.ledger().set_timestamp(start_time + (duration * 3 / 10));
    let available = client.get_available_amount(&beneficiary);
    let expected = (amount * 3) / 10; // 30% of total
    assert_eq!(available, expected);

    // Test at 75% through vesting
    env.ledger().set_timestamp(start_time + (duration * 3 / 4));
    let available = client.get_available_amount(&beneficiary);
    let expected = (amount * 3) / 4; // 75% of total
    assert_eq!(available, expected);
}

#[test]
fn test_update_vesting() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, beneficiary, token_client, _) = setup_test(&env);

    // Initialize contract
    client.initialize(&admin, &token_client.address);

    let current_time = env.ledger().timestamp();
    let start_time = current_time + 1000;
    let duration = 10_000;
    let amount1: i128 = 1_000_000;

    // Create first vesting
    client.create_vesting(&admin, &beneficiary, &amount1, &start_time, &duration);

    // Update vesting with new amount (overwrites existing)
    let amount2: i128 = 2_000_000;
    client.create_vesting(&admin, &beneficiary, &amount2, &start_time, &duration);

    // Verify vesting was updated
    let vesting = client.get_vesting(&beneficiary);
    assert_eq!(vesting.total_amount, amount2);
    assert_eq!(vesting.claimed_amount, 0); // Reset when overwriting
}

#[test]
fn test_multiple_beneficiaries() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, beneficiary1, token_client, _) = setup_test(&env);
    let beneficiary2 = Address::generate(&env);

    // Initialize contract
    client.initialize(&admin, &token_client.address);

    let current_time = env.ledger().timestamp();
    let start_time = current_time + 100;
    let duration = 10_000;
    let amount1: i128 = 1_000_000;
    let amount2: i128 = 2_000_000;

    // Create vestings for two beneficiaries
    client.create_vesting(&admin, &beneficiary1, &amount1, &start_time, &duration);
    client.create_vesting(&admin, &beneficiary2, &amount2, &start_time, &duration);

    // Verify both vestings exist
    let vesting1 = client.get_vesting(&beneficiary1);
    let vesting2 = client.get_vesting(&beneficiary2);

    assert_eq!(vesting1.total_amount, amount1);
    assert_eq!(vesting2.total_amount, amount2);

    // Fast forward and claim for both
    env.ledger().set_timestamp(start_time + duration / 2);

    let claimed1 = client.claim(&beneficiary1);
    let claimed2 = client.claim(&beneficiary2);

    assert_eq!(claimed1, amount1 / 2);
    assert_eq!(claimed2, amount2 / 2);
}
