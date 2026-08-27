use super::*;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::token::{StellarAssetClient, TokenClient};
use soroban_sdk::{Address, Env, Symbol};

#[test]
fn test_reentrancy_guard_add_liquidity_rejects_when_locked() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());

    let pool_id = env.register(StableSwapPoolContract, ());
    let client = StableSwapPoolContractClient::new(&env, &pool_id);

    client.initialize(&admin, &token_id.address(), &token_id.address());

    // Simulate reentrant lock state
    env.as_contract(&pool_id, || {
        env.storage().instance().set(&symbol_short!("REENTRANT"), &true);
    });

    let result = client.try_add_liquidity(&100i128, &100i128, &0i128);
    assert_eq!(result, Err(Ok(Symbol::new(&env, "reentrancy"))));
}
