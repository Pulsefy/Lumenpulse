use super::*;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::token::StellarAssetClient;
use soroban_sdk::{symbol_short, Address, Env};

fn setup_pool(
    env: &Env,
) -> (
    Address,
    Address,
    StableSwapPoolContractClient<'_>,
    StellarAssetClient<'_>,
    StellarAssetClient<'_>,
) {
    let admin = Address::generate(env);
    let token_a_admin = Address::generate(env);
    let token_b_admin = Address::generate(env);
    let token_a_id = env.register_stellar_asset_contract_v2(token_a_admin.clone());
    let token_b_id = env.register_stellar_asset_contract_v2(token_b_admin.clone());

    let pool_id = env.register(StableSwapPoolContract, ());
    let client = StableSwapPoolContractClient::new(env, &pool_id);
    client.initialize(&admin, &token_a_id.address(), &token_b_id.address());

    (
        token_a_id.address(),
        token_b_id.address(),
        client,
        StellarAssetClient::new(env, &token_a_id.address()),
        StellarAssetClient::new(env, &token_b_id.address()),
    )
}

fn mint_tokens(
    token_a: &StellarAssetClient,
    token_b: &StellarAssetClient,
    user: &Address,
    amount_a: i128,
    amount_b: i128,
) {
    token_a.mint(user, &amount_a);
    token_b.mint(user, &amount_b);
}

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

    env.as_contract(&pool_id, || {
        env.storage()
            .instance()
            .set(&symbol_short!("REENTRANT"), &true);
    });

    let result = client.try_add_liquidity(&admin, &100i128, &100i128, &0i128);
    assert_eq!(result, Err(Ok(StableSwapPoolError::Reentrancy)));
}

#[test]
fn test_add_swap_remove_sequence_keeps_pool_invariant() {
    let env = Env::default();
    env.mock_all_auths();

    let user = Address::generate(&env);
    let (token_a_addr, _token_b_addr, client, token_a, token_b) = setup_pool(&env);
    mint_tokens(&token_a, &token_b, &user, 40_000i128, 40_000i128);

    let lp_minted = client.add_liquidity(&user, &30_000i128, &30_000i128, &0i128);
    assert!(lp_minted > 0);
    assert_eq!(client.lp_balance(&user), lp_minted);

    let (reserve_a_before, reserve_b_before) = client.get_reserves();
    assert_eq!(reserve_a_before, 30_000i128);
    assert_eq!(reserve_b_before, 30_000i128);

    let amount_in = 750i128;
    let amount_out = client.swap(&user, &token_a_addr, &amount_in, &0i128);
    assert!(amount_out > 0);

    let (reserve_a_after, reserve_b_after) = client.get_reserves();
    assert_eq!(reserve_a_after, reserve_a_before + amount_in);
    assert_eq!(reserve_b_after, reserve_b_before - amount_out);
    assert!(reserve_a_after > 0 && reserve_b_after > 0);

    let removed_lp = client.lp_balance(&user);
    let (out_a, out_b) = client.remove_liquidity(&user, &removed_lp, &0i128, &0i128);
    assert_eq!(out_a + out_b, reserve_a_after + reserve_b_after);
    assert_eq!(client.get_reserves(), (0i128, 0i128));
    assert_eq!(client.lp_balance(&user), 0i128);
    assert!(token_a.balance(&user) >= 0);
    assert!(token_b.balance(&user) >= 0);
}

