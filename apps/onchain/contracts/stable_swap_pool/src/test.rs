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
        env.storage()
            .instance()
            .set(&symbol_short!("REENTRANT"), &true);
    });

    let result = client.try_add_liquidity(&100i128, &100i128, &0i128);
    assert_eq!(result, Err(Ok(Symbol::new(&env, "reentrancy"))));
}

#[test]
fn test_ttl_extended_after_read_write() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let user = Address::generate(&env);

    let pool_id = env.register(StableSwapPoolContract, ());
    let client = StableSwapPoolContractClient::new(&env, &pool_id);

    client.initialize(&admin, &token_id.address(), &token_id.address());

    // Seed pool state directly (avoids needing a full deposit flow) and rely
    // on the contract's own bump helpers to establish the initial TTL.
    env.as_contract(&pool_id, || {
        env.storage()
            .persistent()
            .set(&DataKey::ReserveA, &1_000i128);
        env.storage()
            .persistent()
            .set(&DataKey::ReserveB, &1_000i128);
        env.storage()
            .persistent()
            .set(&DataKey::LPSupply, &1_000i128);
        env.storage()
            .persistent()
            .set(&DataKey::UserLPBalance(user.clone()), &500i128);
        StableSwapPoolContract::bump_pool_ttl(&env);
        StableSwapPoolContract::bump_user_lp_ttl(&env, &user);
    });

    // First threshold crossing: reads should re-bump both the pool-wide and
    // per-user persistent keys.
    env.ledger().set_sequence_number(LEDGER_THRESHOLD + 1);
    assert_eq!(client.get_reserves(), (1_000i128, 1_000i128));
    assert_eq!(client.lp_balance(&user), 500i128);

    // Second threshold crossing: this only survives if the prior reads
    // actually extended the TTL rather than leaving it to expire.
    env.ledger().set_sequence_number(2 * LEDGER_THRESHOLD + 2);
    assert_eq!(client.get_reserves(), (1_000i128, 1_000i128));
    assert_eq!(client.lp_balance(&user), 500i128);
}
