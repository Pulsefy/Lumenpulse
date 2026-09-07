use super::*;
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::token::StellarAssetClient;
use soroban_sdk::{symbol_short, Address, Env};

#[test]
fn test_reentrancy_guard_add_liquidity_rejects_when_locked() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());

    let pool_id = env.register(LiquidityPoolContract, ());
    let client = LiquidityPoolContractClient::new(&env, &pool_id);

    client.initialize(&admin, &token_id.address(), &token_id.address());

    // Simulate reentrant lock state
    env.as_contract(&pool_id, || {
        env.storage()
            .instance()
            .set(&symbol_short!("REENTRANT"), &true);
    });

    let result = client.try_add_liquidity(&admin, &100i128, &100i128, &0i128);
    assert_eq!(result, Err(Ok(LiquidityPoolError::Reentrancy)));
}

#[test]
fn test_ttl_extended_after_read_write() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let token_0_admin = Address::generate(&env);
    let token_1_admin = Address::generate(&env);
    let token_0_id = env.register_stellar_asset_contract_v2(token_0_admin.clone());
    let token_1_id = env.register_stellar_asset_contract_v2(token_1_admin.clone());
    StellarAssetClient::new(&env, &token_0_id.address()).mint(&user, &1_000_000);
    StellarAssetClient::new(&env, &token_1_id.address()).mint(&user, &1_000_000);

    let pool_id = env.register(LiquidityPoolContract, ());
    let client = LiquidityPoolContractClient::new(&env, &pool_id);
    client.initialize(&admin, &token_0_id.address(), &token_1_id.address());

    client.add_liquidity(&user, &100_000i128, &100_000i128, &0i128);

    // Advance past LEDGER_THRESHOLD once: reads should re-bump both the
    // instance (Admin/Token0/Token1) and the persistent reserve/LP keys.
    env.ledger().set_sequence_number(LEDGER_THRESHOLD + 1);
    assert_eq!(client.get_reserves(), (100_000i128, 100_000i128));
    assert!(client.lp_balance(&user) > 0);

    // Advance past LEDGER_THRESHOLD again — only survives if the prior
    // reads actually extended the TTL rather than leaving it to expire.
    env.ledger().set_sequence_number(2 * LEDGER_THRESHOLD + 2);
    assert_eq!(client.get_reserves(), (100_000i128, 100_000i128));

    // A swap after the long gap must also succeed (exercises both the
    // instance bump and the reserve persistent-key bump on the write path).
    let out = client.swap_exact_in(&user, &1_000i128, &0i128);
    assert!(out > 0);

    // A further gap, then a write from a fresh entrypoint (remove_liquidity)
    // must still succeed.
    env.ledger().set_sequence_number(3 * LEDGER_THRESHOLD + 3);
    let lp_balance = client.lp_balance(&user);
    let (out_0, out_1) = client.remove_liquidity(&user, &lp_balance, &0i128, &0i128);
    assert!(out_0 > 0 && out_1 > 0);
}