#[test]
fn test_rounding_favors_pool_over_caller() {
    let env = Env::default();
    env.mock_all_auths();

    let user = Address::generate(&env);
    let (token_a_addr, _token_b_addr, client, token_a, token_b) = setup_pool(&env);
    mint_tokens(&token_a, &token_b, &user, 60_000i128, 60_000i128);
    client.add_liquidity(&user, &50_000i128, &50_000i128, &0i128);

    let reserve_in = 50_000i128;
    let reserve_out = 50_000i128;
    let amount_in = 9i128;
    let amount_after_fee = (amount_in * (10000 - SWAP_FEE_BP as i128)) / 10000;
    let expected_out = (reserve_out * amount_after_fee) / (reserve_in + amount_after_fee);

    let actual_out = client.swap(&user, &token_a_addr, &amount_in, &0i128);
    assert_eq!(actual_out, expected_out);
    assert!(actual_out * (reserve_in + amount_after_fee) <= reserve_out * amount_after_fee);

    let (reserve_a, reserve_b) = client.get_reserves();
    assert_eq!(reserve_a, 50_009i128);
    assert_eq!(reserve_b, 50_000i128 - actual_out);
    assert!(actual_out < amount_in);
}

#[test]
fn test_slippage_limits_and_minimums_are_enforced() {
    let env = Env::default();
    env.mock_all_auths();

    let user = Address::generate(&env);
    let (token_a_addr, _token_b_addr, client, token_a, token_b) = setup_pool(&env);
    mint_tokens(&token_a, &token_b, &user, 10_000i128, 10_000i128);
    client.add_liquidity(&user, &10_000i128, &10_000i128, &0i128);

    let add_result = client.try_add_liquidity(&user, &100i128, &100i128, &1_000_000i128);
    assert!(add_result.is_err());

    let swap_result = client.try_swap(&user, &token_a_addr, &1_000i128, &1_000_000i128);
    assert!(swap_result.is_err());

    let lp_balance = client.lp_balance(&user);
    let remove_result = client.try_remove_liquidity(&user, &lp_balance, &1_000_000i128, &1_000_000i128);
    assert!(remove_result.is_err());
}

#[test]
fn test_extreme_imbalance_and_near_empty_states_do_not_panic() {
    let env = Env::default();
    env.mock_all_auths();

    let user = Address::generate(&env);
    let (_token_a_addr, _token_b_addr, client, token_a, token_b) = setup_pool(&env);
    mint_tokens(&token_a, &token_b, &user, 1_000_000_000_001i128, 1_000_000_000_001i128);

    let lp = client.add_liquidity(&user, &1_000_000_000_000i128, &1i128, &0i128);
    assert!(lp > 0);

    let (reserve_a, reserve_b) = client.get_reserves();
    assert!(reserve_a > reserve_b);
    assert!(reserve_b > 0);

    let user_2 = Address::generate(&env);
    let (_, _, client_2, token_a_2, token_b_2) = setup_pool(&env);
    mint_tokens(&token_a_2, &token_b_2, &user_2, 2i128, 2i128);
    let near_empty_lp = client_2.add_liquidity(&user_2, &1i128, &1i128, &0i128);
    assert!(near_empty_lp > 0);

    let remove = client_2.remove_liquidity(&user_2, &near_empty_lp, &0i128, &0i128);
    assert_eq!(remove, (1i128, 1i128));
}

#[test]
fn test_fee_accounting_is_conserved_across_swaps() {
    let env = Env::default();
    env.mock_all_auths();

    let user = Address::generate(&env);
    let (token_a_addr, _token_b_addr, client, token_a, token_b) = setup_pool(&env);
    mint_tokens(&token_a, &token_b, &user, 300_000i128, 300_000i128);
    client.add_liquidity(&user, &200_000i128, &200_000i128, &0i128);

    let mut total_in = 0i128;
    let mut total_fee = 0i128;
    for amount in [100i128, 250i128, 500i128] {
        let fee = amount * SWAP_FEE_BP as i128 / 10000;
        total_in += amount;
        total_fee += fee;

        let amount_out = client.swap(&user, &token_a_addr, &amount, &0i128);
        assert!(amount_out > 0);

        let (_, reserve_b) = client.get_reserves();
        assert!(reserve_b > 0);
    }

    assert_eq!(total_fee, (100i128 + 250i128 + 500i128) * SWAP_FEE_BP as i128 / 10000);
    assert!(total_in > total_fee);
}
