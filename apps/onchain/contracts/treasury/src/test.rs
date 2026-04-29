use super::*;
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::{token, Address, Env};

#[test]
fn test_treasury_streaming() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    let token_admin = Address::generate(&env);

    // Deploy token
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_client = token::TokenClient::new(&env, &token_id.address());
    let token_admin_client = token::StellarAssetClient::new(&env, &token_id.address());

    // Deploy treasury
    let treasury_id = env.register(TreasuryContract, ());
    let treasury_client = TreasuryContractClient::new(&env, &treasury_id);

    // Initialize
    treasury_client.initialize(&admin, &token_id.address());

    // Mint tokens to admin
    let amount = 1000i128;
    token_admin_client.mint(&admin, &amount);

    // Allocate budget
    let start_time = 1000u64;
    let duration = 1000u64;
    env.ledger().set_timestamp(start_time);

    treasury_client.allocate_budget(&admin, &beneficiary, &amount, &start_time, &duration);

    // Check unlocked at start_time (should be 0)
    assert_eq!(treasury_client.get_unlocked(&beneficiary), 0);

    // Move time forward by 500 seconds (half duration)
    env.ledger().set_timestamp(start_time + 500);
    assert_eq!(treasury_client.get_unlocked(&beneficiary), 500);

    // Claim half
    let claimed = treasury_client.claim(&beneficiary);
    assert_eq!(claimed, 500);
    assert_eq!(token_client.balance(&beneficiary), 500);

    // Check unlocked again (should be 0 now since we just claimed)
    assert_eq!(treasury_client.get_unlocked(&beneficiary), 0);

    // Move time forward to end
    env.ledger().set_timestamp(start_time + 1000);
    assert_eq!(treasury_client.get_unlocked(&beneficiary), 500);

    // Claim rest
    treasury_client.claim(&beneficiary);
    assert_eq!(token_client.balance(&beneficiary), 1000);
}
